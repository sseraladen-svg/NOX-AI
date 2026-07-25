"use client";

import * as React from "react";
import {
  useConversations,
  type ConversationMessage,
  type MessageUsage,
} from "@/store/conversations-store";
import { useMultiModel, type LimitRow } from "@/store/multi-model-store";
import { authFetch } from "@/lib/auth-fetch";
import type { DispatchStep, Mode, FeatureId, TokenUsage, CostBreakdown } from "@/lib/multi-model-types";
import { toast } from "sonner";

// Sum token usage + cost across all dispatch steps for one message.
// Returns undefined if no step had any token usage (e.g. all failed or LOCAL).
function aggregateUsage(steps: DispatchStep[]): MessageUsage | undefined {
  let input = 0;
  let output = 0;
  let total = 0;
  let inputCost = 0;
  let outputCost = 0;
  let totalCost = 0;
  let hasAny = false;

  for (const s of steps) {
    if (s.tokens) {
      input += s.tokens.input;
      output += s.tokens.output;
      total += s.tokens.total;
      hasAny = true;
    }
    if (s.cost) {
      inputCost += s.cost.input;
      outputCost += s.cost.output;
      totalCost += s.cost.total;
    }
  }

  if (!hasAny) return undefined;

  const tokens: TokenUsage = { input, output, total };
  const cost: CostBreakdown = {
    input: Math.round(inputCost * 1_000_000) / 1_000_000,
    output: Math.round(outputCost * 1_000_000) / 1_000_000,
    total: Math.round(totalCost * 1_000_000) / 1_000_000,
  };
  return { tokens, cost };
}

// ───────────────────────────────────────────────────────────────────────────
// useChat — shared chat logic for all three mode pages.
//
// Handles: message sending, DB persistence, multi-agent confirmation flow,
// conversation creation, and the advanced-settings dialog state.
// ───────────────────────────────────────────────────────────────────────────

export function useChat() {
  const convs = useConversations();
  const mm = useMultiModel();
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [confirmLimits, setConfirmLimits] = React.useState<LimitRow[]>([]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingText, setPendingText] = React.useState<string | null>(null);
  const [pendingFeature, setPendingFeature] = React.useState<FeatureId | undefined>(undefined);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [convDrawerOpen, setConvDrawerOpen] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [convs.activeMessages, sending]);

  const ensureConversation = async (
    mode: Mode
  ): Promise<string | null> => {
    if (convs.activeId) return convs.activeId;
    return await convs.create(mode);
  };

  const persist = async (
    conversationId: string,
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ) => {
    try {
      await authFetch("/api/conversations/save-message", {
        method: "POST",
        body: { conversationId, ...msg },
      });
    } catch {
      /* ignore */
    }
  };

  const sendMessage = async (
    text: string,
    confirmMultiAgent = false,
    feature?: FeatureId
  ) => {
    if (!text.trim() || sending) return;
    setSending(true);

    const conversationId = await ensureConversation(mm.mode as Mode);
    if (!conversationId) {
      toast.error("Could not start conversation");
      setSending(false);
      return;
    }

    const userMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      multiAgent: false,
      error: false,
      createdAt: new Date().toISOString(),
    };
    convs.appendLocal(userMsg);
    await persist(conversationId, { role: "user", content: text });
    setInput("");

    const apiMessages = [
      ...convs.activeMessages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    try {
      const res = await authFetch("/api/multi-model/dispatch", {
        method: "POST",
        body: {
          messages: apiMessages,
          confirmMultiAgent,
          feature,
        },
      });
      const json = await res.json();

      if (!json.ok) {
        const errMsg: ConversationMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: json.error || "Dispatch failed.",
          error: true,
          multiAgent: false,
          createdAt: new Date().toISOString(),
        };
        convs.appendLocal(errMsg);
        setSending(false);
        return;
      }

      const r = json.result;

      if (r.confirmationRequired) {
        setConfirmLimits(r.limits || []);
        setConfirmOpen(true);
        setPendingText(text);
        setPendingFeature(feature);
        setSending(false);
        return;
      }

      // Aggregate token usage + cost across all dispatch steps.
      const steps = (r.steps as DispatchStep[]) || [];
      const aggUsage = aggregateUsage(steps);

      const aiMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: r.finalReply || "(no response)",
        trace: steps,
        mode: r.mode,
        multiAgent: r.multiAgent,
        error: false,
        usage: aggUsage,
        createdAt: new Date().toISOString(),
      };
      convs.appendLocal(aiMsg);
      await persist(conversationId, {
        role: "assistant",
        content: r.finalReply || "",
        trace: steps,
        mode: r.mode,
        multiAgent: r.multiAgent,
        error: false,
        usage: aggUsage,
      });
      convs.loadList();
    } catch (err) {
      const errMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Network error: ${(err as Error).message}`,
        error: true,
        multiAgent: false,
        createdAt: new Date().toISOString(),
      };
      convs.appendLocal(errMsg);
    }
    setSending(false);
  };

  const onConfirmContinue = () => {
    setConfirmOpen(false);
    if (pendingText !== null) {
      const text = pendingText;
      const feature = pendingFeature;
      setPendingText(null);
      setPendingFeature(undefined);
      setConfirmLimits([]);
      sendMessage(text, true, feature);
    }
  };

  const onConfirmSwitchToSingle = async () => {
    mm.setMode("SINGLE");
    const ok = await mm.save();
    if (ok)
      toast.success("Switched to Single mode", {
        description: "Resend your message to use the single model.",
      });
    setConfirmOpen(false);
    setPendingText(null);
  };

  return {
    // state
    input,
    setInput,
    sending,
    confirmLimits,
    confirmOpen,
    setConfirmOpen,
    pendingText,
    setPendingText,
    advancedOpen,
    setAdvancedOpen,
    convDrawerOpen,
    setConvDrawerOpen,
    scrollRef,
    // stores
    convs,
    mm,
    // actions
    sendMessage,
    onConfirmContinue,
    onConfirmSwitchToSingle,
  };
}
