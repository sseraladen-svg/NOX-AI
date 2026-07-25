"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Loader2,
  Sparkles,
  Bot,
  User as UserIcon,
  RefreshCw,
  ChevronRight,
  Zap,
  Network,
  Plus,
  Trash2,
  LogOut,
  MessageSquare,
  PanelLeft,
  X,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationMessage } from "@/store/conversations-store";
import { useAuth } from "@/store/auth-store";
import { useConversations } from "@/store/conversations-store";
import { useMultiModel } from "@/store/multi-model-store";
import type { Mode } from "@/lib/multi-model-types";
import { AdvancedCustomization } from "./advanced-customization";
import { MultiAgentConfirmDialog } from "./multi-agent-confirm-dialog";
import type { LimitRow } from "@/store/multi-model-store";

// ─── MessageBubble ──────────────────────────────────────────────────────────

export function MessageBubble({ msg }: { msg: ConversationMessage }) {
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
                {s.tokens && (
                  <span
                    className="px-1.5 py-0 rounded bg-cyan-500/10 text-cyan-400 text-[9px]"
                    title={`${s.tokens.input} input + ${s.tokens.output} output`}
                  >
                    {s.tokens.total} tok
                  </span>
                )}
                {s.cost && s.cost.total > 0 && (
                  <span
                    className="px-1.5 py-0 rounded bg-emerald-500/10 text-emerald-400 text-[9px]"
                    title={`$${s.cost.input.toFixed(6)} input + $${s.cost.output.toFixed(6)} output`}
                  >
                    ${s.cost.total.toFixed(4)}
                  </span>
                )}
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
            {/* Per-message aggregate usage footer */}
            {msg.usage?.tokens && (
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono pt-1.5 mt-1 border-t border-border/60 text-muted-foreground">
                <span className="uppercase tracking-wider">Total:</span>
                <span className="text-cyan-400">
                  {msg.usage.tokens.total} tok ({msg.usage.tokens.input} in + {msg.usage.tokens.output} out)
                </span>
                {msg.usage.cost && msg.usage.cost.total > 0 && (
                  <span className="text-emerald-400">
                    ${msg.usage.cost.total.toFixed(6)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── WelcomeScreen ──────────────────────────────────────────────────────────

export function WelcomeScreen({
  examples,
  onPick,
  mode,
  subtitle,
}: {
  examples: string[];
  onPick: (t: string) => void;
  mode: string;
  subtitle?: string;
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
        {subtitle ||
          `Multi-Model intelligence. Currently in ${mode} mode.`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl mt-6">
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

// ─── ChatInput ──────────────────────────────────────────────────────────────

export function ChatInput({
  input,
  setInput,
  onSend,
  sending,
  placeholder,
}: {
  input: string;
  setInput: (s: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-3">
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
          placeholder={
            placeholder ||
            "Message NOX AI…  (Enter to send · Shift+Enter for newline)"
          }
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
    </div>
  );
}

// ─── UserMenu ───────────────────────────────────────────────────────────────

export function UserMenu() {
  const auth = useAuth();
  const convs = useConversations();
  if (!auth.user) return null;
  return (
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
  );
}

// ─── ConversationDrawer (sidebar + mobile drawer) ───────────────────────────

export function ConversationDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const convs = useConversations();
  const mm = useMultiModel();

  const handleNew = async () => {
    await convs.create(mm.mode as Mode);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "spring", damping: 26, stiffness: 240 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-card border-r border-border z-50 p-3 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Conversations</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
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
                  No conversations yet. Click <strong>New conversation</strong>{" "}
                  to start.
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
                    onClose();
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {c.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className="uppercase tracking-wider">
                          {c.mode}
                        </span>
                        <span>·</span>
                        <span>
                          {new Date(c.updatedAt).toLocaleDateString()}
                        </span>
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
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── AdvancedDialog (settings modal wrapping AdvancedCustomization) ─────────

export function AdvancedDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto nox-scroll bg-card/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Advanced Customization
          </DialogTitle>
        </DialogHeader>
        <AdvancedCustomization />
      </DialogContent>
    </Dialog>
  );
}

// ─── ConfirmDialog wrapper ──────────────────────────────────────────────────

export function ConfirmWrapper({
  open,
  limits,
  mode,
  onContinue,
  onCancel,
  onSwitchToSingle,
  onOpenSettings,
}: {
  open: boolean;
  limits: LimitRow[];
  mode: string;
  onContinue: () => void;
  onCancel: () => void;
  onSwitchToSingle: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <MultiAgentConfirmDialog
      open={open}
      limits={limits}
      mode={mode}
      onContinue={onContinue}
      onCancel={onCancel}
      onSwitchToGlobal={onSwitchToSingle}
      onOpenSettings={onOpenSettings}
    />
  );
}

// ─── Thinking indicator ─────────────────────────────────────────────────────

export function ThinkingIndicator() {
  return (
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
  );
}

// ─── Header button helpers ──────────────────────────────────────────────────

export function IconButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </Button>
  );
}

// ─── Chat messages area (shared scrollable message list) ────────────────────

export function MessagesArea({
  scrollRef,
  messages,
  sending,
  loadingMessages,
  welcomeProps,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  welcomeProps?: {
    examples: string[];
    onPick: (t: string) => void;
    mode: string;
    subtitle?: string;
  };
}) {
  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6 min-h-0"
    >
      {messages.length === 0 && !loadingMessages && welcomeProps ? (
        <WelcomeScreen {...welcomeProps} />
      ) : loadingMessages ? (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          {sending && <ThinkingIndicator />}
        </div>
      )}
    </div>
  );
}
