"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  PanelLeft,
  Settings2,
  Network,
  Code2,
  Eye,
  Settings2 as GearIcon,
  Cpu,
  Globe,
  Server,
  Bot,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useChat } from "@/hooks/use-chat";
import { useMultiModel } from "@/store/multi-model-store";
import { useConversations } from "@/store/conversations-store";
import {
  SPECIALISTS,
  type SpecialistId,
  type ConnectionType,
  type ModelAssignment,
} from "@/lib/multi-model-types";
import {
  ChatInput,
  ConversationDrawer,
  ConversationSidebar,
  UserMenu,
  AdvancedDialog,
  ConfirmWrapper,
  MessagesArea,
  IconButton,
} from "./shared-chat";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const SPECIALIST_ICONS: Record<
  SpecialistId,
  React.ComponentType<{ className?: string }>
> = {
  planning: Network,
  coding: Code2,
  vision: Eye,
  automation: GearIcon,
  robotics: Cpu,
};

const EXAMPLES = [
  "Plan a login system with OAuth",
  "Build a REST API for a blog",
  "Automate a daily report workflow",
  "Design a robotics pick-and-place pipeline",
];

export function OrchestratorModePage() {
  const router = useRouter();
  const chat = useChat();
  const mm = useMultiModel();
  const convs = useConversations();
  const [rosterOpen, setRosterOpen] = React.useState(false);

  // Ensure mode is ORCHESTRATOR + clear conversation from other modes
  React.useEffect(() => {
    if (mm.loaded && mm.mode !== "ORCHESTRATOR") {
      mm.setMode("ORCHESTRATOR");
      mm.save();
    }
    // Clear any active conversation from Single/Multi modes
    convs.clearActive();
  }, [mm.loaded]);

  const hostAssignment: ModelAssignment = mm.hostConfig || {
    connectionType: "API" as ConnectionType,
    provider: "openai",
    modelName: "gpt-4o-mini",
    status: "untested",
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background nox-aurora">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconButton
              onClick={() => chat.setConvDrawerOpen(true)}
              label="Conversations"
              className="xl:hidden"
            >
              <PanelLeft className="h-4 w-4" />
            </IconButton>
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Modes</span>
            </button>
            <div className="flex items-center gap-2 ml-1">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center">
                <Network className="h-3.5 w-3.5 text-background" />
              </div>
              <div className="leading-none">
                <div className="font-semibold text-sm">Orchestrator Mode</div>
                <div className="text-[10px] text-muted-foreground">
                  Host routes to specialists
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton
              onClick={() => setRosterOpen(true)}
              label="Roster"
              className="lg:hidden"
            >
              <Network className="h-4 w-4" />
            </IconButton>
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

      {/* Body: roster sidebar + chat */}
      <div className="flex-1 mx-auto w-full max-w-7xl px-3 sm:px-4 py-4 flex gap-4 min-h-0">
        <ConversationSidebar breakpoint="xl" />

        {/* Roster sidebar (desktop) */}
        <aside className="hidden lg:flex w-72 shrink-0 flex-col gap-2 overflow-y-auto nox-scroll">
          <RosterSidebar
            hostAssignment={hostAssignment}
            specialistConfigs={mm.specialistConfigs}
            onConfigure={() => chat.setAdvancedOpen(true)}
          />
        </aside>

        {/* Roster sidebar (mobile/tablet — same content, in a sheet) */}
        <Sheet open={rosterOpen} onOpenChange={setRosterOpen}>
          <SheetContent side="left" className="w-72 p-3 gap-2 overflow-y-auto nox-scroll">
            <SheetTitle className="text-sm">Host &amp; Specialists</SheetTitle>
            <RosterSidebar
              hostAssignment={hostAssignment}
              specialistConfigs={mm.specialistConfigs}
              onConfigure={() => {
                setRosterOpen(false);
                chat.setAdvancedOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>

        {/* Chat area */}
        <main className="flex-1 flex flex-col gap-3 min-h-0">
          <MessagesArea
            scrollRef={chat.scrollRef}
            messages={chat.convs.activeMessages}
            sending={chat.sending}
            loadingMessages={chat.convs.loadingMessages}
            welcomeProps={{
              examples: EXAMPLES,
              onPick: (t) => chat.setInput(t),
              mode: "ORCHESTRATOR",
              subtitle:
                "Orchestrator Mode — Host reads your prompt, routes to a specialist, synthesizes the reply.",
            }}
          />
          <ChatInput
            input={chat.input}
            setInput={chat.setInput}
            onSend={(image) => chat.sendMessage(chat.input, false, undefined, image)}
            sending={chat.sending}
            placeholder="Message the Host… (try: plan a login system)"
          />
        </main>
      </div>

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
        classification={chat.confirmClassification}
        onHostHandleDirectly={chat.onConfirmHostDirectly}
        onOpenSettings={() => {
          chat.setConfirmOpen(false);
          chat.setAdvancedOpen(true);
          chat.setPendingText(null);
        }}
      />
    </div>
  );
}

// Roster sidebar — Host + 5 specialists compact display
function RosterSidebar({
  hostAssignment,
  specialistConfigs,
  onConfigure,
}: {
  hostAssignment: ModelAssignment;
  specialistConfigs: Partial<Record<SpecialistId, ModelAssignment>>;
  onConfigure: () => void;
}) {
  return (
    <>
      {/* Host card */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Network className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">Host</span>
              <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                Router
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Reads intent · synthesizes
            </div>
          </div>
        </div>
        <ModelLine assignment={hostAssignment} />
      </div>

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mt-2 mb-1">
        Specialists
      </div>

      {/* Specialist cards */}
      {SPECIALISTS.map((s) => {
        const Icon = SPECIALIST_ICONS[s.id];
        const a: ModelAssignment = specialistConfigs[s.id] || {
          connectionType: "API" as ConnectionType,
          provider: "openai",
          modelName: "gpt-4o-mini",
          status: "untested",
        };
        return (
          <div
            key={s.id}
            className="rounded-xl border border-border bg-card/40 p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-muted/60 flex items-center justify-center">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {s.description}
                </div>
              </div>
            </div>
            <ModelLine assignment={a} />
          </div>
        );
      })}

      <button
        onClick={onConfigure}
        className="mt-2 w-full text-xs text-primary hover:underline py-2"
      >
        Configure all roles →
      </button>
    </>
  );
}

function ModelLine({ assignment }: { assignment: ModelAssignment }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <span className="text-foreground truncate">{assignment.modelName}</span>
      <span className="text-muted-foreground shrink-0">{assignment.provider}</span>
      <span
        className={cn(
          "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium",
          assignment.connectionType === "API"
            ? "bg-foreground/10 text-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {assignment.connectionType === "API" ? (
          <span className="flex items-center gap-0.5">
            <Globe className="h-2.5 w-2.5" /> API
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <Server className="h-2.5 w-2.5" /> LOCAL
          </span>
        )}
      </span>
    </div>
  );
}
