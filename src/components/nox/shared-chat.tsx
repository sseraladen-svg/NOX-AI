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
  Search,
  Pencil,
  Upload,
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
import { Markdown } from "./markdown";
import { useMultiModel } from "@/store/multi-model-store";
import type { Mode } from "@/lib/multi-model-types";
import type { IntentClassification, SpecialistId } from "@/lib/multi-model-types";
import { AdvancedCustomization } from "./advanced-customization";
import { MultiAgentConfirmDialog } from "./multi-agent-confirm-dialog";
import type { LimitRow } from "@/store/multi-model-store";
import { cn } from "@/lib/utils";

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
            : "bg-gradient-to-br from-foreground to-foreground/60 text-background"
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
              <Badge className="bg-foreground/10 text-foreground border-foreground/20 hover:bg-foreground/15 text-[9px] py-0 px-1.5">
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
          <Markdown content={msg.content} className="nox-prose" />
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
                    <span className="text-foreground/80 italic">{s.intent}</span>
                  </>
                )}
                <span className="text-muted-foreground ml-auto">
                  {s.latencyMs}ms
                </span>
                {s.tokens && (
                  <span
                    className="px-1.5 py-0 rounded bg-foreground/10 text-foreground text-[9px]"
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
                <span className="text-foreground">
                  {msg.usage.tokens.total} tok ({msg.usage.tokens.input} in + {msg.usage.tokens.output} out)
                </span>
                {msg.usage.cost && msg.usage.cost.total > 0 && (
                  <span className="text-emerald-400">
                    ${msg.usage.cost.total.toFixed(6)}
                  </span>
                )}
              </div>
            )}
            {msg.orchestration?.workspace && (
              <div className="w-full rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-1 text-[11px]">
                <div className="font-medium text-primary">
                  Agent Workspace
                  {msg.orchestration.stage ? ` - ${msg.orchestration.stage.replaceAll("_", " ")}` : ""}
                </div>
                {msg.orchestration.workspace.changedFiles?.length ? (
                  <div>Changed files: {msg.orchestration.workspace.changedFiles.join(", ")}</div>
                ) : null}
                {msg.orchestration.workspace.verificationResults?.map((result) => (
                  <div key={result.command} className={result.ok ? "text-emerald-400" : "text-red-400"}>
                    {result.ok ? "PASS" : "FAIL"} {result.command}
                  </div>
                ))}
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
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center nox-glow nox-pulse">
          <Sparkles className="h-9 w-9 text-background" />
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
  onSend: (image?: { data: string; mimeType: string }) => void;
  sending: boolean;
  placeholder?: string;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [attachmentName, setAttachmentName] = React.useState<string | null>(null);
  const [imageAttachment, setImageAttachment] = React.useState<{ data: string; mimeType: string } | undefined>();
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);

  const readAttachment = async (file: File) => {
    setAttachmentError(null);
    if (file.type.startsWith("image/")) {
      const dataUrl = await fileToDataUrl(file);
      setImageAttachment({
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        mimeType: file.type,
      });
      setAttachmentName(file.name);
      return;
    }

    const supported = /\.(txt|md|csv|json|html?|xml)$/i.test(file.name);
    if (!supported) {
      setAttachmentError("Use an image or a text document (.txt, .md, .csv, .json, .html, .xml).");
      return;
    }

    const text = await file.text();
    const context = `\n\n[RAG document: ${file.name}]\n${text.slice(0, 100_000)}\n[/RAG document]\n`;
    setInput(`${input}${context}`);
    setAttachmentName(file.name);
    setImageAttachment(undefined);
  };

  return (
    <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-3">
      {attachmentError && (
        <div className="mb-2 text-xs text-red-400">{attachmentError}</div>
      )}
      {(attachmentName || imageAttachment) && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          {imageAttachment ? (
            <div className="relative flex-shrink-0">
              <img
                src={`data:${imageAttachment.mimeType};base64,${imageAttachment.data}`}
                alt={attachmentName || "attachment"}
                className="h-14 w-14 rounded-lg object-cover border border-border"
              />
              <button
                type="button"
                onClick={() => {
                  setAttachmentName(null);
                  setImageAttachment(undefined);
                }}
                aria-label="Remove attachment"
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border text-[10px] leading-none flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary">
              <Upload className="h-3 w-3" />
              <span className="max-w-[180px] truncate">{attachmentName}</span>
              <button
                type="button"
                onClick={() => setAttachmentName(null)}
                aria-label="Remove attachment"
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(imageAttachment);
              setAttachmentName(null);
              setImageAttachment(undefined);
              setAttachmentError(null);
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
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label="Upload document or image"
          className="h-9 w-9 shrink-0"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.csv,.json,.html,.htm,.xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void readAttachment(file).catch((err: unknown) => {
                setAttachmentName(null);
                setImageAttachment(undefined);
                setAttachmentError(
                  err instanceof Error ? err.message : "Could not read attachment."
                );
              });
            }
            e.currentTarget.value = "";
          }}
        />
        <Button
          size="icon"
          onClick={() => {
            onSend(imageAttachment);
            setAttachmentName(null);
            setImageAttachment(undefined);
            setAttachmentError(null);
          }}
          disabled={sending || (!input.trim() && !imageAttachment)}
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read attachment."));
    reader.readAsDataURL(file);
  });
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

