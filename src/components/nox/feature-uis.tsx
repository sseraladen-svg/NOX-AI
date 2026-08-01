"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  User as UserIcon,
  Send,
  Loader2,
  Sparkles,
  ChevronRight,
  Zap,
  Network,
  RefreshCw,
  Copy,
  Check,
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
  Plus,
  Trash2,
  Workflow,
  Cpu,
  Gauge,
  Radio,
  Activity,
  Wind,
  Battery,
  Settings2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
              <span className="text-fuchsia-400">{s.intent}</span>
            </>
          )}
          <span className="text-muted-foreground ml-auto">{s.latencyMs}ms</span>
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
            <span className="text-cyan-400">
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
        <Badge className="bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30 hover:bg-fuchsia-500/20 text-[9px] py-0 px-1.5">
          <Network className="h-2.5 w-2.5 mr-0.5" />
          Multi-Agent
        </Badge>
      )}
      <span className="uppercase tracking-wider">{msg.mode}</span>
    </div>
  );
}

// ─── 1. CHAT FEATURE — conversational bubbles + markdown ────────────────────

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
              className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center nox-glow mb-4"
            >
              <Bot className="h-7 w-7 text-primary-foreground" />
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
        placeholder="Message the chat model…"
      />
    </div>
  );
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
          placeholder={placeholder}
          className="min-h-[44px] max-h-32 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
          rows={1}
        />
        <Button
          size="icon"
          onClick={() => onSend()}
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

// ─── 2. CODING FEATURE — editor layout with prompt + code output ────────────

export function CodingFeatureUI({
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
  const codeBlocks = lastAssistant ? extractCodeBlocks(lastAssistant.content) : [];
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
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
            placeholder="Describe the code you need…  (⌘/Ctrl+Enter to run)"
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
                  </div>
                  <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto nox-scroll text-foreground/90">
                    <code>{block.code}</code>
                  </pre>
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
    // leave empty — only show fenced blocks
  }
  return blocks;
}

