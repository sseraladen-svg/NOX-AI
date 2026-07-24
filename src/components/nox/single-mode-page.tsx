"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  PanelLeft,
  Settings2,
  Globe,
  Server,
  Clock,
  Bot,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useChat } from "@/hooks/use-chat";
import { useMultiModel } from "@/store/multi-model-store";
import type { ConnectionType, ModelAssignment } from "@/lib/multi-model-types";
import {
  ChatInput,
  ConversationDrawer,
  UserMenu,
  AdvancedDialog,
  ConfirmWrapper,
  MessagesArea,
  IconButton,
} from "./shared-chat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const EXAMPLES = [
  "Explain quantum computing simply",
  "Write a haiku about the ocean",
  "What's the capital of Brazil?",
  "Give me 5 productivity tips",
];

export function SingleModePage() {
  const router = useRouter();
  const chat = useChat();
  const mm = useMultiModel();

  // Ensure mode is SINGLE
  React.useEffect(() => {
    if (mm.loaded && mm.mode !== "SINGLE") {
      mm.setMode("SINGLE");
      mm.save();
    }
  }, [mm.loaded]);

  const assignment = mm.globalConfig || {
    connectionType: "API" as ConnectionType,
    provider: "openai",
    modelName: "gpt-4o-mini",
    status: "untested" as const,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background nox-aurora">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-4xl px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconButton onClick={() => setConvDrawerOpen(true)} label="Conversations">
              <PanelLeft className="h-4 w-4" />
            </IconButton>
            <button
              onClick={() => router.push("/?mode=")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Modes</span>
            </button>
            <div className="flex items-center gap-2 ml-1">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Globe className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="leading-none">
                <div className="font-semibold text-sm">Single Mode</div>
                <div className="text-[10px] text-muted-foreground">
                  One model for everything
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton
              onClick={() => chat.setAdvancedOpen(true)}
              label="Advanced settings"
            >
              <Settings2 className="h-4 w-4" />
            </IconButton>
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Inline model strip */}
      <div className="mx-auto w-full max-w-4xl px-3 sm:px-4 pt-4">
        <ModelStrip
          assignment={assignment}
          onConfigure={() => chat.setAdvancedOpen(true)}
        />
      </div>

      {/* Chat area */}
      <main className="flex-1 mx-auto w-full max-w-4xl px-3 sm:px-4 py-4 flex flex-col gap-3 min-h-0">
        <MessagesArea
          scrollRef={chat.scrollRef}
          messages={chat.convs.activeMessages}
          sending={chat.sending}
          loadingMessages={chat.convs.loadingMessages}
          welcomeProps={{
            examples: EXAMPLES,
            onPick: (t) => chat.setInput(t),
            mode: "SINGLE",
            subtitle: "One model handles everything. Configure it above.",
          }}
        />
        <ChatInput
          input={chat.input}
          setInput={chat.setInput}
          onSend={() => chat.sendMessage(chat.input)}
          sending={chat.sending}
          placeholder="Message your single model…"
        />
      </main>

      <ConversationDrawer
        open={chat.convDrawerOpen}
        onClose={() => chat.setConvDrawerOpen(false)}
      />
      <AdvancedDialog
        open={chat.advancedOpen}
        onOpenChange={chat.setAdvancedOpen}
      />
      <ConfirmWrapper
        open={chat.confirmOpen}
        limits={chat.confirmLimits}
        mode={mm.mode}
        onContinue={chat.onConfirmContinue}
        onCancel={() => {
          chat.setConfirmOpen(false);
          chat.setPendingText(null);
        }}
        onSwitchToSingle={chat.onConfirmSwitchToSingle}
        onOpenSettings={() => {
          chat.setConfirmOpen(false);
          chat.setAdvancedOpen(true);
          chat.setPendingText(null);
        }}
      />
    </div>
  );
}

// Inline compact model display
function ModelStrip({
  assignment,
  onConfigure,
}: {
  assignment: ModelAssignment;
  onConfigure: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-xs text-muted-foreground">Active model</div>
          <div className="text-sm font-medium font-mono">
            {assignment.modelName}
          </div>
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {assignment.provider}
        </Badge>
        <Badge
          variant="outline"
          className={
            assignment.connectionType === "API"
              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
          }
        >
          {assignment.connectionType === "API" ? (
            <>
              <Globe className="h-3 w-3 mr-1" /> API
            </>
          ) : (
            <>
              <Server className="h-3 w-3 mr-1" /> LOCAL
            </>
          )}
        </Badge>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {assignment.connectionType === "API" ? "30s" : "60s"} timeout
        </span>
        <button onClick={onConfigure} className="text-primary hover:underline">
          Configure
        </button>
      </div>
    </div>
  );
}
