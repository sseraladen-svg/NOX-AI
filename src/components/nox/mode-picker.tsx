"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Globe, Layers, Network, ChevronRight, Sparkles, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMultiModel } from "@/store/multi-model-store";
import { UserMenu } from "./shared-chat";
import type { Mode } from "@/lib/multi-model-types";

const MODE_CARDS: {
  id: Mode;
  label: string;
  tagline: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  features: string[];
}[] = [
  {
    id: "SINGLE",
    label: "Single",
    tagline: "One model, every task",
    description:
      "Connect one model (API or Local CLI) and use it for all six feature types — chat, voice, vision, coding, automation, robotics. Simplest setup, fastest responses.",
    icon: Globe,
    accent: "from-violet-500 to-fuchsia-500",
    features: [
      "One config card",
      "All features share the model",
      "Single-step dispatch trace",
    ],
  },
  {
    id: "MULTI",
    label: "Multi",
    tagline: "Right model for each job",
    description:
      "Assign a different model to each of the 6 features. Use GPT-4o for chat, Claude for coding, Gemini for vision — each prompt routes to the best-fit model automatically.",
    icon: Layers,
    accent: "from-fuchsia-500 to-cyan-500",
    features: [
      "6 independent feature cards",
      "Per-feature provider + connection",
      "Intent-based routing",
    ],
  },
  {
    id: "ORCHESTRATOR",
    label: "Orchestrator",
    tagline: "Host routes to specialists",
    description:
      "A Host model reads your prompt, decides what kind of task it is, routes it to the right specialist (planning, coding, vision, automation, robotics), then synthesizes the final reply.",
    icon: Network,
    accent: "from-cyan-500 to-emerald-500",
    features: [
      "Host + 5 specialist cards",
      "Multi-agent confirmation flow",
      "3-step pipeline: analyze → specialist → synthesize",
    ],
  },
];

export function ModePicker() {
  const router = useRouter();
  const mm = useMultiModel();

  const enterMode = async (mode: Mode) => {
    mm.setMode(mode);
    await mm.save();
    router.push(`/?mode=${mode.toLowerCase()}`);
  };

  return (
    <div className="min-h-screen bg-background nox-aurora">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center nox-glow-sm">
              <span className="text-primary-foreground font-bold text-sm">
                N
              </span>
            </div>
            <div className="leading-none">
              <div className="font-semibold tracking-tight">NOX AI</div>
              <div className="text-[10px] text-muted-foreground">
                Choose your mode
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/?view=usage")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Usage</span>
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10 sm:mb-14"
        >
          <div className="mb-4 inline-flex items-center justify-center rounded-full border border-primary/25 bg-primary/5 px-3 py-2 text-primary nox-glow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <h1 className="mb-3 text-3xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Welcome to <span className="nox-text-gradient">NOX AI</span>
          </h1>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Three ways to wield multi-model intelligence. Pick the mode that
            matches your task — you can switch any time.
          </p>
        </motion.div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {MODE_CARDS.map((card, i) => {
            const Icon = card.icon;
            const active = mm.mode === card.id;
            return (
              <motion.button
                key={card.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                onClick={() => enterMode(card.id)}
                className={`group relative text-left rounded-2xl border p-6 transition overflow-hidden ${
                  active
                    ? "border-primary/50 bg-primary/5 nox-glow-sm"
                    : "border-border bg-card/40 hover:bg-card/70 hover:border-primary/30"
                }`}
              >
                {/* Gradient icon */}
                <div
                  className={`h-12 w-12 rounded-xl bg-gradient-to-br ${card.accent} flex items-center justify-center mb-4 nox-glow-sm`}
                >
                  <Icon className="h-6 w-6 text-white" />
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                  <h2 className="text-xl font-semibold">{card.label}</h2>
                  {active && (
                    <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-primary/80 font-medium mb-3">
                  {card.tagline}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {card.description}
                </p>

                <ul className="space-y-1.5 mb-5">
                  {card.features.map((f) => (
                    <li
                      key={f}
                      className="text-xs text-muted-foreground flex items-start gap-2"
                    >
                      <span className="text-primary mt-0.5">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  Enter {card.label} mode
                  <ChevronRight className="h-4 w-4" />
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-muted-foreground mt-10"
        >
          All modes support API Key + Local CLI connections, per-role timeout
          overrides, encrypted API keys, and the multi-agent confirmation flow.
        </motion.p>
      </main>
    </div>
  );
}
