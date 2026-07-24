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
  Plus,
  Trash2,
  LogOut,
  MessageSquare,
  PanelLeft,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdvancedCustomization } from "@/components/nox/advanced-customization";
import { MultiAgentConfirmDialog } from "@/components/nox/multi-agent-confirm-dialog";
import { AuthOverlay } from "@/components/nox/auth-overlay";
import { useMultiModel, type LimitRow } from "@/store/multi-model-store";
import { useAuth } from "@/store/auth-store";
import {
  useConversations,
  type ConversationMessage,
} from "@/store/conversations-store";
import { toast } from "sonner";
import type { DispatchStep, Mode } from "@/lib/multi-model-types";

export default function Home() {
  const [view, setView] = React.useState<"chat" | "advanced">("chat");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const auth = useAuth();
  const mm = useMultiModel();
  const convs = useConversations();

  // Bootstrap auth on mount
  React.useEffect(() => {
    auth.load();
  }, []);

  // Once authenticated, load multi-model config + conversation list
  React.useEffect(() => {
    if (auth.user) {
      mm.load();
      convs.loadList();
    }
  }, [auth.user?.id]);

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!auth.user) {
    return <AuthOverlay />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background nox-aurora">
      {/* Top nav */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2.5">
              <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center nox-glow-sm">
                <span className="text-primary-foreground font-bold text-sm">N</span>
              </div>
              <div className="leading-none hidden sm:block">
                <div className="font-semibold tracking-tight">NOX AI</div>
                <div className="text-[10px] text-muted-foreground">
                  Intelligence in the dark
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ModeBadge mode={mm.mode} />
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

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-8 w-8 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center text-xs font-medium uppercase">
                  {auth.user.email[0]}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <div className="text-sm font-medium truncate">
                    {auth.user.name || auth.user.email.split("@")[0]}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {auth.user.email}
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={() => setView("chat")}
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-2" /> Chat
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={() => setView("advanced")}
                >
                  <Settings2 className="h-3.5 w-3.5 mr-2" /> Advanced
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden" />
                <DropdownMenuItem
                  onClick={async () => {
                    await auth.logout();
                    convs.clearActive();
                  }}
                  className="text-red-400 focus:text-red-400"
                >
                  <LogOut className="h-3.5 w-3.5 mr-2" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex-1 mx-auto w-full max-w-7xl px-3 sm:px-4 py-4 flex gap-4 min-h-0">
        <AnimatePresence mode="wait">
          {view === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="flex gap-4 flex-1 min-h-0"
            >
              <ChatView
                sidebarOpen={sidebarOpen}
                onCloseSidebar={() => setSidebarOpen(false)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="advanced"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-y-auto nox-scroll pb-12"
            >
              <AdvancedCustomization />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const map: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; label: string }
  > = {
    SINGLE: { icon: Globe, label: "Single" },
    MULTI: { icon: Layers, label: "Multi" },
    ORCHESTRATOR: { icon: Network, label: "Orchestrator" },
  };
  const M = map[mode] || map.SINGLE;
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

// ─── Chat view (sidebar + chat area) ───────────────────────────────────────

interface ChatViewProps {
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
}

function ChatView({ sidebarOpen, onCloseSidebar }: ChatViewProps) {
  const convs = useConversations();
  const mm = useMultiModel();

  return (
    <>
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-2">
        <ConversationSidebar />
      </aside>

      {/* Sidebar — mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={onCloseSidebar}
            />
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 26, stiffness: 240 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-card border-r border-border z-50 p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Conversations</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onCloseSidebar}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ConversationSidebar onPick={onCloseSidebar} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-h-0">
        <ChatArea />
      </div>
    </>
  );
}

function ConversationSidebar({ onPick }: { onPick?: () => void }) {
  const convs = useConversations();
  const mm = useMultiModel();

  const handleNew = async () => {
    await convs.create(mm.mode as Mode);
    onPick?.();
  };

  return (
    <>
      <Button
        onClick={handleNew}
        className="w-full justify-start bg-primary/15 border border-primary/30 text-foreground hover:bg-primary/25"
        variant="ghost"
      >
        <Plus className="h-4 w-4 mr-2" /> New conversation
      </Button>
      <Separator className="my-1" />
      <div className="flex-1 overflow-y-auto nox-scroll space-y-1 -mx-1 px-1">
        {convs.loading && (
          <div className="text-xs text-muted-foreground text-center py-6">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
            Loading…
          </div>
        )}
        {!convs.loading && convs.items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6 px-3 leading-relaxed">
            No conversations yet. Click <strong>New conversation</strong> to
            start.
          </div>
        )}
        {convs.items.map((c) => (
          <div
            key={c.id}
            className={`group rounded-lg border px-3 py-2 cursor-pointer transition ${
              convs.activeId === c.id
                ? "border-primary/40 bg-primary/10"
                : "border-transparent hover:bg-muted/50"
            }`}
            onClick={() => {
              convs.select(c.id);
              onPick?.();
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{c.title}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span className="uppercase tracking-wider">{c.mode}</span>
                  <span>·</span>
                  <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  convs.remove(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Chat area (messages + input + dispatch flow) ──────────────────────────

function ChatArea() {
  const convs = useConversations();
  const mm = useMultiModel();
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [confirmLimits, setConfirmLimits] = React.useState<LimitRow[]>([]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingText, setPendingText] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [convs.activeMessages, sending]);

  const ensureConversation = async (): Promise<string | null> => {
    if (convs.activeId) return convs.activeId;
    return await convs.create(mm.mode as Mode);
  };

  const persist = async (
    conversationId: string,
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ) => {
    try {
      await fetch("/api/conversations/save-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, ...msg }),
      });
    } catch {
      /* ignore */
    }
  };

  const sendMessage = async (text: string, confirmMultiAgent = false) => {
    if (!text.trim() || sending) return;
    setSending(true);

    const conversationId = await ensureConversation();
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
    await persist(conversationId, {
      role: "user",
      content: text,
    });
    setInput("");

    // Build the message list for the API from current state (user msg included)
    const apiMessages = [
      ...convs.activeMessages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    try {
      const res = await fetch("/api/multi-model/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          confirmMultiAgent,
        }),
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
        // Remove the user message we just added locally — it'll be re-added
        // when the user confirms. But we already persisted it; that's fine
        // because the dispatch hasn't produced an assistant reply yet, so on
        // reload the user can resend.
        setSending(false);
        return;
      }

      const aiMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: r.finalReply || "(no response)",
        trace: r.steps as DispatchStep[] | undefined,
        mode: r.mode,
        multiAgent: r.multiAgent,
        error: false,
        createdAt: new Date().toISOString(),
      };
      convs.appendLocal(aiMsg);
      await persist(conversationId, {
        role: "assistant",
        content: r.finalReply || "",
        trace: r.steps,
        mode: r.mode,
        multiAgent: r.multiAgent,
        error: false,
      });

      // Refresh sidebar so the new title/updatedAt shows
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
      setPendingText(null);
      setConfirmLimits([]);
      sendMessage(text, true);
    }
  };

  const onConfirmSwitchToSingle = async () => {
    mm.setMode("SINGLE");
    const ok = await mm.save();
    if (ok) {
      toast.success("Switched to Single mode", {
        description: "Resend your message to use the single model.",
      });
    }
    setConfirmOpen(false);
    setPendingText(null);
  };

  const onConfirmOpenSettings = () => {
    setConfirmOpen(false);
    setPendingText(null);
    // Switch to advanced view is handled by parent; for now just close
    toast.info("Open the Advanced tab to change the model.");
  };

  const examples = [
    "Plan a login system with OAuth",
    "Write a regex to validate emails",
    "Describe what's in a typical office photo",
    "Automate a daily report workflow",
  ];

  return (
    <>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6 min-h-0"
      >
        {!convs.activeId && convs.activeMessages.length === 0 ? (
          <WelcomeScreen
            examples={examples}
            onPick={(t) => setInput(t)}
            mode={mm.mode}
          />
        ) : convs.loadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {convs.activeMessages.map((m) => (
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

      <div className="mt-3 rounded-2xl border border-border bg-card/40 backdrop-blur p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Message NOX AI…  (try: plan a login system, write a regex, automate a report)"
            className="min-h-[44px] max-h-32 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={1}
          />
          <Button
            size="icon"
            onClick={() => sendMessage(input)}
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

      <MultiAgentConfirmDialog
        open={confirmOpen}
        limits={confirmLimits}
        mode={mm.mode}
        onContinue={onConfirmContinue}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingText(null);
        }}
        onSwitchToGlobal={onConfirmSwitchToSingle}
        onOpenSettings={onConfirmOpenSettings}
      />
    </>
  );
}

// ─── Welcome screen + message bubble ───────────────────────────────────────

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
        {mode === "SINGLE"
          ? "One model handles everything."
          : mode === "MULTI"
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

function MessageBubble({ msg }: { msg: ConversationMessage }) {
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

        {msg.trace && msg.trace.length > 0 && (
          <div className="w-full rounded-lg border border-border bg-card/40 p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Zap className="h-3 w-3" />
              Dispatch trace
            </div>
            {msg.trace.map((s, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 text-[11px] font-mono"
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