// ─── 3. VOICE FEATURE — mic + transcript + TTS ──────────────────────────────

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
  const [sttSupported, setSttSupported] = React.useState(true);
  const recognitionRef = React.useRef<any>(null);

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

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (recording) {
      recognitionRef.current.stop();
      setRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setRecording(true);
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
    utterance.onend = () => setPlayingId(null);
    utterance.onerror = () => setPlayingId(null);
    window.speechSynthesis.speak(utterance);
    setPlayingId(msgId);
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
            {recording ? "Listening…" : sttSupported ? "Tap to speak" : "Speech recognition not supported"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {recording
              ? "Speak now — your speech will be transcribed live"
              : sttSupported
              ? "Browser-native speech-to-text (Chrome/Edge recommended)"
              : "Use Chrome or Edge for microphone support. You can still type below."}
          </div>
          {recording && (
            <div className="flex items-center gap-0.5 mt-2 h-6">
              {Array.from({ length: 24 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-red-400 rounded-full"
                  animate={{ height: [4, 6 + Math.random() * 16, 4] }}
                  transition={{
                    duration: 0.4 + Math.random() * 0.3,
                    repeat: Infinity,
                    delay: i * 0.03,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
                  {m.role === "assistant" && typeof window !== "undefined" && window.speechSynthesis && (
                    <button
                      onClick={() => togglePlay(m.id, m.content)}
                      className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    >
                      {playingId === m.id ? (
                        <>
                          <Pause className="h-3 w-3" /> Stop
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3" /> Play
                        </>
                      )}
                    </button>
                  )}
                </div>
                <Markdown content={m.content} className="nox-prose" />
                {m.role === "assistant" && playingId === m.id && (
                  <div className="flex items-center gap-0.5 mt-2 h-4">
                    {Array.from({ length: 30 }).map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-0.5 bg-primary rounded-full"
                        animate={{ height: [3, 10 + Math.random() * 8, 3] }}
                        transition={{
                          duration: 0.3 + Math.random() * 0.2,
                          repeat: Infinity,
                          delay: i * 0.02,
                        }}
                      />
                    ))}
                  </div>
                )}
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
        placeholder="Or type text to send…"
      />
    </div>
  );
}

// ─── 4. VISION FEATURE — image upload + analysis ────────────────────────────

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
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      // Extract base64 data + mime type from the data URL.
      // data:image/jpeg;base64,/9j/4AAQ... → { data: "/9j/4AAQ...", mimeType: "image/jpeg" }
      const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        setImageData({ mimeType: match[1], data: match[2] });
      }
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setPreview(null);
    setImageData(null);
  };

  const handleAnalyze = () => {
    onSend(imageData || undefined);
    // Clear the image after sending so the user can upload a new one.
    clearImage();
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
          onClick={() => fileRef.current?.click()}
          className={`flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition min-h-[200px] ${
            dragOver
              ? "border-primary bg-primary/10"
              : "border-border bg-card/30 hover:bg-card/50"
          }`}
        >
          {preview ? (
            <div className="relative w-full h-full p-2">
              <img
                src={preview}
                alt="Upload preview"
                className="w-full h-full object-contain rounded-lg"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearImage();
                }}
                className="absolute top-3 right-3 h-7 w-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
              >
                <X className="h-4 w-4" />
              </button>
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
        {preview && (
          <div className="text-[10px] text-muted-foreground text-center">
            Image attached — ask the vision model to analyze it
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
            placeholder="Ask about the image… (e.g. 'What objects are in this photo?')"
            className="min-h-[44px] max-h-24 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
            rows={2}
          />
          <div className="flex justify-end mt-1">
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={sending || !input.trim()}
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

// ─── 5. AUTOMATION FEATURE — workflow node canvas ───────────────────────────

export function AutomationFeatureUI({
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
  const steps = lastAssistant ? extractWorkflowSteps(lastAssistant.content) : [];

  // Interactive workflow state — each step can be checked off
  const [checkedSteps, setCheckedSteps] = React.useState<Set<number>>(new Set());
  const [running, setRunning] = React.useState(false);

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

  // Simulate running the workflow step by step
  const runWorkflow = async () => {
    setRunning(true);
    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, 800));
      setCheckedSteps((prev) => new Set(prev).add(i));
    }
    setRunning(false);
  };

  const completedCount = checkedSteps.size;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

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
          {steps.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={runWorkflow}
              disabled={running}
              className="h-7 text-xs"
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {running ? "Running..." : "Run All"}
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-emerald-500"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-4 min-h-0">
          {steps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Workflow className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No workflow yet</p>
              <p className="text-xs mt-1 max-w-xs">
                Describe an automation task (e.g. &ldquo;Daily report pipeline&rdquo;).
                The AI will break it into steps you can check off and run.
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
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition ${
                          isChecked
                            ? "bg-emerald-500/20 border border-emerald-500/40"
                            : "bg-primary/15 border border-primary/30 hover:bg-primary/25"
                        }`}
                      >
                        {isChecked ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <span className="text-xs font-mono text-primary">{i + 1}</span>
                        )}
                      </button>
                      <div
                        className={`flex-1 rounded-lg border px-3 py-2 transition ${
                          isChecked
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-card/60"
                        }`}
                      >
                        <div className={`text-sm font-medium ${isChecked ? "line-through text-muted-foreground" : ""}`}>
                          {step.name}
                        </div>
                        {step.detail && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {step.detail}
                          </div>
                        )}
                      </div>
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
            placeholder="Describe the workflow to automate…  (⌘/Ctrl+Enter)"
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
              Conversation appears here.
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

function extractWorkflowSteps(text: string): { name: string; detail?: string }[] {
  // Try to parse numbered steps from the response
  const steps: { name: string; detail?: string }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+[\.\)]|[-*•])\s+\*\*([^*]+)\*\*:?\s*(.*)/);
    if (m) {
      steps.push({ name: m[1].trim(), detail: m[2].trim() || undefined });
      continue;
    }
    const m2 = line.match(/^\s*(?:\d+[\.\)]|[-*•])\s+(.+)/);
    if (m2) {
      steps.push({ name: m2[1].trim().split(/[.:—–]/)[0] });
    }
  }
  return steps.slice(0, 12);
}

// ─── 6. ROBOTICS FEATURE — sensor grid + motion plan ────────────────────────

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

  // Interactive joint sliders — user can manually control the arm
  const jointNames = ["Base", "Shoulder", "Elbow", "Wrist", "Gripper"];
  const [jointAngles, setJointAngles] = React.useState<number[]>([45, 30, 60, 90, 0]);
  const [executing, setExecuting] = React.useState(false);
  const [activeWaypoint, setActiveWaypoint] = React.useState(-1);

  // Simulate executing the motion plan — animates joints through waypoints
  const executePlan = async () => {
    if (!plan || plan.waypoints.length === 0) return;
    setExecuting(true);
    for (let i = 0; i < plan.waypoints.length; i++) {
      setActiveWaypoint(i);
      // Animate joints to a new position for each waypoint
      const newAngles = jointNames.map((_, j) => {
        const base = jointAngles[j];
        const variation = Math.sin((i + 1) * (j + 1)) * 30;
        return Math.max(0, Math.min(180, Math.round(base + variation)));
      });
      setJointAngles(newAngles);
      await new Promise((r) => setTimeout(r, 1200));
    }
    setActiveWaypoint(-1);
    setExecuting(false);
  };

  const setJoint = (index: number, value: number) => {
    setJointAngles((prev) => prev.map((v, i) => (i === index ? value : v)));
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1">
      {/* Left: interactive sensor + joint control */}
      <div className="lg:w-1/2 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Robot Control
            </span>
          </div>
          {plan && plan.waypoints.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={executePlan}
              disabled={executing}
              className="h-7 text-xs"
            >
              {executing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {executing ? "Executing..." : "Execute Plan"}
            </Button>
          )}
        </div>

        {/* Live sensor cards */}
        <div className="grid grid-cols-2 gap-2">
          <SensorCard icon={Battery} label="Power" value={`${100 - Math.round(jointAngles.reduce((a,b)=>a+b,0) / 10)}%`} color="emerald" />
          <SensorCard icon={Activity} label="CPU" value={`${30 + Math.round(jointAngles[2] / 3)}%`} color="cyan" />
          <SensorCard icon={Wind} label="Temp" value={`${35 + Math.round(jointAngles[1] / 4)}°C`} color="amber" />
          <SensorCard icon={Radio} label="Signal" value="Strong" color="violet" />
        </div>

        {/* Interactive joint sliders */}
        <div className="flex-1 overflow-y-auto nox-scroll rounded-xl border border-border bg-card/20 p-3 min-h-0">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-muted-foreground uppercase tracking-wider">
            <Gauge className="h-3 w-3" />
            Joint Control — drag to move
          </div>
          <div className="space-y-2.5">
            {jointNames.map((joint, i) => (
              <div key={joint} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{joint}</span>
                  <span className="font-mono text-primary">{jointAngles[i]}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={180}
                  value={jointAngles[i]}
                  onChange={(e) => setJoint(i, parseInt(e.target.value))}
                  disabled={executing}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-muted
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:w-4
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-primary
                    [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-webkit-slider-thumb]:disabled:opacity-50"
                  style={{
                    background: `linear-gradient(to right, oklch(0.7 0.22 295) ${jointAngles[i] / 1.8}%, oklch(0.22 0.025 285) ${jointAngles[i] / 1.8}%)`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border/60">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-mono">TCP:</span>
              <span>
                X: {Math.round(Math.cos(jointAngles[0] * Math.PI / 180) * (jointAngles[1] + jointAngles[2]))}mm,
                Y: {Math.round(Math.sin(jointAngles[0] * Math.PI / 180) * (jointAngles[1] + jointAngles[2]))}mm,
                Z: {jointAngles[3]}mm
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: motion plan + prompt */}
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
            placeholder="Describe the motion task… (e.g. 'Pick and place cup')"
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
          {!plan && messages.length === 0 && !loadingMessages ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Cpu className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No motion plan</p>
              <p className="text-xs mt-1 max-w-xs">
                Describe a robotics task and the AI will generate a motion plan
                with waypoints. Then click Execute Plan to animate the arm.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {plan && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5 mb-2 text-[10px] text-primary uppercase tracking-wider font-medium">
                    <Network className="h-3 w-3" />
                    Motion Plan
                  </div>
                  <div className="space-y-1">
                    {plan.waypoints.map((wp, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.12 }}
                        className={`flex items-center gap-2 text-xs rounded px-2 py-1 transition ${
                          activeWaypoint === i
                            ? "bg-primary/20 border border-primary/30"
                            : ""
                        }`}
                      >
                        <span className={`h-5 w-5 rounded-full flex items-center justify-center font-mono text-[10px] ${
                          activeWaypoint === i
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/20 text-primary"
                        }`}>
                          {i + 1}
                        </span>
                        <span className="flex-1">{wp}</span>
                        {activeWaypoint === i && (
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
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
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {m.content}
                  </div>
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

function SensorCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: "emerald" | "cyan" | "amber" | "violet";
}) {
  const colorMap = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  };
  return (
    <div className={`rounded-lg border p-2.5 ${colorMap[color]}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-wider opacity-80">
          {label}
        </span>
      </div>
      <div className="text-sm font-mono font-medium">{value}</div>
    </div>
  );
}

function extractMotionPlan(text: string): {
  waypoints: string[];
  joints?: number[];
} | null {
  const waypoints: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+[\.\)]|[-*•])\s+(.+)/);
    if (m && m[1].length < 120) {
      waypoints.push(m[1].trim());
    }
  }
  return waypoints.length > 0 ? { waypoints: waypoints.slice(0, 8) } : null;
}
