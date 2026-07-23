"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Sparkles,
  Bot,
  User as UserIcon,
  Loader2,
  Settings2,
  Network,
  Globe,
  Layers,
  ChevronRight,
  Clock,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AdvancedCustomization } from "@/components/nox/advanced-customization";
import { MultiAgentConfirmDialog } from "@/components/nox/multi-agent-confirm-dialog";
import { useMultiModel, type LimitRow } from "@/store/multi-model-store";
import { toast } from "sonner";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: {
    role: string;
    model: string;
    provider: string;
    connectionType: string;
    intent?: string;
    latencyMs: number;
    retries: number;
    timedOut: boolean;
  }[];
  mode?: string;
  multiAgent?: boolean;
  error?: boolean;
}

export default function Home() {
  const [view, setView] = React.useState<"chat" | "advanced">("chat");
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [confirmLimits, setConfirmLimits] = React.useState<LimitRow[]>([]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingMsg, setPendingMsg] = React.useState<ChatMsg | null>(null);
  const [mode, setMode] = React.useState<string>("GLOBAL");

  const store = useMultiModel();

  React.useEffect(() => {
    store.load();
  }, []);

  // Pull mode from config for the badge
  React.useEffect(() => {
    setMode(store.mode);
  }, [store.mode]);

  const sendMessage = async (text: string, confirmMultiAgent = false) => {
    if (!text.trim() || sending) return;
    setSending(true);

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    try {
      const res = await fetch("/api/multi-model/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          confirmMultiAgent,
        }),
      });
      const json = await res.json();

      if (!json.ok) {
        const errMsg: ChatMsg = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: json.error || "Dispatch failed.",
          error: true,
        };
        setMessages((m) => [...m, errMsg]);
        setSending(false);
        return;
      }

      const r = json.result;

      if (r.confirmationRequired) {
        // Pre-flight: open confirmation dialog with the limit summary
        setConfirmLimits(r.limits || []);
        setConfirmOpen(true);
        setPendingMsg(userMsg);
        setSending(false);
        return;
      }

      const aiMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: r.finalReply || "(no response)",
        steps: r.steps,
        mode: r.mode,
        multiAgent: r.multiAgent,
      };
      setMessages((m) => [...m, aiMsg]);
    } catch (err) {
      const errMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Network error: ${(err as Error).message}`,
        error: true,
      };
      setMessages((m) => [...m, errMsg]);
    }
    setSending(false);
  };

  const onConfirmContinue = () => {
    setConfirmOpen(false);
    if (pendingMsg) {
      // Re-send the last user message with confirmation
      const text = pendingMsg.content;
      setPendingMsg(null);
      setConfirmLimits([]);
      sendMessage(text, true);
    }
  };

  const onConfirmSwitchToGlobal = async () => {
    store.setMode("GLOBAL");
    const ok = await store.save();
    if (ok) {
      toast.success("Switched to Global mode", {
        description: "Resend your message to use the global model.",
      });
    }
    setConfirmOpen(false);
    setPendingMsg(null);
  };

  const onConfirmOpenSettings = () => {
    setConfirmOpen(false);
    setView("advanced");
    setPendingMsg(null);
  };

  const examples = [
    "Plan a login system with OAuth",
    "Write a regex to validate emails",
    "Describe what's in a typical office photo",
    "Automate a daily report workflow",
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background nox-aurora">
      {/* Top nav */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center nox-glow-sm">
              <span className="text-primary-foreground font-bold text-sm">N</span>
            </div>
            <div className="leading-none">
              <div className="font-semibold tracking-tight">NOX AI</div>
              <div className="text-[10px] text-muted-foreground">
                Intelligence in the dark
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ModeBadge mode={mode} />
            <div className="hidden sm:flex items-center gap-1 rounded-lg bg-muted/40 p-0.5">
              <button
                onClick={() => setView("chat")}
                className={`px-3 py-1.5 text-xs rounded-md transition ${
                  view === "chat"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setView("advanced")}
                className={`px-3 py-1.5 text-xs rounded-md transition flex items-center gap-1 ${
                  view === "advanced"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Settings2 className="h-3 w-3" />
                Advanced
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <AnimatePresence mode="wait">
          {view === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="h-[calc(100vh-9rem)] flex flex-col"
            >
              <ChatView
                messages={messages}
                sending={sending}
                input={input}
                setInput={setInput}
                onSend={() => sendMessage(input)}
                examples={examples}
                mode={mode}
              />
            </motion.div>
          ) : (
            <motion.div
              key="advanced"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <AdvancedCustomization />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Multi-agent confirmation dialog */}
      <MultiAgentConfirmDialog
        open={confirmOpen}
        limits={confirmLimits}
        mode={mode}
        onContinue={onConfirmContinue}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingMsg(null);
        }}
        onSwitchToGlobal={onConfirmSwitchToGlobal}
        onOpenSettings={onConfirmOpenSettings}
      />
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const map: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
    GLOBAL: { icon: Globe, label: "Global" },
    PER_FEATURE: { icon: Layers, label: "Per-Feature" },
    HOST: { icon: Network, label: "Host" },
  };
  const M = map[mode] || map.GLOBAL;
  const Icon = M.icon;
  return (
    <Badge
      variant="outline"
      className="bg-muted/40 border-border text-foreground gap-1.5"
    >
      <Icon className="h-3 w-3 text-primary" />
      {M.label}
    </Badge>
  );
}

interface ChatViewProps {
  messages: ChatMsg[];
  sending: boolean;
  input: string;
  setInput: (s: string) => void;
  onSend: () => void;
  examples: string[];
  mode: string;
}

function ChatView({
  messages,
  sending,
  input,
  setInput,
  onSend,
  examples,
  mode,
}: ChatViewProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  return (
    <>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6"
      >
        {messages.length === 0 ? (
          <WelcomeScreen examples={examples} onPick={(t) => setInput(t)} mode={mode} />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="flex items-center gap-1">
                  NOX is thinking
                  <span className="flex gap-0.5 ml-1">
                    <span className="nox-dot inline-block h-1 w-1 rounded-full bg-primary" />
                    <span className="nox-dot inline-block h-1 w-1 rounded-full bg-primary" />
                    <span className="nox-dot inline-block h-1 w-1 rounded-full bg-primary" />
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="mt-3 rounded-2xl border border-border bg-card/40 backdrop-blur p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Message NOX AI…  (try: plan a login system, write a regex, automate a report)"
            className="min-h-[44px] max-h-32 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={1}
          />
          <Button
            size="icon"
            onClick={onSend}
            disabled={sending || !input.trim()}
            className="h-9 w-9 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
          <span>Enter to send · Shift+Enter for newline</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Timeout + capped retry (2) active
          </span>
        </div>
      </div>
    </>
  );
}

function WelcomeScreen({
  examples,
  onPick,
  mode,
}: {
  examples: string[];
  onPick: (t: string) => void;
  mode: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative mb-6"
      >
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary via-fuchsia-500 to-cyan-500 flex items-center justify-center nox-glow nox-pulse">
          <Sparkles className="h-9 w-9 text-primary-foreground" />
        </div>
      </motion.div>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">
        Welcome to <span className="nox-text-gradient">NOX AI</span>
      </h1>
      <p className="text-sm text-muted-foreground max-w-md mb-1">
        Multi-Model intelligence. Currently in{" "}
        <span className="text-foreground font-medium">{mode}</span> mode.
      </p>
      <p className="text-xs text-muted-foreground max-w-md mb-6">
        {mode === "GLOBAL"
          ? "One model handles everything."
          : mode === "PER_FEATURE"
          ? "Each feature uses its own assigned model."
          : "Host routes your prompt to specialists automatically."}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => onPick(ex)}
            className="text-left text-sm rounded-lg border border-border bg-muted/30 hover:bg-muted/60 p-3 transition group"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{ex}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center ${
          isUser
            ? "bg-muted text-foreground"
            : msg.error
            ? "bg-red-500/15 text-red-400"
            : "bg-gradient-to-br from-primary to-fuchsia-500 text-primary-foreground"
        }`}
      >
        {isUser ? (
          <UserIcon className="h-4 w-4" />
        ) : msg.error ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>
      <div
        className={`max-w-[80%] ${
          isUser ? "items-end text-right" : "items-start"
        } flex flex-col gap-1.5`}
      >
        {msg.mode && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {msg.multiAgent && (
              <Badge className="bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30 hover:bg-fuchsia-500/20 text-[9px] py-0 px-1.5">
                <Network className="h-2.5 w-2.5 mr-0.5" />
                Multi-Agent
              </Badge>
            )}
            <span className="uppercase tracking-wider">{msg.mode}</span>
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground"
              : msg.error
              ? "bg-red-500/10 border border-red-500/30 text-red-400"
              : "bg-muted/50 border border-border"
          }`}
        >
          <div className="nox-prose whitespace-pre-wrap">{msg.content}</div>
        </div>

        {/* Dispatch trace */}
        {msg.steps && msg.steps.length > 0 && (
          <div className="w-full rounded-lg border border-border bg-card/40 p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Zap className="h-3 w-3" />
              Dispatch trace
            </div>
            {msg.steps.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[11px] font-mono"
              >
                <span className="text-primary capitalize">{s.role}</span>
                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-foreground">{s.model}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{s.provider}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {s.connectionType === "API" ? "API" : "LOCAL"}
                </span>
                {s.intent && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-fuchsia-400">{s.intent}</span>
                  </>
                )}
                <span className="text-muted-foreground ml-auto">
                  {s.latencyMs}ms
                </span>
                {s.retries > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[9px] py-0 px-1 border-amber-500/30 text-amber-400"
                  >
                    {s.retries} retry
                  </Badge>
                )}
                {s.timedOut && (
                  <Badge
                    variant="outline"
                    className="text-[9px] py-0 px-1 border-red-500/30 text-red-400"
                  >
                    timeout
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
