"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Brain,
  User as UserIcon,
  Send,
  Loader2,
  ChevronRight,
  Zap,
  Network,
  RefreshCw,
  Copy,
  Check,
  Download,
  Code2,
  Mic,
  MicOff,
  Play,
  Pause,
  Volume2,
  Upload,
  Image as ImageIcon,
  X,
  Eye,
  Workflow,
  Cpu,
  Gauge,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { ConversationMessage } from "@/store/conversations-store";
import type { DispatchStep } from "@/lib/multi-model-types";
import { Markdown } from "./markdown";

// ─── Shared bits ────────────────────────────────────────────────────────────

function ThinkingIndicator() {
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

function DispatchTrace({ steps }: { steps: DispatchStep[] }) {
  if (!steps || steps.length === 0) return null;

  // Aggregate totals across all steps for a footer summary.
  const totals = steps.reduce(
    (acc, s) => {
      if (s.tokens) {
        acc.input += s.tokens.input;
        acc.output += s.tokens.output;
        acc.total += s.tokens.total;
        acc.hasTokens = true;
      }
      if (s.cost) {
        acc.cost += s.cost.total;
        acc.hasCost = true;
      }
      return acc;
    },
    { input: 0, output: 0, total: 0, cost: 0, hasTokens: false, hasCost: false }
  );

  return (
    <div className="w-full rounded-lg border border-border bg-card/40 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
        <Zap className="h-3 w-3" />
        Dispatch trace
      </div>
      {steps.map((s, i) => (
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
          <span className="text-muted-foreground ml-auto">{s.latencyMs}ms</span>
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
          {s.timedOut && (
            <span className="px-1.5 py-0 rounded bg-red-500/10 text-red-400 text-[9px]">
              timeout
            </span>
          )}
        </div>
      ))}
      {(totals.hasTokens || totals.hasCost) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono pt-1.5 mt-1 border-t border-border/60 text-muted-foreground">
          <span className="uppercase tracking-wider">Total:</span>
          {totals.hasTokens && (
            <span className="text-foreground">
              {totals.total} tok ({totals.input} in + {totals.output} out)
            </span>
          )}
          {totals.hasCost && totals.cost > 0 && (
            <span className="text-emerald-400">
              ${totals.cost.toFixed(6)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ModeBadge({ msg }: { msg: ConversationMessage }) {
  if (!msg.mode) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {msg.multiAgent && (
        <Badge className="bg-foreground/10 text-foreground border-foreground/20 hover:bg-foreground/15 text-[9px] py-0 px-1.5">
          <Network className="h-2.5 w-2.5 mr-0.5" />
          Multi-Agent
        </Badge>
      )}
      <span className="uppercase tracking-wider">{msg.mode}</span>
    </div>
  );
}

// ─── 1. CHAT FEATURE - conversational bubbles + markdown ────────────────────

export function ChatFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
  examples,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
  examples: string[];
}) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6 min-h-0"
      >
        {messages.length === 0 && !loadingMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="h-16 w-16 rounded-2xl bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center nox-glow mb-4"
            >
              <Bot className="h-7 w-7 text-background" />
            </motion.div>
            <h2 className="text-2xl font-semibold mb-1">Chat</h2>
            <p className="text-sm text-muted-foreground mb-6">
              General conversation & Q&A
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  className="text-left text-sm rounded-lg border border-border bg-muted/30 hover:bg-muted/60 p-3 transition"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : loadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} msg={m} />
            ))}
            {sending && <ThinkingIndicator />}
          </div>
        )}
      </div>
      <ChatInputBar
        input={input}
        setInput={setInput}
        onSend={onSend}
        sending={sending}
        placeholder="Message the chat model..."
      />
    </div>
  );
}

