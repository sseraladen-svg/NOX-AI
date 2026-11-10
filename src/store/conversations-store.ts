"use client";

import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";
import {
  getGuestConversations,
  isGuestSession,
  saveGuestConversations,
} from "@/lib/local-storage";
import type {
  AgentWorkspace,
  DispatchStep,
  Mode,
  OrchestrationStage,
  OrchestrationState,
  TokenUsage,
  CostBreakdown,
  IntentClassification,
} from "@/lib/multi-model-types";

export interface MessageUsage {
  tokens?: TokenUsage;
  cost?: CostBreakdown;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: {
    data: string;
    mimeType: string;
  };
  trace?: DispatchStep[];
  orchestration?: {
    state?: OrchestrationState;
    stage?: OrchestrationStage;
    workspace?: AgentWorkspace;
    classification?: IntentClassification;
    approvalId?: string;
    highImpactActions?: string[];
    request?: string;
  };
  mode?: string;
  multiAgent: boolean;
  error: boolean;
  usage?: MessageUsage;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

interface GuestConversation extends ConversationItem {
  messages: ConversationMessage[];
}

interface ConversationsStore {
  items: ConversationItem[];
  activeId: string | null;
  activeMessages: ConversationMessage[];
  loading: boolean;
  loadingMessages: boolean;

  loadList: (scope?: string) => Promise<void>;
  create: (mode?: Mode | string, title?: string) => Promise<string | null>;
  select: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  clearActive: () => void;
  appendLocal: (msg: ConversationMessage) => void;
  refreshActive: () => Promise<void>;
}

export const useConversations = create<ConversationsStore>((set, get) => ({
  items: [],
  activeId: null,
  activeMessages: [],
  loading: false,
  loadingMessages: false,

  loadList: async (scope) => {
    if (isGuestSession()) {
      const items = getGuestConversations<GuestConversation>()
        .filter((item) => !scope || item.mode === scope)
        .map(({ id, title, mode, createdAt, updatedAt }) => ({
          id,
          title,
          mode,
          createdAt,
          updatedAt,
        }));
      set({ items, loading: false });
      return;
    }

    set({ loading: true });
    try {
      const res = await authFetch(
        scope ? `/api/conversations/list?scope=${encodeURIComponent(scope)}` : "/api/conversations/list"
      );
      const json = await res.json();
      if (json.ok) {
        set({ items: json.items });
      }
    } finally {
      set({ loading: false });
    }
  },

  create: async (mode = "SINGLE", title) => {
    if (isGuestSession()) {
      const now = new Date().toISOString();
      const item: GuestConversation = {
        id: crypto.randomUUID(),
        title: title || "New conversation",
        mode,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      const saved = saveGuestConversations([
        item,
        ...getGuestConversations<GuestConversation>(),
      ]);
      if (!saved) return null;
      set((s) => ({
        items: [item, ...s.items],
        activeId: item.id,
        activeMessages: [],
      }));
      return item.id;
    }

    try {
      const res = await authFetch("/api/conversations/create", {
        method: "POST",
        body: { mode, title },
      });
      const json = await res.json();
      if (json.ok) {
        const item = json.item as ConversationItem;
        set((s) => ({ items: [item, ...s.items], activeId: item.id, activeMessages: [] }));
        return item.id;
      }
    } catch {
      /* ignore */
    }
    return null;
  },

  select: async (id) => {
    set({ activeId: id, loadingMessages: true, activeMessages: [] });
    if (isGuestSession()) {
      const conversation = getGuestConversations<GuestConversation>().find(
        (item) => item.id === id
      );
      set({
        activeMessages: conversation?.messages || [],
        loadingMessages: false,
      });
      return;
    }

    try {
      const res = await authFetch(`/api/conversations/get?id=${id}`);
      const json = await res.json();
      if (json.ok) {
        set({ activeMessages: json.item.messages || [] });
      }
    } finally {
      set({ loadingMessages: false });
    }
  },

  remove: async (id) => {
    if (isGuestSession()) {
      const saved = saveGuestConversations(
        getGuestConversations<GuestConversation>().filter(
          (item) => item.id !== id
        )
      );
      if (!saved) return;
      set((s) => ({
        items: s.items.filter((item) => item.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
        activeMessages: s.activeId === id ? [] : s.activeMessages,
      }));
      return;
    }

    await authFetch(`/api/conversations/delete?id=${id}`, { method: "POST" });
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      activeMessages: s.activeId === id ? [] : s.activeMessages,
    }));
  },

  rename: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (isGuestSession()) {
      const saved = saveGuestConversations(
        getGuestConversations<GuestConversation>().map((item) =>
          item.id === id
            ? { ...item, title: trimmed, updatedAt: new Date().toISOString() }
            : item
        )
      );
      if (!saved) return;
      set((s) => ({
        items: s.items.map((item) =>
          item.id === id ? { ...item, title: trimmed } : item
        ),
      }));
      return;
    }

    await authFetch("/api/conversations/rename", {
      method: "POST",
      body: { id, title: trimmed },
    });
    set((s) => ({
      items: s.items.map((item) => item.id === id ? { ...item, title: trimmed } : item),
    }));
  },

  clearActive: () => set({ activeId: null, activeMessages: [] }),

  appendLocal: (msg) =>
    set((s) => ({ activeMessages: [...s.activeMessages, msg] })),

  refreshActive: async () => {
    const id = get().activeId;
    if (id) await get().select(id);
  },
}));

useConversations.subscribe((state, previousState) => {
  if (
    !isGuestSession() ||
    !state.activeId ||
    state.activeId !== previousState.activeId ||
    state.activeMessages === previousState.activeMessages
  ) {
    return;
  }

  const conversations = getGuestConversations<GuestConversation>();
  const index = conversations.findIndex((item) => item.id === state.activeId);
  if (index < 0) return;

  conversations[index] = {
    ...conversations[index],
    messages: state.activeMessages,
    updatedAt: new Date().toISOString(),
  };
  saveGuestConversations(conversations);
});
