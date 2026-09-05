"use client";

import * as React from "react";
import {
  useConversations,
  type ConversationMessage,
  type MessageUsage,
} from "@/store/conversations-store";
import { useMultiModel, type LimitRow } from "@/store/multi-model-store";
import { authFetch } from "@/lib/auth-fetch";
import { generateFromBrowser } from "@/lib/local-ollama";
import { SPECIALISTS, type DispatchStep, type Mode, type FeatureId, type TokenUsage, type CostBreakdown, type IntentClassification, type SpecialistId } from "@/lib/multi-model-types";
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const detail = body.trim().slice(0, 300);
    throw new Error(
      detail
        ? `Request failed (${response.status}): ${detail}`
        : `Request failed (${response.status}).`
    );
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// useChat - shared chat logic for all three mode pages.
//
// Handles: message sending, DB persistence, multi-agent confirmation flow,
// conversation creation, and the advanced-settings dialog state.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useChat() {
  const convs = useConversations();
  const mm = useMultiModel();
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [confirmLimits, setConfirmLimits] = React.useState<LimitRow[]>([]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingText, setPendingText] = React.useState<string | null>(null);
  const [pendingFeature, setPendingFeature] = React.useState<FeatureId | undefined>(undefined);
  const [pendingClassification, setPendingClassification] = React.useState<IntentClassification | undefined>(undefined);
  const [confirmClassification, setConfirmClassification] = React.useState<IntentClassification | undefined>(undefined);
  const [highImpactActions, setHighImpactActions] = React.useState<string[]>([]);
  const [highImpactApprovalId, setHighImpactApprovalId] = React.useState<string | null>(null);
  const [highImpactOpen, setHighImpactOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [convDrawerOpen, setConvDrawerOpen] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [convs.activeMessages, sending]);

  const ensureConversation = async (
    mode: Mode | string,
    title?: string
  ): Promise<string | null> => {
    // Read CURRENT state from the store - not the stale closure value.
    // This fixes the bug where switching conversations or creating a new one
    // didn't update the activeId used by sendMessage.
    const current = useConversations.getState();
    const active = current.items.find((item) => item.id === current.activeId);
    if (current.activeId && active?.mode === mode) return current.activeId;
    if (current.activeId && mode === "SINGLE" && active?.mode === "SINGLE") {
      return current.activeId;
    }
    return await current.create(mode, title);
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

  const cancelCurrentRequest = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  }, []);

  const sendMessage = async (
    text: string,
    confirmMultiAgent = false,
    feature?: FeatureId,
    image?: { data: string; mimeType: string },
    skipSpecialist = false,
    cachedClassification?: IntentClassification,
    approveHighImpact = false,
    approvalId?: string
  ) => {
    if ((!text.trim() && !image) || sending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);

    // In MULTI mode, create the conversation with the feature name as title
    // so the sidebar shows which feature each conversation belongs to.
    const convTitle = mm.mode === "MULTI" && feature
      ? `${feature.charAt(0).toUpperCase() + feature.slice(1)} - ${text.slice(0, 40)}`
      : undefined;
    const conversationScope =
      mm.mode === "MULTI" && feature ? `MULTI:${feature}` : mm.mode;
    const conversationId = await ensureConversation(conversationScope, convTitle);
    if (!conversationId) {
      toast.error("Could not start conversation");
      setSending(false);
      return;
    }

    // Only append + persist the user message if this is NOT a confirmation
    // re-dispatch (confirmMultiAgent=true means the user message was already
    // saved in the first round-trip). This prevents double execution.
    if (!confirmMultiAgent) {
      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        image,
        multiAgent: false,
        error: false,
        createdAt: new Date().toISOString(),
      };
      convs.appendLocal(userMsg);
      await persist(conversationId, { role: "user", content: text, multiAgent: false, error: false });
    }
    setInput("");

    // Read CURRENT activeMessages from the store - not the stale closure.
    const currentMessages = useConversations.getState().activeMessages;

    const apiMessages = [
      ...currentMessages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content, image: m.image })),
      // Only add the user message if it's not already in the history
      // (on confirmation re-dispatch, it's already there)
      ...(confirmMultiAgent
        ? []
        : [{ role: "user" as const, content: text, image }]),
    ];

    try {
      // Use streaming endpoint for progressive text display
      const streamRes = await authFetch("/api/multi-model/dispatch-stream", {
        method: "POST",
        signal: controller.signal,
        body: {
          messages: apiMessages,
          confirmMultiAgent,
          feature,
          conversationId,
          skipSpecialist,
          cachedClassification,
          approveHighImpact,
          approvalId,
        },
      });

      // Check if response is SSE stream
      const contentType = streamRes.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // Read the SSE stream
        const reader = streamRes.body?.getReader();
        if (!reader) throw new Error("No stream body");

        const decoder = new TextDecoder();
        let buffer = "";
        let progressiveText = "";
        let aiMsgId = crypto.randomUUID();
        let finalResult: any = null;
        let confirmationData: any = null;
        let errorData: any = null;
        let pendingClientExec: any = null;

        // Create an initial empty assistant message that we'll update progressively
        const initialMsg: ConversationMessage = {
          id: aiMsgId,
          role: "assistant",
          content: "",
          multiAgent: false,
          error: false,
          createdAt: new Date().toISOString(),
        };
        convs.appendLocal(initialMsg);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "thinking") {
                // UI already shows spinner — nothing to do
              } else if (data.type === "step") {
                // A dispatch step completed — could show trace info
              } else if (data.type === "chunk") {
                // Progressive text chunk — append to the assistant message
                progressiveText += data.text;
                // Update the message in the store
                useConversations.setState((s) => ({
                  activeMessages: s.activeMessages.map((m) =>
                    m.id === aiMsgId ? { ...m, content: progressiveText } : m
                  ),
                }));
              } else if (data.type === "pendingClientExec") {
                pendingClientExec = data.pendingClientExec;
              } else if (data.type === "confirmationRequired") {
                confirmationData = data;
              } else if (data.type === "error") {
                errorData = data;
              } else if (data.type === "done") {
                finalResult = data.result;
              }
            } catch {
              // incomplete JSON
            }
          }
          buffer += decoder.decode();
          if (buffer.startsWith("data: ")) {
            try {
              const data = JSON.parse(buffer.slice(6));
              if (data.type === "done") finalResult = data.result;
            } catch {
              // Ignore an incomplete final SSE fragment.
            }
          }
        }

        if (pendingClientExec) {
          let execCtx = pendingClientExec;
          while (execCtx) {
            const execMessages = Array.isArray(execCtx.resumeContext?.messages)
              ? execCtx.resumeContext.messages
              : [];
            const execImage = [...execMessages]
              .reverse()
              .find((message: { role?: string; image?: { data: string; mimeType: string } }) => message.role === "user")
              ?.image;
            const local = await generateFromBrowser(
              execCtx.endpoint || "",
              execCtx.model,
              execCtx.prompt,
              execImage,
              (chunk) => {
                progressiveText += chunk;
                useConversations.setState((s) => ({
                  activeMessages: s.activeMessages.map((m) =>
                    m.id === aiMsgId ? { ...m, content: progressiveText } : m
                  ),
                }));
              }
            );

            if (!local.ok) {
              useConversations.setState((s) => ({
                activeMessages: s.activeMessages.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: local.error || "Local Ollama call failed.", error: true }
                    : m
                ),
              }));
              setSending(false);
              return;
            }

            const resumed = await authFetch("/api/multi-model/dispatch-resume", {
              method: "POST",
              body: {
                stepId: execCtx.stepId,
                resultText: local.text,
                resumeContext: execCtx.resumeContext,
                browserTokens: local.tokens,
                browserLatencyMs: local.latencyMs,
              },
            });
            const resumedJson = await readJsonResponse<{
              ok: boolean;
              error?: string;
              result?: any;
            }>(resumed);

            if (!resumedJson.ok || !resumedJson.result) {
              useConversations.setState((s) => ({
                activeMessages: s.activeMessages.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: resumedJson.error || "Resume failed.", error: true }
                    : m
                ),
              }));
              setSending(false);
              return;
            }

            const resumedResult = resumedJson.result as any;

            // Handle confirmationRequired inside the resume loop
            if (resumedResult.confirmationRequired) {
              useConversations.setState((s) => ({
                activeMessages: s.activeMessages.filter((m) => m.id !== aiMsgId),
              }));
              setConfirmLimits(resumedResult.limits || []);
              setConfirmClassification(resumedResult.classification || undefined);
              setConfirmOpen(true);
              setPendingText(text);
              setPendingFeature(feature);
              setPendingClassification(resumedResult.classification || undefined);
              setSending(false);
              return;
            }

            // If another pendingClientExec is returned, continue the loop
            if (resumedResult.pendingClientExec) {
              execCtx = resumedResult.pendingClientExec;
              continue;
            }

            // Final result
            const steps = (resumedResult.steps as DispatchStep[]) || [];
            const aggUsage = aggregateUsage(steps);
            const finalText = resumedResult.finalReply || "(no response)";

            useConversations.setState((s) => ({
              activeMessages: s.activeMessages.map((m) =>
                m.id === aiMsgId
                  ? {
                      ...m,
                      content: finalText,
                      trace: steps,
                      mode: resumedResult.mode,
                      multiAgent: resumedResult.multiAgent,
                      orchestration: {
                        state: resumedResult.orchestrationState,
                        stage: resumedResult.orchestrationStage,
                        workspace: resumedResult.workspace,
                      },
                      usage: aggUsage,
                    }
                  : m
              ),
            }));

            await persist(conversationId, {
              role: "assistant",
              content: finalText,
              trace: steps,
              mode: resumedResult.mode,
              multiAgent: resumedResult.multiAgent,
              orchestration: {
                state: resumedResult.orchestrationState,
                stage: resumedResult.orchestrationStage,
                workspace: resumedResult.workspace,
              },
              error: false,
              usage: aggUsage,
            });
            convs.loadList();
            setSending(false);
            return;
          }
        }

        // Handle confirmation required
        if (confirmationData) {
          // Remove the empty assistant message
          useConversations.setState((s) => ({
            activeMessages: s.activeMessages.filter((m) => m.id !== aiMsgId),
          }));
          setConfirmLimits(confirmationData.limits || []);
          setConfirmClassification(confirmationData.classification || undefined);
          setConfirmOpen(true);
          setPendingText(text);
          setPendingFeature(feature);
          setPendingClassification(confirmationData.classification || undefined);
          setSending(false);
          return;
        }

        // Handle error
        if (errorData) {
          useConversations.setState((s) => ({
            activeMessages: s.activeMessages.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: errorData.error || "Dispatch failed.", error: true }
                : m
            ),
          }));
          setSending(false);
          return;
        }

        // Finalize the assistant message with trace + usage
        if (finalResult) {
          if (finalResult.destructiveConfirmationRequired) {
            useConversations.setState((s) => ({
              activeMessages: s.activeMessages.filter((m) => m.id !== aiMsgId),
            }));
            setHighImpactActions(finalResult.highImpactActions || []);
            setHighImpactApprovalId(finalResult.approvalId || null);
            setHighImpactOpen(true);
            setPendingText(text);
            setPendingFeature(feature);
            setPendingClassification(finalResult.classification || pendingClassification);
            setSending(false);
            return;
          }
          const steps = (finalResult.steps as DispatchStep[]) || [];
          const aggUsage = aggregateUsage(steps);
          const finalText = finalResult.finalReply || progressiveText || "(no response)";

          useConversations.setState((s) => ({
            activeMessages: s.activeMessages.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: finalText,
                    trace: steps,
                    mode: finalResult.mode,
                    multiAgent: finalResult.multiAgent,
                    orchestration: {
                      state: finalResult.orchestrationState,
                      stage: finalResult.orchestrationStage,
                      workspace: finalResult.workspace,
                    },
                    usage: aggUsage,
                  }
                : m
            ),
          }));

          // Persist the final message
          await persist(conversationId, {
            role: "assistant",
            content: finalText,
            trace: steps,
            mode: finalResult.mode,
            multiAgent: finalResult.multiAgent,
            error: false,
            orchestration: {
              state: finalResult.orchestrationState,
              stage: finalResult.orchestrationStage,
              workspace: finalResult.workspace,
            },
            usage: aggUsage,
          });
          convs.loadList();
        }

        setSending(false);
        return;
      }

      // Fallback: non-streaming response (if SSE not supported)
      const json = await readJsonResponse<{
        ok: boolean;
        error?: string;
        result?: any;
      }>(streamRes);

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

      if (r.pendingClientExec) {
        let execCtx = r.pendingClientExec;
        while (execCtx) {
          const execMessages = Array.isArray(execCtx.resumeContext?.messages)
            ? execCtx.resumeContext.messages
            : [];
          const execImage = [...execMessages]
            .reverse()
            .find((message: { role?: string; image?: { data: string; mimeType: string } }) => message.role === "user")
            ?.image;
          const local = await generateFromBrowser(
            execCtx.endpoint || "",
            execCtx.model,
            execCtx.prompt,
            execImage
          );

          if (!local.ok) {
            const errMsg: ConversationMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: local.error || "Local Ollama call failed.",
              error: true,
              multiAgent: false,
              createdAt: new Date().toISOString(),
            };
            convs.appendLocal(errMsg);
            setSending(false);
            return;
          }

          const resumed = await authFetch("/api/multi-model/dispatch-resume", {
            method: "POST",
            body: {
              stepId: execCtx.stepId,
              resultText: local.text,
              resumeContext: execCtx.resumeContext,
              browserTokens: local.tokens,
              browserLatencyMs: local.latencyMs,
            },
          });
          const resumedJson = await resumed.json();

          if (!resumedJson.ok || !resumedJson.result) {
            const errMsg: ConversationMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: resumedJson.error || "Resume failed.",
              error: true,
              multiAgent: false,
              createdAt: new Date().toISOString(),
            };
            convs.appendLocal(errMsg);
            setSending(false);
            return;
          }

          const resumedResult = resumedJson.result as any;

          // Handle confirmationRequired inside the resume loop
          if (resumedResult.confirmationRequired) {
            setConfirmLimits(resumedResult.limits || []);
            setConfirmClassification(resumedResult.classification || undefined);
            setConfirmOpen(true);
            setPendingText(text);
            setPendingFeature(feature);
            setPendingClassification(resumedResult.classification || undefined);
            setSending(false);
            return;
          }
          if (resumedResult.destructiveConfirmationRequired) {
            setHighImpactActions(resumedResult.highImpactActions || []);
            setHighImpactApprovalId(resumedResult.approvalId || null);
            setHighImpactOpen(true);
            setPendingText(text);
            setPendingFeature(feature);
            setPendingClassification(resumedResult.classification || pendingClassification);
            setSending(false);
            return;
          }

          // If another pendingClientExec is returned, continue the loop
          if (resumedResult.pendingClientExec) {
            execCtx = resumedResult.pendingClientExec;
            continue;
          }

          // Final result
          const steps = (resumedResult.steps as DispatchStep[]) || [];
          const aggUsage = aggregateUsage(steps);
          const finalText = resumedResult.finalReply || "(no response)";
          const aiMsg: ConversationMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: finalText,
            trace: steps,
            mode: resumedResult.mode,
            multiAgent: resumedResult.multiAgent,
            orchestration: {
              state: resumedResult.orchestrationState,
              stage: resumedResult.orchestrationStage,
              workspace: resumedResult.workspace,
            },
            error: false,
            usage: aggUsage,
            createdAt: new Date().toISOString(),
          };
          convs.appendLocal(aiMsg);
          await persist(conversationId, {
            role: "assistant",
            content: finalText,
            trace: steps,
            mode: resumedResult.mode,
            multiAgent: resumedResult.multiAgent,
            error: false,
            usage: aggUsage,
          });
          convs.loadList();
          setSending(false);
          return;
        }
      }

      if (r.confirmationRequired) {
        setConfirmLimits(r.limits || []);
        setConfirmClassification(r.classification || undefined);
        setConfirmOpen(true);
        setPendingText(text);
        setPendingFeature(feature);
        setPendingClassification(r.classification || undefined);
        setSending(false);
        return;
      }
      if (r.destructiveConfirmationRequired) {
        setHighImpactActions(r.highImpactActions || []);
        setHighImpactApprovalId(r.approvalId || null);
        setHighImpactOpen(true);
        setPendingText(text);
        setPendingFeature(feature);
        setPendingClassification(r.classification || pendingClassification);
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
        orchestration: {
          state: r.orchestrationState,
          stage: r.orchestrationStage,
          workspace: r.workspace,
        },
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
        orchestration: {
          state: r.orchestrationState,
          stage: r.orchestrationStage,
          workspace: r.workspace,
        },
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
      const classification = pendingClassification;
      setPendingText(null);
      setPendingFeature(undefined);
      setPendingClassification(undefined);
      setConfirmLimits([]);
      setConfirmClassification(undefined);
      // Pass cached classification so the backend doesn't re-run the
      // classification call - it already knows the specialist from the
      // first round-trip.
      sendMessage(text, true, feature, undefined, false, classification);
    }
  };

  const onChangeSpecialist = (specialist: SpecialistId) => {
    const description = SPECIALISTS.find((item) => item.id === specialist)?.description;
    const next = {
      ...(confirmClassification || pendingClassification),
      specialist,
      specialistDescription: description,
    } as IntentClassification;
    setConfirmClassification(next);
    setPendingClassification(next);
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

  const onConfirmHostDirectly = () => {
    setConfirmOpen(false);
    if (pendingText !== null) {
      const text = pendingText;
      const feature = pendingFeature;
      setPendingText(null);
      setPendingFeature(undefined);
      setPendingClassification(undefined);
      setConfirmLimits([]);
      setConfirmClassification(undefined);
      // Re-dispatch with skipSpecialist=true - Host answers directly.
      sendMessage(text, true, feature, undefined, true, pendingClassification);
    }
  };

  const onApproveHighImpact = () => {
    setHighImpactOpen(false);
    if (pendingText !== null && highImpactApprovalId) {
      const text = pendingText;
      const feature = pendingFeature;
      const classification = pendingClassification;
      setPendingText(null);
      setPendingFeature(undefined);
      setPendingClassification(undefined);
      setHighImpactActions([]);
      setHighImpactApprovalId(null);
      sendMessage(text, true, feature, undefined, false, classification, true, highImpactApprovalId);
    }
  };

  const onCancelHighImpact = () => {
    setHighImpactOpen(false);
    setPendingText(null);
    setPendingFeature(undefined);
    setPendingClassification(undefined);
    setHighImpactActions([]);
    setHighImpactApprovalId(null);
  };

  return {
    // state
    input,
    setInput,
    sending,
    confirmLimits,
    confirmClassification,
    confirmOpen,
    setConfirmOpen,
    highImpactOpen,
    highImpactActions,
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
    onChangeSpecialist,
    onConfirmSwitchToSingle,
    onConfirmHostDirectly,
    onApproveHighImpact,
    onCancelHighImpact,
  };
}
