"use client";

import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";
import type { DispatchStep, Mode, TokenUsage, CostBreakdown } from "@/lib/multi-model-types";

export interface MessageUsage {
  tokens?: TokenUsage;
  cost?: CostBreakdown;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: DispatchStep[];
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

interface ConversationsStore {
  items: ConversationItem[];
  activeId: string | null;
  activeMessages: ConversationMessage[];
  loading: boolean;
  loadingMessages: boolean;

  loadList: () => Promise<void>;
  create: (mode?: Mode, title?: string) => Promise<string | null>;
  select: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
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

  loadList: async () => {
    set({ loading: true });
    try {
      const res = await authFetch("/api/conversations/list");
      const json = await res.json();
      if (json.ok) {
        set({ items: json.items });
      }
    } finally {
      set({ loading: false });
    }
  },

  create: async (mode = "SINGLE", title) => {
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
    await authFetch(`/api/conversations/delete?id=${id}`, { method: "POST" });
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      activeMessages: s.activeId === id ? [] : s.activeMessages,
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