// ─── Conversation list (shared content for sidebar + mobile drawer) ────────

function ConversationListContent({ onAfterSelect }: { onAfterSelect: () => void }) {
  const convs = useConversations();
  const mm = useMultiModel();
  const [query, setQuery] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const handleNew = async () => {
    await convs.create(mm.mode as Mode);
    onAfterSelect();
  };

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = async () => {
    if (renamingId) await convs.rename(renamingId, renameValue);
    setRenamingId(null);
  };

  const scopedItems = mm.mode === "MULTI"
    ? convs.items.filter((c) => c.mode.startsWith("MULTI:") || c.mode === "MULTI")
    : convs.items.filter((c) => c.mode === mm.mode);
  const filtered = query.trim()
    ? scopedItems.filter((c) =>
        c.title.toLowerCase().includes(query.trim().toLowerCase())
      )
    : scopedItems;

  return (
    <>
      <Button
        onClick={handleNew}
        className="w-full justify-start bg-primary/15 border border-primary/30 text-foreground hover:bg-primary/25"
        variant="ghost"
      >
        <Plus className="h-4 w-4 mr-2" /> New conversation
      </Button>

      {convs.items.length > 0 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="w-full h-8 pl-8 pr-2 rounded-lg bg-muted/40 border border-border text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      )}

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
        {!convs.loading && convs.items.length > 0 && filtered.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6 px-3 leading-relaxed">
            No conversations match &ldquo;{query}&rdquo;.
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`group rounded-lg border px-3 py-2 cursor-pointer transition ${
              convs.activeId === c.id
                ? "border-primary/40 bg-primary/10"
                : "border-transparent hover:bg-muted/50"
            }`}
            onClick={() => {
              if (renamingId === c.id) return;
              convs.select(c.id);
              onAfterSelect();
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                    className="w-full h-6 px-1.5 -mx-1.5 rounded bg-background border border-primary/40 text-sm font-medium focus:outline-none"
                  />
                ) : (
                  <div className="text-sm font-medium truncate">
                    {c.title}
                  </div>
                )}
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
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(c.id, c.title);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Rename conversation"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    convs.remove(c.id);
                  }}
                  className="text-muted-foreground hover:text-red-400"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── ConversationSidebar (persistent, desktop lg+) ──────────────────────────

export function ConversationSidebar({
  breakpoint = "lg",
}: {
  /** Tailwind breakpoint at which the sidebar becomes visible. Use "xl" on
   * pages that already reserve a lg+ sidebar for something else (e.g. the
   * Orchestrator roster) so the two don't compete for space. */
  breakpoint?: "lg" | "xl";
}) {
  return (
    <aside
      className={cn(
        "hidden w-72 shrink-0 flex-col gap-2 h-full",
        breakpoint === "lg" ? "lg:flex" : "xl:flex"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">Conversations</span>
      </div>
      <ConversationListContent onAfterSelect={() => {}} />
    </aside>
  );
}

// ─── ConversationDrawer (mobile/tablet overlay, below lg) ───────────────────

export function ConversationDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "spring", damping: 26, stiffness: 240 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-card border-r border-border z-50 p-3 flex flex-col gap-2 lg:hidden"
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
            <ConversationListContent onAfterSelect={onClose} />
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
  classification,
  request,
  onContinue,
  onCancel,
  onSwitchToSingle,
  onOpenSettings,
  onHostHandleDirectly,
  onChangeSpecialist,
  highImpact = false,
  highImpactActions = [],
  onApproveHighImpact,
  onCancelHighImpact,
}: {
  open: boolean;
  limits: LimitRow[];
  mode: string;
  classification?: IntentClassification;
  request?: string | null;
  onContinue: () => void;
  onCancel: () => void;
  onSwitchToSingle: () => void;
  onOpenSettings: () => void;
  onHostHandleDirectly: () => void;
  onChangeSpecialist?: (specialist: SpecialistId) => void;
  highImpact?: boolean;
  highImpactActions?: string[];
  onApproveHighImpact?: () => void;
  onCancelHighImpact?: () => void;
}) {
  return (
    <MultiAgentConfirmDialog
      open={open}
      limits={limits}
      mode={mode}
      classification={classification}
      request={request}
      onContinue={onContinue}
      onCancel={highImpact ? (onCancelHighImpact || onCancel) : onCancel}
      onSwitchToGlobal={onSwitchToSingle}
      onOpenSettings={onOpenSettings}
      onHostHandleDirectly={onHostHandleDirectly}
      onChangeSpecialist={onChangeSpecialist}
      highImpact={highImpact}
      highImpactActions={highImpactActions}
      onApproveHighImpact={onApproveHighImpact}
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
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
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