export function DeepAnalysisFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
  onSendText,
  examples,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
  onSendText?: (text: string) => void;
  examples: string[];
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const sections = lastAssistant ? extractMarkdownSections(lastAssistant.content) : [];
  const submitText = (text: string) => {
    if (onSendText) onSendText(text);
    else setInput(text);
  };

  const exportMarkdown = () => {
    if (!lastAssistant) return;
    const blob = new Blob([lastAssistant.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deep-analysis.md";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6 min-h-0"
      >
        {messages.length === 0 && !loadingMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center nox-glow mb-4">
              <Brain className="h-7 w-7 text-background" />
            </div>
            <h2 className="text-2xl font-semibold mb-1">Deep Analysis</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Research, compare, and break complex questions into clear findings.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="text-left text-sm rounded-lg border border-border bg-muted/30 hover:bg-muted/60 p-3 transition"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : loadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isLatestAnswer = message.id === lastAssistant?.id;
              return (
                <div key={message.id} className="rounded-xl border border-border bg-card/40 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {message.role === "user" ? <UserIcon className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
                      {message.role === "user" ? "Question" : "Analysis"}
                    </div>
                    {isLatestAnswer && (
                      <Button type="button" size="sm" variant="outline" onClick={exportMarkdown} className="h-7 text-xs">
                        <Download className="h-3 w-3 mr-1.5" />
                        Export Markdown
                      </Button>
                    )}
                  </div>
                  {message.role === "user" ? (
                    <Markdown content={message.content} className="nox-prose" />
                  ) : isLatestAnswer && sections.length > 0 ? (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                      <nav aria-label="Analysis section overview" className="rounded-lg border border-border/70 bg-background/30 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Analysis overview</div>
                        <ol className="space-y-2">
                          {sections.map((section, index) => (
                            <li key={`${section.title}-${index}`} className="flex items-start gap-2 text-xs">
                              <span className="h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center font-mono">
                                {index + 1}
                              </span>
                              <span className="pt-0.5">{section.title}</span>
                            </li>
                          ))}
                        </ol>
                      </nav>
                      <div className="space-y-2">
                        {sections.map((section, index) => (
                          <details key={`${section.title}-${index}`} open={index === 0} className="group rounded-lg border border-border/70 bg-background/30">
                            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium flex items-center gap-2">
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
                              {section.title}
                            </summary>
                            <div className="border-t border-border/60 px-3 py-3">
                              <Markdown content={section.content} className="nox-prose" />
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Markdown content={message.content} className="nox-prose" />
                  )}
                  {message.role === "assistant" && <DispatchTrace steps={message.trace || []} />}
                </div>
              );
            })}
            {sending && <ThinkingIndicator />}
          </div>
        )}
      </div>
      <ChatInputBar
        input={input}
        setInput={setInput}
        onSend={onSend}
        sending={sending}
        placeholder="Ask a question for structured analysis..."
      />
      {examples.length > 0 && messages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => submitText(example)} className="text-[10px] rounded-full border border-border bg-card/40 px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40">
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function extractMarkdownSections(text: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  let currentTitle = "Overview";
  let currentLines: string[] = [];
  let hasHeading = false;

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      hasHeading = true;
      if (currentLines.some((entry) => entry.trim())) {
        sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
      }
      currentTitle = heading[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some((entry) => entry.trim())) {
    sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
  }
  if (!hasHeading) return [{ title: "Analysis", content: text }];
  return sections.length ? sections : [{ title: currentTitle, content: text }];
}

function ChatBubble({ msg }: { msg: ConversationMessage }) {
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
        <ModeBadge msg={msg} />
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
        <DispatchTrace steps={msg.trace || []} />
      </div>
    </motion.div>
  );
}

function ChatInputBar({
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
  placeholder: string;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [attachmentName, setAttachmentName] = React.useState<string | null>(null);
  const [imageAttachment, setImageAttachment] = React.useState<{ data: string; mimeType: string }>();
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);

  const readAttachment = async (file: File) => {
    setAttachmentError(null);
    if (file.type.startsWith("image/")) {
      const dataUrl = await fileToDataUrl(file);
      setImageAttachment({ data: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: file.type });
      setAttachmentName(file.name);
      return;
    }
    if (!/\.(txt|md|csv|json|html?|xml)$/i.test(file.name)) {
      setAttachmentError("Use an image or a text document.");
      return;
    }
    const text = await file.text();
    setInput(`${input}\n\n[RAG document: ${file.name}]\n${text.slice(0, 100_000)}\n[/RAG document]\n`);
    setAttachmentName(file.name);
    setImageAttachment(undefined);
  };

  return (
    <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-3">
      {(attachmentName || attachmentError) && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          {attachmentName && (
            <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary">
              {imageAttachment ? <ImageIcon className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
              {attachmentName}
              <button type="button" onClick={() => { setAttachmentName(null); setImageAttachment(undefined); }} aria-label="Remove attachment">×</button>
            </span>
          )}
          {attachmentError && <span className="text-red-400">{attachmentError}</span>}
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
            }
          }}
          placeholder={placeholder}
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
            if (file) void readAttachment(file);
            e.currentTarget.value = "";
          }}
        />
        <Button
          size="icon"
          onClick={() => onSend(imageAttachment)}
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

// ─── 2. CODING FEATURE - editor layout with prompt + code output ────────────

