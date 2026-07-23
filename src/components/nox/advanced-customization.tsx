"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Layers,
  Network,
  Save,
  RotateCcw,
  Download,
  Upload,
  Bot,
  Code2,
  Eye,
  Mic,
  Cpu,
  Settings2,
  Server,
  Clock,
  Info,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FEATURES,
  SPECIALISTS,
  type Mode,
  type FeatureId,
  type SpecialistId,
  type ModelAssignment,
  type ConnectionType,
} from "@/lib/multi-model-types";
import { useMultiModel } from "@/store/multi-model-store";
import { ModelConfigFields } from "./model-config-fields";

interface Provider {
  id: string;
  label: string;
  connectionType: ConnectionType;
  defaultModel: string;
  models: string[];
}

const FEATURE_ICONS: Record<FeatureId, React.ComponentType<{ className?: string }>> = {
  chat: Bot,
  voice: Mic,
  vision: Eye,
  coding: Code2,
  automation: Settings2,
  robotics: Cpu,
};

const SPECIALIST_ICONS: Record<SpecialistId, React.ComponentType<{ className?: string }>> = {
  planning: Network,
  coding: Code2,
  vision: Eye,
  automation: Settings2,
  robotics: Cpu,
};

const MODES: { id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: "SINGLE", label: "Single", icon: Globe, desc: "One model for all features" },
  { id: "MULTI", label: "Multi", icon: Layers, desc: "Different model per feature" },
  { id: "ORCHESTRATOR", label: "Orchestrator", icon: Network, desc: "Host routes tasks to specialists" },
];

function defaultAssignment(connectionType: ConnectionType = "API"): ModelAssignment {
  return {
    connectionType,
    provider: connectionType === "API" ? "openai" : "ollama",
    modelName: connectionType === "API" ? "gpt-4o-mini" : "llama3.1:8b",
    status: "untested",
  };
}

export function AdvancedCustomization() {
  const store = useMultiModel();
  const [providers, setProviders] = React.useState<Provider[]>([]);

  React.useEffect(() => {
    store.load();
    fetch("/api/multi-model/providers")
      .then((r) => r.json())
      .then((j) => j.ok && setProviders(j.providers));
    // store is a stable zustand hook; only run on mount.
  }, []);

  const handleSave = async () => {
    const ok = await store.save();
    if (ok) toast.success("Configuration saved", { description: "API keys encrypted at rest." });
    else toast.error("Save failed");
  };

  const handleExport = async () => {
    const doc = await store.exportConfig();
    if (!doc) {
      toast.error("Export failed");
      return;
    }
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nox-multi-model-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported configuration");
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const doc = JSON.parse(text);
        const ok = await store.importConfig(doc);
        if (ok) toast.success("Configuration imported");
        else toast.error("Import failed");
      } catch {
        toast.error("Invalid file");
      }
    };
    input.click();
  };

  const handleReset = async () => {
    await store.reset();
    toast.success("Reset to defaults");
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Advanced Customization</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Multi-Model Combination — assign models per feature, or let a host model orchestrate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {store.dirty && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
          {store.lastSavedAt && !store.dirty && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODES.map((m) => {
          const active = store.mode === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => store.setMode(m.id)}
              className={`relative text-left rounded-xl border p-4 transition group ${
                active
                  ? "border-primary bg-primary/10 nox-glow-sm"
                  : "border-border bg-muted/30 hover:bg-muted/60"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="font-medium text-sm">{m.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {m.desc}
              </p>
              {active && (
                <motion.div
                  layoutId="mode-active"
                  className="absolute inset-0 rounded-xl ring-1 ring-primary/40 pointer-events-none"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Mode content */}
      <AnimatePresence mode="wait">
        {store.mode === "SINGLE" && (
          <motion.div
            key="global"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="p-5 bg-card/60 backdrop-blur border-border">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="h-4 w-4 text-primary" />
                <h3 className="font-medium">Single Model</h3>
                <span className="text-xs text-muted-foreground">
                  — used for all 6 features
                </span>
              </div>
              <ModelConfigFields
                roleId="global"
                assignment={store.globalConfig || defaultAssignment()}
                onChange={store.setGlobal}
                providers={providers}
                testState={store.tests["global"]}
              />
            </Card>
          </motion.div>
        )}

        {store.mode === "MULTI" && (
          <motion.div
            key="per-feature"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-3"
          >
            {FEATURES.map((f) => {
              const Icon = FEATURE_ICONS[f.id];
              const a = store.featureConfigs[f.id] || defaultAssignment();
              return (
                <Card key={f.id} className="p-4 bg-card/60 backdrop-blur border-border">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm">{f.label}</h3>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {f.description}
                      </p>
                    </div>
                  </div>
                  <ModelConfigFields
                    roleId={f.id}
                    assignment={a}
                    onChange={(na) => store.setFeature(f.id, na)}
                    providers={providers}
                    testState={store.tests[f.id]}
                  />
                </Card>
              );
            })}
          </motion.div>
        )}

        {store.mode === "ORCHESTRATOR" && (
          <motion.div
            key="host"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            <Card className="p-5 bg-primary/5 border-primary/40 nox-glow-sm">
              <div className="flex items-start gap-3 mb-4">
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                  <Network className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Host Model</h3>
                    <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                      Router
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Reads the prompt, decides intent, routes to a specialist, synthesizes the final reply.
                  </p>
                </div>
              </div>
              <ModelConfigFields
                roleId="host"
                assignment={store.hostConfig || defaultAssignment()}
                onChange={store.setHost}
                providers={providers}
                testState={store.tests["host"]}
              />
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {SPECIALISTS.map((s) => {
                const Icon = SPECIALIST_ICONS[s.id];
                const a = store.specialistConfigs[s.id] || defaultAssignment();
                return (
                  <Card key={s.id} className="p-4 bg-card/60 backdrop-blur border-border">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-sm">{s.label}</h3>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {s.description}
                        </p>
                      </div>
                    </div>
                    <ModelConfigFields
                      roleId={s.id}
                      assignment={a}
                      onChange={(na) => store.setSpecialist(s.id, na)}
                      providers={providers}
                      testState={store.tests[s.id]}
                    />
                  </Card>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeout overrides */}
      <Card className="p-4 bg-card/40 border-border">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">Timeout Overrides</h3>
          <span className="text-[11px] text-muted-foreground">
            — per connection type (ms). Heartbeat + capped retry (2) handled automatically.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Server className="h-3 w-3" /> Local CLI
            </Label>
            <Input
              type="number"
              className="h-9"
              value={store.timeoutOverrides.LOCAL ?? 60000}
              onChange={(e) =>
                store.setTimeoutOverride("LOCAL", parseInt(e.target.value) || 60000)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> API
            </Label>
            <Input
              type="number"
              className="h-9"
              value={store.timeoutOverrides.API ?? 30000}
              onChange={(e) =>
                store.setTimeoutOverride("API", parseInt(e.target.value) || 30000)
              }
            />
          </div>
        </div>
      </Card>

      <Separator />

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          <span>
            Save is blocked when any tested connection is in an error state.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleImport}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={store.saving || !store.dirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {store.saving ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
