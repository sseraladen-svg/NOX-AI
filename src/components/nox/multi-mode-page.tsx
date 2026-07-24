"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  PanelLeft,
  Settings2,
  Layers,
  Bot,
  Mic,
  Eye,
  Code2,
  Settings2 as GearIcon,
  Cpu,
  Globe,
  Server,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useChat } from "@/hooks/use-chat";
import { useMultiModel } from "@/store/multi-model-store";
import {
  FEATURES,
  type FeatureId,
  type ConnectionType,
  type ModelAssignment,
} from "@/lib/multi-model-types";
import {
  ChatInput,
  ConversationDrawer,
  UserMenu,
  AdvancedDialog,
  ConfirmWrapper,
  MessagesArea,
  IconButton,
} from "./shared-chat";
import { cn } from "@/lib/utils";

const FEATURE_ICONS: Record<
  FeatureId,
  React.ComponentType<{ className?: string }>
> = {
  chat: Bot,
  voice: Mic,
  vision: Eye,
  coding: Code2,
  automation: GearIcon,
  robotics: Cpu,
};

const EXAMPLES_BY_FEATURE: Record<FeatureId, string[]> = {
  chat: ["Explain quantum computing", "What's the capital of Brazil?", "Write a haiku about the ocean"],
  voice: ["Transcribe this audio sample", "Generate speech from this text", "What's STT vs TTS?"],
  vision: ["Describe what's in this photo", "Read the text in this image", "Identify the objects here"],
  coding: ["Write a regex for emails", "Fix this Python bug", "Explain async/await"],
  automation: ["Automate a daily report", "Build a CI/CD pipeline", "Chain these 3 APIs"],
  robotics: ["Plan a pick-and-place motion", "Sensor fusion strategy", "PID controller tuning"],
};

export function MultiModePage() {
  const router = useRouter();
  const chat = useChat();
  const mm = useMultiModel();
  const [activeFeature, setActiveFeature] = React.useState<FeatureId>("chat");

  // Ensure mode is MULTI
  React.useEffect(() => {
    if (mm.loaded && mm.mode !== "MULTI") {
      mm.setMode("MULTI");
      mm.save();
    }
  }, [mm.loaded]);

  const assignment: ModelAssignment =
    mm.featureConfigs[activeFeature] || {
      connectionType: "API" as ConnectionType,
      provider: "openai",
      modelName: "gpt-4o-mini",
      status: "untested",
    };

  return (
    <div className="min-h-screen flex flex-col bg-background nox-aurora">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-5xl px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconButton
              onClick={() => chat.setConvDrawerOpen(true)}
              label="Conversations"
            >
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
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-cyan-500 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="leading-none">
                <div className="font-semibold text-sm">Multi Mode</div>
                <div className="text-[10px] text-muted-foreground">
                  Right model for each job
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

      {/* Feature tabs */}
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-4 pt-4">
        <div className="flex items-center gap-1.5 overflow-x-auto nox-scroll pb-1">
          {FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.id];
            const active = activeFeature === f.id;
            const has = !!mm.featureConfigs[f.id];
            return (
              <button
                key={f.id}
                onClick={() => setActiveFeature(f.id)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {f.label}
                {has && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active feature model strip */}
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-4 pt-3">
        <FeatureModelStrip
          featureId={activeFeature}
          assignment={assignment}
          onConfigure={() => chat.setAdvancedOpen(true)}
        />
      </div>

      {/* Chat area */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-3 sm:px-4 py-4 flex flex-col gap-3 min-h-0">
        <MessagesArea
          scrollRef={chat.scrollRef}
          messages={chat.convs.activeMessages}
          sending={chat.sending}
          loadingMessages={chat.convs.loadingMessages}
          welcomeProps={{
            examples: EXAMPLES_BY_FEATURE[activeFeature],
            onPick: (t) => chat.setInput(t),
            mode: "MULTI",
            subtitle: `Multi Mode — prompts route to the ${activeFeature} feature's model. Switch features above.`,
          }}
        />
        <ChatInput
          input={chat.input}
          setInput={chat.setInput}
          onSend={() => chat.sendMessage(chat.input)}
          sending={chat.sending}
          placeholder={`Message the ${activeFeature} model…`}
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

function FeatureModelStrip({
  featureId,
  assignment,
  onConfigure,
}: {
  featureId: FeatureId;
  assignment: ModelAssignment;
  onConfigure: () => void;
}) {
  const feature = FEATURES.find((f) => f.id === featureId)!;
  const Icon = FEATURE_ICONS[featureId];
  return (
    <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-xs text-muted-foreground">
            {feature.label} feature
          </div>
          <div className="text-sm font-medium font-mono">
            {assignment.modelName}
          </div>
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          {assignment.provider}
        </span>
        <span
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-medium",
            assignment.connectionType === "API"
              ? "bg-cyan-500/10 text-cyan-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          {assignment.connectionType === "API" ? (
            <span className="flex items-center gap-1">
              <Globe className="h-2.5 w-2.5" /> API
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Server className="h-2.5 w-2.5" /> LOCAL
            </span>
          )}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground hidden sm:block">
        {feature.description}
      </p>
      <button
        onClick={onConfigure}
        className="ml-auto text-primary hover:underline text-xs"
      >
        Configure
      </button>
    </div>
  );
}