export function CodingFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
  onSendText,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
  onSendText?: (text: string) => void;
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const codeBlocks = lastAssistant ? extractCodeBlocks(lastAssistant.content) : [];
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = React.useState<number | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);

  const copy = (text: string, idx: number) => {
    setCopyError(null);
    if (!navigator.clipboard?.writeText) {
      setCopyError("Clipboard access is unavailable in this browser.");
      return;
    }
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx(null), 2000);
    }).catch((error: unknown) => {
      console.error("Could not copy code block:", error);
      setCopyError("Clipboard access failed. Select and copy the code manually.");
    });
  };

  const explainCode = (block: { lang: string; code: string }) => {
    const request = `Explain this ${block.lang || ""} code clearly, including its purpose and important behavior:\n\n\`\`\`${block.lang}\n${block.code}\n\`\`\``;
    if (onSendText) onSendText(request);
    else setInput(request);
  };

  const download = (block: { lang: string; code: string }, idx: number) => {
    const extension = block.lang || "txt";
    const blob = new Blob([block.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `artifact-${idx + 1}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1">
      {/* Left: prompt + history */}
      <div className="flex flex-col gap-3 lg:w-1/2 min-h-0">
        <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-3">
          <div className="flex items-center gap-2 mb-2">
            <Code2 className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Prompt
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Describe the code you need...  (⌘/Ctrl+Enter to run)"
            className="min-h-[80px] max-h-48 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm font-mono"
            rows={3}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-muted-foreground">
              {input.length} chars
            </span>
            <Button
              size="sm"
              onClick={() => onSend()}
              disabled={sending || !input.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              Run
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-3 min-h-0"
        >
          {messages.length === 0 && !loadingMessages ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8">
              <Code2 className="h-8 w-8 mb-2 opacity-50" />
              <p>Your conversation will appear here.</p>
              <p className="text-xs mt-1">Code output shows on the right →</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`text-sm rounded-lg p-2.5 ${
                    m.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                    {m.role === "user" ? <UserIcon className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    {m.role}
                  </div>
                  <div className="whitespace-pre-wrap text-xs leading-relaxed">
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && <ThinkingIndicator />}
            </div>
          )}
        </div>
      </div>

      {/* Right: code output */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-red-400" />
            <div className="h-2 w-2 rounded-full bg-amber-400" />
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-muted-foreground ml-1 font-mono">
              output.ts
            </span>
          </div>
          {codeBlocks.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {codeBlocks.length} block{codeBlocks.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        <div className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-[#0d0b14] min-h-0">
          {copyError && <p role="alert" className="px-3 pt-2 text-xs text-red-400">{copyError}</p>}
          {codeBlocks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground p-6">
              <Code2 className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No code yet</p>
              <p className="text-xs mt-1 max-w-xs">
                Describe what you want to build on the left. Generated code
                appears here with syntax highlighting and a copy button.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              {codeBlocks.map((block, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-border/60">
                  <div className="flex items-center justify-between bg-muted/30 px-3 py-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">
                      {block.lang || "code"}
                    </span>
                    <div className="flex items-center gap-2">
                      {["html", "htm"].includes(block.lang.toLowerCase()) && (
                        <button
                          onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {previewIdx === i ? "Code" : "Preview"}
                        </button>
                      )}
                      <button
                        onClick={() => copy(block.code, i)}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        {copiedIdx === i ? (
                          <>
                            <Check className="h-3 w-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => explainCode(block)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Explain this code
                      </button>
                      <button
                        onClick={() => download(block, i)}
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Artifact
                      </button>
                    </div>
                  </div>
                  {previewIdx === i ? (
                    <iframe
                      title={`Live preview ${i + 1}`}
                      sandbox=""
                      srcDoc={block.code}
                      className="w-full min-h-64 bg-white"
                    />
                  ) : (
                    <SyntaxHighlighter
                      language={block.lang === "code" ? "text" : block.lang.toLowerCase()}
                      style={oneDark}
                      customStyle={{ margin: 0, padding: "0.75rem", background: "transparent", fontSize: "0.75rem", lineHeight: "1.5" }}
                    >
                      {block.code}
                    </SyntaxHighlighter>
                  )}
                </div>
              ))}
              {lastAssistant && (
                <DispatchTrace steps={lastAssistant.trace || []} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || "code", code: match[2].trim() });
  }
  // If no fenced blocks, check if the whole thing looks like code
  if (blocks.length === 0 && text.trim().split("\n").length > 2) {
    // leave empty - only show fenced blocks
  }
  return blocks;
}

// ─── 3. VOICE FEATURE - mic + transcript + TTS ──────────────────────────────

export function VoiceFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const elevenAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [sttSupported, setSttSupported] = React.useState(true);
  const recognitionRef = React.useRef<any>(null);
  const [liveTranscript, setLiveTranscript] = React.useState("");
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [waveform, setWaveform] = React.useState<number[]>(() => Array(24).fill(0));
  const [waveformError, setWaveformError] = React.useState<string | null>(null);

  // Check if Web Speech API (SpeechRecognition) is available.
  React.useEffect(() => {
    const SpeechRecognition =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setSttSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
      setLiveTranscript(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setRecording(false);
    };

    recognition.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = recognition;
  }, [setInput]);

  React.useEffect(() => {
    if (!recording) return;
    let active = true;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let animationFrame = 0;
    setWaveformError(null);

    const startMeter = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Microphone level visualization is not supported in this browser.");
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const levels = new Uint8Array(analyser.frequencyBinCount);
        const updateWaveform = () => {
          if (!active) return;
          analyser.getByteFrequencyData(levels);
          setWaveform(Array.from(levels.slice(0, 24), (level) => level / 255));
          animationFrame = window.requestAnimationFrame(updateWaveform);
        };
        updateWaveform();
      } catch (error) {
        if (active) {
          setWaveformError(error instanceof Error ? error.message : "Could not access microphone levels.");
        }
      }
    };

    void startMeter();
    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (recording) {
      recognitionRef.current.stop();
      setRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setRecording(true);
        setLiveTranscript("");
        setWaveformError(null);
        setInput(""); // clear previous input
      } catch (err) {
        console.error("Failed to start recognition:", err);
        setRecording(false);
      }
    }
  };

  // TTS: play an assistant message using the browser's speechSynthesis API.
  const togglePlay = (msgId: string, text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (playingId === msgId) {
      window.speechSynthesis.cancel();
      setPlayingId(null);
      return;
    }
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = playbackRate;
    utterance.onend = () => setPlayingId(null);
    utterance.onerror = () => setPlayingId(null);
    window.speechSynthesis.speak(utterance);
    setPlayingId(msgId);
  };

  const playElevenLabs = async (msgId: string, text: string) => {
    elevenAudioRef.current?.pause();
    if (playingId === msgId) {
      setPlayingId(null);
      return;
    }
    try {
      const response = await fetch("/api/voice/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("ElevenLabs unavailable");
      const audio = new Audio(URL.createObjectURL(await response.blob()));
      audio.playbackRate = playbackRate;
      elevenAudioRef.current = audio;
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      setPlayingId(msgId);
      await audio.play();
    } catch {
      togglePlay(msgId, text);
    }
  };

  // Cleanup speech synthesis on unmount
  React.useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {/* Mic bar */}
      <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-4 flex items-center gap-4">
        <button
          onClick={toggleMic}
          disabled={!sttSupported}
          className={`h-14 w-14 rounded-full flex items-center justify-center transition shrink-0 ${
            recording
              ? "bg-red-500/20 border-2 border-red-500 text-red-400 nox-glow-sm"
              : sttSupported
              ? "bg-primary/15 border-2 border-primary/40 text-primary hover:bg-primary/25"
              : "bg-muted/20 border-2 border-border text-muted-foreground cursor-not-allowed"
          }`}
          title={!sttSupported ? "Speech recognition not supported in this browser" : undefined}
        >
          {recording ? (
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              <MicOff className="h-5 w-5" />
            </motion.div>
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {recording ? "Listening..." : sttSupported ? "Tap to speak" : "Speech recognition not supported"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {recording
              ? "Speak now - your speech will be transcribed live"
              : sttSupported
              ? "Browser-native speech-to-text (Chrome/Edge recommended)"
              : "Use Chrome or Edge for microphone support. You can still type below."}
          </div>
          {recording && (
            <div className="flex items-center gap-0.5 mt-2 h-6">
              {waveform.map((level, i) => (
                <div
                  key={i}
                  className="w-1 bg-red-400 rounded-full"
                  style={{ height: `${Math.max(3, level * 24)}px` }}
                />
              ))}
            </div>
          )}
          {recording && liveTranscript && (
            <p aria-live="polite" className="mt-2 text-xs text-foreground/80">
              {liveTranscript}
            </p>
          )}
          {waveformError && recording && (
            <p role="status" className="mt-2 text-[10px] text-amber-400">{waveformError}</p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-3 text-xs text-muted-foreground">
        <Volume2 className="h-3.5 w-3.5" />
        Playback speed
        <input
          type="range"
          min={0.75}
          max={1.5}
          step={0.25}
          value={playbackRate}
          onChange={(event) => setPlaybackRate(Number(event.target.value))}
          className="w-28 accent-primary"
        />
        <span className="w-8 font-mono text-foreground">{playbackRate.toFixed(2)}×</span>
      </label>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nox-scroll rounded-2xl border border-border bg-card/30 backdrop-blur-sm p-4 min-h-0"
      >
        {messages.length === 0 && !loadingMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Volume2 className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">No transcript yet</p>
            <p className="text-xs mt-1 max-w-xs">
              {sttSupported
                ? "Tap the microphone to speak, or type below. AI responses include a Play button for text-to-speech."
                : "Type below to send a message. AI responses include a Play button for text-to-speech."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl p-3 text-sm ${
                  m.role === "user"
                    ? "bg-primary/10 border border-primary/20"
                    : "bg-muted/40 border border-border"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="outline" className="text-[9px] py-0">
                    {m.role === "user" ? "INPUT" : "TTS"}
                  </Badge>
                  {m.role === "assistant" && (
                    <>
                      {typeof window !== "undefined" && window.speechSynthesis && (
                        <button
                          onClick={() => togglePlay(m.id, m.content)}
                          className="text-[10px] text-primary hover:underline flex items-center gap-1"
                        >
                          {playingId === m.id ? <><Pause className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Play</>}
                        </button>
                      )}
                      <button
                        onClick={() => playElevenLabs(m.id, m.content)}
                        className="text-[10px] text-primary hover:underline"
                      >
                        ElevenLabs
                      </button>
                    </>
                  )}
                </div>
                <Markdown content={m.content} className="nox-prose" />
                <DispatchTrace steps={m.trace || []} />
              </div>
            ))}
            {sending && <ThinkingIndicator />}
          </div>
        )}
      </div>

      <ChatInputBar
        input={input}
        setInput={setInput}
        onSend={() => onSend()}
        sending={sending}
        placeholder="Or type text to send..."
      />
    </div>
  );
}

// ─── 4. VISION FEATURE - image upload + analysis ────────────────────────────

export function VisionFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [imageData, setImageData] = React.useState<{ data: string; mimeType: string } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [measurementPoints, setMeasurementPoints] = React.useState<Array<{ x: number; y: number }>>([]);
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);

  const handleFile = (file: File) => {
    setUploadError(null);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setUploadError("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("Images must be 10 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setUploadError("Could not read the selected image.");
        return;
      }
      const dataUrl = reader.result;
      setPreview(dataUrl);
      setMeasurementPoints([]);
      setImageDimensions(null);
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
      if (match) {
        setImageData({ mimeType: match[1], data: match[2] });
      } else {
        setUploadError("The selected image could not be encoded.");
      }
    };
    reader.onerror = () => setUploadError("Could not read the selected image.");
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setPreview(null);
    setImageData(null);
    setMeasurementPoints([]);
    setImageDimensions(null);
  };

  const handleAnalyze = () => {
    const image = imageData || undefined;
    onSend(image);
    if (image) clearImage();
  };

  const lastImageIndex = messages.reduce(
    (index, message, currentIndex) => message.role === "user" && message.image ? currentIndex : index,
    -1
  );
  const latestAssistantIndex = messages.reduce(
    (index, message, currentIndex) => message.role === "assistant" ? currentIndex : index,
    -1
  );
  const storedImage = lastImageIndex >= 0 ? messages[lastImageIndex].image : undefined;
  const displayImage = preview || (storedImage
    ? storedImage.data.startsWith("data:")
      ? storedImage.data
      : `data:${storedImage.mimeType};base64,${storedImage.data}`
    : null);
  const latestAnalysis = !preview && latestAssistantIndex > lastImageIndex ? messages[latestAssistantIndex] : undefined;
  const parsedRegions = latestAnalysis ? extractVisionRegions(latestAnalysis.content) : { regions: [], invalid: false };
  const measuredPixels = imageDimensions && measurementPoints.length === 2
    ? Math.round(Math.hypot(
        (measurementPoints[1].x - measurementPoints[0].x) * imageDimensions.width,
        (measurementPoints[1].y - measurementPoints[0].y) * imageDimensions.height
      ))
    : null;

  const addMeasurementPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const image = imageRef.current;
    if (!image) return;
    const bounds = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setMeasurementPoints((points) => points.length === 2 ? [{ x, y }] : [...points, { x, y }]);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1">
      {/* Left: image upload / preview */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-2 px-1">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Image
          </span>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => {
            if (!displayImage) fileRef.current?.click();
          }}
          className={`flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition min-h-[200px] ${
            dragOver
              ? "border-primary bg-primary/10"
              : "border-border bg-card/30 hover:bg-card/50"
          }`}
        >
          {displayImage ? (
            <div
              className="relative w-fit max-w-full max-h-full p-2"
              onClick={(event) => {
                event.stopPropagation();
                addMeasurementPoint(event);
              }}
            >
              <img
                ref={imageRef}
                src={displayImage}
                alt="Image selected for visual analysis"
                className="block max-w-full max-h-[360px] object-contain rounded-lg"
                onLoad={(event) => setImageDimensions({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })}
              />
              <svg className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                {parsedRegions.regions.map((region, index) => (
                  <g key={`${region.label}-${index}`}>
                    <rect
                      x={region.x * 1000}
                      y={region.y * 1000}
                      width={region.width * 1000}
                      height={region.height * 1000}
                      fill="none"
                      stroke={region.kind === "defect" ? "#fb7185" : "#38bdf8"}
                      strokeWidth="4"
                    />
                    <text x={region.x * 1000} y={Math.max(14, region.y * 1000 - 5)} fill={region.kind === "defect" ? "#fb7185" : "#38bdf8"} fontSize="18">
                      {region.label}
                    </text>
                  </g>
                ))}
                {measurementPoints.length === 2 && (
                  <line
                    x1={measurementPoints[0].x * 1000}
                    y1={measurementPoints[0].y * 1000}
                    x2={measurementPoints[1].x * 1000}
                    y2={measurementPoints[1].y * 1000}
                    stroke="#fbbf24"
                    strokeWidth="4"
                  />
                )}
                {measurementPoints.map((point, index) => (
                  <circle key={index} cx={point.x * 1000} cy={point.y * 1000} r="7" fill="#fbbf24" />
                ))}
              </svg>
              {preview && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearImage();
                  }}
                  className="absolute top-3 right-3 h-7 w-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                  aria-label="Remove image"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="text-center p-6">
              <div className="h-14 w-14 rounded-xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium">Drop an image here</p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse · PNG, JPG, WebP
              </p>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
        {uploadError && <p role="alert" className="text-xs text-red-400">{uploadError}</p>}
        {displayImage && (
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{preview ? "Selected image · click two points to measure pixel distance" : "Image from this conversation · click two points to measure pixel distance"}</span>
            {measuredPixels !== null && <span className="font-mono text-amber-400">{measuredPixels} px (uncalibrated)</span>}
          </div>
        )}
        {latestAnalysis && !parsedRegions.regions.length && (
          <p className="text-[10px] text-muted-foreground">
            {parsedRegions.invalid ? "The response contained invalid region coordinates; no boxes were drawn." : "No verified region coordinates were returned."}
          </p>
        )}
        {preview && (
          <div className="text-[10px] text-muted-foreground text-center">
            Image attached - ask the vision model to analyze it
          </div>
        )}
      </div>

      {/* Right: analysis */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-2.5">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAnalyze();
              }
            }}
            placeholder="Ask about the image... (e.g. 'What objects are in this photo?')"
            className="min-h-[44px] max-h-24 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={2}
          />
          <div className="flex justify-end mt-1">
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={sending || (!input.trim() && !imageData)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Analyze
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-3 min-h-0"
        >
          {messages.length === 0 && !loadingMessages ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <ImageIcon className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No analysis yet</p>
              <p className="text-xs mt-1 max-w-xs">
                Upload an image, ask a question, and the vision model will
                describe what it sees.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-3 text-sm ${
                    m.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/40 border border-border"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                    {m.role === "user" ? <UserIcon className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {m.role}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {m.content}
                  </div>
                  <DispatchTrace steps={m.trace || []} />
                </div>
              ))}
              {sending && <ThinkingIndicator />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extractVisionRegions(text: string): {
  regions: Array<{ label: string; kind: "defect" | "object"; x: number; y: number; width: number; height: number }>;
  invalid: boolean;
} {
  const block = text.match(/```(?:nox-vision|json)\s*([\s\S]*?)```/i);
  if (!block) return { regions: [], invalid: false };

  let payload: unknown;
  try {
    payload = JSON.parse(block[1]);
  } catch {
    return { regions: [], invalid: true };
  }
  if (!payload || typeof payload !== "object" || !("regions" in payload) || !Array.isArray(payload.regions)) {
    return { regions: [], invalid: true };
  }

  const regions: Array<{ label: string; kind: "defect" | "object"; x: number; y: number; width: number; height: number }> = [];
  let invalid = false;
  for (const candidate of payload.regions.slice(0, 20)) {
    if (!candidate || typeof candidate !== "object") {
      invalid = true;
      continue;
    }
    const region = candidate as Record<string, unknown>;
    const { x, y, width, height } = region;
    const kind = region.kind;
    if (
      typeof region.label !== "string" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      (kind !== "defect" && kind !== "object") ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1 ||
      y + height > 1
    ) {
      invalid = true;
      continue;
    }
    regions.push({ label: region.label.slice(0, 80), kind, x, y, width, height });
  }
  if (payload.regions.length > 20) invalid = true;
  return { regions, invalid };
}

// ─── 5. AUTOMATION FEATURE - workflow node canvas ───────────────────────────

export function AutomationFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
  onSendText,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
  onSendText?: (text: string) => void;
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const steps = lastAssistant ? extractWorkflowSteps(lastAssistant.content) : [];

  // Interactive workflow state - each step can be checked off
  const [checkedSteps, setCheckedSteps] = React.useState<Set<number>>(new Set());

  // Reset checked steps when new workflow arrives
  React.useEffect(() => {
    setCheckedSteps(new Set());
  }, [lastAssistant?.id]);

  const toggleStep = (i: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const completedCount = checkedSteps.size;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;
  const retryStep = (step: { name: string; detail?: string }, index: number) => {
    const request = `Review and correct workflow step ${index + 1}: ${step.name}${step.detail ? ` — ${step.detail}` : ""}. Return the corrected step and its safety checks.`;
    if (onSendText) onSendText(request);
    else setInput(request);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1">
      {/* Left: interactive workflow canvas */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Workflow
            </span>
            {steps.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {completedCount}/{steps.length} done
              </Badge>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-emerald-500"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Manual progress only. Confirm each step after completing it; this interface does not execute external workflows.
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-4 min-h-0">
          {steps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Workflow className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No workflow yet</p>
              <p className="text-xs mt-1 max-w-xs">
                Describe an automation task (e.g. &ldquo;Daily report pipeline&rdquo;).
                The AI will outline steps for you to review and track manually.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {steps.map((step, i) => {
                const isChecked = checkedSteps.has(i);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleStep(i)}
                        disabled={step.status === "error"}
                        aria-label={`${isChecked ? "Unmark" : "Mark"} step ${i + 1} ${isChecked ? "incomplete" : "complete"}`}
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition ${
                          isChecked
                            ? "bg-emerald-500/20 border border-emerald-500/40"
                            : step.status === "error"
                            ? "bg-red-500/15 border border-red-500/40"
                            : "bg-primary/15 border border-primary/30 hover:bg-primary/25"
                        }`}
                      >
                        {isChecked ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : step.status === "error" ? (
                          <TriangleAlert className="h-4 w-4 text-red-400" />
                        ) : (
                          <span className="text-xs font-mono text-primary">{i + 1}</span>
                        )}
                      </button>
                      <div
                        className={`flex-1 rounded-lg border px-3 py-2 transition ${
                          isChecked
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : step.status === "error"
                            ? "border-red-500/40 bg-red-500/5"
                            : "border-border bg-card/60"
                        }`}
                      >
                        <div className={`text-sm font-medium ${isChecked ? "line-through text-muted-foreground" : step.status === "error" ? "text-red-300" : ""}`}>
                          {step.name}
                        </div>
                        {step.detail && (
                          <div className={`text-[11px] mt-0.5 ${step.status === "error" ? "text-red-300/80" : "text-muted-foreground"}`}>
                            {step.detail}
                          </div>
                        )}
                      </div>
                      {step.status === "error" && (
                        <Button type="button" size="sm" variant="outline" onClick={() => retryStep(step, i)} className="h-7 shrink-0 text-[10px]">
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="ml-4 h-4 w-px bg-border" />
                    )}
                  </motion.div>
                );
              })}
              {lastAssistant && (
                <div className="mt-3">
                  <DispatchTrace steps={lastAssistant.trace || []} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: prompt + conversation */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-2.5">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Describe the workflow to automate...  (⌘/Ctrl+Enter)"
            className="min-h-[60px] max-h-32 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={3}
          />
          <div className="flex justify-end mt-1">
            <Button
              size="sm"
              onClick={() => onSend()}
              disabled={sending || !input.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              Build
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-3 min-h-0"
        >
          {messages.length === 0 && !loadingMessages ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              <p>Conversation appears here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`text-xs rounded-lg p-2.5 ${
                    m.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/40"
                  }`}
                >
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">
                    {m.role}
                  </div>
                  <Markdown content={m.content} className="nox-prose" />
                </div>
              ))}
              {sending && <ThinkingIndicator />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extractWorkflowSteps(text: string): { name: string; detail?: string; status: "planned" | "error" }[] {
  const steps: { name: string; detail?: string; status: "planned" | "error" }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)\s*$/);
    if (!match) continue;
    const body = match[1].trim();
    const boldTitle = body.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
    const plainTitle = body.match(/^(.+?):\s+(.+)$/);
    const title = boldTitle?.[1] || plainTitle?.[1] || body;
    const detail = boldTitle?.[2] || plainTitle?.[2] || "";
    steps.push({
      name: title.trim(),
      detail: detail.trim() || undefined,
      status: /\b(error|failed|blocked|unavailable)\b/i.test(body) ? "error" : "planned",
    });
  }
  return steps.slice(0, 12);
}

// ─── 6. ROBOTICS FEATURE - sensor grid + motion plan ────────────────────────

export function RoboticsFeatureUI({
  messages,
  sending,
  loadingMessages,
  scrollRef,
  input,
  setInput,
  onSend,
}: {
  messages: ConversationMessage[];
  sending: boolean;
  loadingMessages: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (s: string) => void;
  onSend: (image?: { data: string; mimeType: string }) => void;
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const plan = lastAssistant ? extractMotionPlan(lastAssistant.content) : null;
  const [speed, setSpeed] = React.useState(0.5);
  const [acceleration, setAcceleration] = React.useState(0.5);
  const points = plan ? getWaypointPlotPoints(plan.waypoints) : [];

  return (
    <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1">
      {/* Left: model-provided path preview */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Motion Preview
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/30 p-3">
          {plan && plan.waypoints.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2 text-[10px] text-muted-foreground">
                <span>Top-down X/Y path · {plan.units}</span>
                <span>{plan.waypoints.length} waypoints</span>
              </div>
              <svg viewBox="0 0 400 300" role="img" aria-label="Preview of the proposed robot motion path" className="w-full h-56 rounded-lg bg-background/40">
                <path d="M50 20V270H380" fill="none" stroke="currentColor" className="text-border" strokeWidth="1" />
                {points.length > 1 && (
                  <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" className="text-primary" strokeWidth="3" strokeDasharray="7 5" />
                )}
                {points.map((point, index) => (
                  <g key={`${plan.waypoints[index].label}-${index}`}>
                    <circle cx={point.x} cy={point.y} r="5" fill="currentColor" className="text-primary" />
                    <text x={point.x + 8} y={point.y - 7} fill="currentColor" className="text-muted-foreground" fontSize="10">
                      {index + 1}
                    </text>
                  </g>
                ))}
              </svg>
              <ol className="mt-3 space-y-1 text-xs">
                {plan.waypoints.map((waypoint, index) => (
                  <li key={`${waypoint.label}-${index}`} className="flex justify-between gap-3">
                    <span><span className="font-mono text-primary mr-2">{index + 1}.</span>{waypoint.label}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {waypoint.x}, {waypoint.y}, {waypoint.z} {plan.units}
                    </span>
                  </li>
                ))}
              </ol>
              {plan.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-300">
                  {plan.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}
                </ul>
              )}
              {plan.invalid && (
                <p role="status" className="mt-2 text-[10px] text-amber-400">
                  Some generated waypoints or warnings were invalid and were omitted from the preview.
                </p>
              )}
            </>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Network className="h-8 w-8 mb-2 opacity-40" />
              <p>{plan?.invalid ? "No valid path coordinates were returned" : "No structured path data yet"}</p>
              <p className="text-xs mt-1">The preview uses only validated model-provided coordinates.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/30 p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-3 w-3" />
            Preview parameters (not sent to hardware)
          </div>
          <label className="flex items-center gap-3 text-xs">
            <span className="w-24 text-muted-foreground">Speed</span>
            <input type="range" min="0.1" max="1" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="flex-1 accent-primary" />
            <span className="w-10 text-right font-mono">{speed.toFixed(2)}×</span>
          </label>
          <label className="flex items-center gap-3 text-xs">
            <span className="w-24 text-muted-foreground">Acceleration</span>
            <input type="range" min="0.1" max="1" step="0.05" value={acceleration} onChange={(event) => setAcceleration(Number(event.target.value))} className="flex-1 accent-primary" />
            <span className="w-10 text-right font-mono">{acceleration.toFixed(2)}×</span>
          </label>
        </div>
        <div role="note" className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          Preview only—no robot or actuator is connected. Validate the coordinate frame, joint limits, collision clearance, and emergency-stop behavior before using any plan on real hardware.
        </div>
      </div>

      {/* Right: prompt + conversation */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-2.5">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Describe the motion task... (e.g. 'Pick and place cup')"
            className="min-h-[60px] max-h-28 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={3}
          />
          <div className="flex justify-end mt-1">
            <Button
              size="sm"
              onClick={() => onSend()}
              disabled={sending || !input.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              Plan
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-3 min-h-0"
        >
          {messages.length === 0 && !loadingMessages ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Cpu className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No motion plan</p>
              <p className="text-xs mt-1 max-w-xs">
                Describe a robotics task. The model can return coordinate waypoints for a non-executable preview.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`text-xs rounded-lg p-2.5 ${
                    m.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/40"
                  }`}
                >
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">
                    {m.role}
                  </div>
                  <Markdown content={m.content} className="nox-prose" />
                  {m.role === "assistant" && (
                    <DispatchTrace steps={m.trace || []} />
                  )}
                </div>
              ))}
              {sending && <ThinkingIndicator />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extractMotionPlan(text: string): {
  units: string;
  waypoints: Array<{ label: string; x: number; y: number; z: number }>;
  warnings: string[];
  invalid: boolean;
} | null {
  const block = text.match(/```nox-robotics\s*([\s\S]*?)```/i);
  if (!block) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(block[1]);
  } catch {
    return { units: "units", waypoints: [], warnings: [], invalid: true };
  }
  if (!payload || typeof payload !== "object" || !("waypoints" in payload) || !Array.isArray(payload.waypoints)) {
    return { units: "units", waypoints: [], warnings: [], invalid: true };
  }

  const units = "units" in payload && typeof payload.units === "string" && payload.units.length <= 16
    ? payload.units
    : "units";
  const waypoints: Array<{ label: string; x: number; y: number; z: number }> = [];
  let invalid = false;
  for (const candidate of payload.waypoints.slice(0, 20)) {
    if (!candidate || typeof candidate !== "object") {
      invalid = true;
      continue;
    }
    const waypoint = candidate as Record<string, unknown>;
    if (
      typeof waypoint.label !== "string" ||
      typeof waypoint.x !== "number" ||
      typeof waypoint.y !== "number" ||
      typeof waypoint.z !== "number" ||
      !Number.isFinite(waypoint.x) ||
      !Number.isFinite(waypoint.y) ||
      !Number.isFinite(waypoint.z)
    ) {
      invalid = true;
      continue;
    }
    waypoints.push({
      label: waypoint.label.slice(0, 80),
      x: waypoint.x,
      y: waypoint.y,
      z: waypoint.z,
    });
  }
  if (payload.waypoints.length > 20) invalid = true;
  const rawWarnings = "safetyWarnings" in payload && Array.isArray(payload.safetyWarnings) ? payload.safetyWarnings : [];
  const warnings = rawWarnings.filter((warning): warning is string => typeof warning === "string").slice(0, 10);
  if (warnings.length !== rawWarnings.length) invalid = true;
  return { units, waypoints, warnings, invalid };
}

function getWaypointPlotPoints(waypoints: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (waypoints.length === 0) return [];
  const minX = Math.min(...waypoints.map((waypoint) => waypoint.x));
  const maxX = Math.max(...waypoints.map((waypoint) => waypoint.x));
  const minY = Math.min(...waypoints.map((waypoint) => waypoint.y));
  const maxY = Math.max(...waypoints.map((waypoint) => waypoint.y));
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return waypoints.map((waypoint) => ({
    x: 60 + ((waypoint.x - minX) / rangeX) * 300,
    y: 30 + (1 - (waypoint.y - minY) / rangeY) * 220,
  }));
}
