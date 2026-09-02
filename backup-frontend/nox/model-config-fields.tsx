"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Zap } from "lucide-react";
import type { ModelAssignment, ConnectionType } from "@/lib/multi-model-types";
import { useMultiModel, type TestState } from "@/store/multi-model-store";

interface Provider {
  id: string;
  label: string;
  connectionType: ConnectionType;
  defaultModel: string;
  models: string[];
}

interface Props {
  roleId: string; // "global" | feature id | "host" | specialist id
  assignment: ModelAssignment;
  onChange: (a: ModelAssignment) => void;
  providers: Provider[];
  testState?: TestState;
}

export function ModelConfigFields({
  roleId,
  assignment,
  onChange,
  providers,
  testState,
}: Props) {
  const test = useMultiModel((s) => s.test);

  const apiProviders = providers.filter((p) => p.connectionType === "API");
  const localProviders = providers.filter((p) => p.connectionType === "LOCAL");

  const activeModelName =
    assignment.connectionType === "API"
      ? assignment.apiModelName || assignment.modelName || ""
      : assignment.localModelName || assignment.modelName || "";
  const activeEndpoint =
    assignment.connectionType === "API"
      ? assignment.apiEndpoint || assignment.endpoint || ""
      : assignment.localEndpoint || assignment.endpoint || "";

  function updateActiveState(next: ModelAssignment) {
    const nextModel = next.modelName || "";
    const nextApiModel = next.connectionType === "API" ? nextModel : next.apiModelName || next.modelName || "";
    const nextLocalModel = next.connectionType === "LOCAL" ? nextModel : next.localModelName || next.modelName || "";
    const nextApiEndpoint = next.connectionType === "API" ? next.endpoint || next.apiEndpoint || "" : next.apiEndpoint || next.endpoint || "";
    const nextLocalEndpoint = next.connectionType === "LOCAL" ? next.endpoint || next.localEndpoint || "" : next.localEndpoint || next.endpoint || "";

    onChange({
      ...next,
      modelName: nextModel,
      apiModelName: nextApiModel,
      localModelName: nextLocalModel,
      apiEndpoint: nextApiEndpoint,
      localEndpoint: nextLocalEndpoint,
      endpoint: next.connectionType === "API" ? nextApiEndpoint : nextLocalEndpoint,
    });
  }

  function setConnectionType(ct: ConnectionType) {
    const candidates = ct === "API" ? apiProviders : localProviders;
    const p = candidates[0];
    const nextProvider = p?.id || assignment.provider;
    const nextModel =
      ct === "API"
        ? assignment.apiModelName || assignment.modelName || p?.defaultModel || ""
        : assignment.localModelName || assignment.modelName || p?.defaultModel || "";
    const nextEndpoint =
      ct === "API"
        ? assignment.apiEndpoint || assignment.endpoint || ""
        : assignment.localEndpoint || assignment.endpoint || (nextProvider === "ollama" ? "http://127.0.0.1:11434" : "");

    updateActiveState({
      ...assignment,
      connectionType: ct,
      provider: nextProvider,
      modelName: nextModel,
      endpoint: nextEndpoint,
    });
  }

  function setProvider(id: string) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;

    const nextModel =
      assignment.connectionType === "API"
        ? assignment.apiModelName || assignment.modelName || p.defaultModel
        : assignment.localModelName || assignment.modelName || p.defaultModel;
    const nextEndpoint =
      assignment.connectionType === "API"
        ? assignment.apiEndpoint || assignment.endpoint || ""
        : assignment.localEndpoint || assignment.endpoint || (id === "ollama" ? "http://127.0.0.1:11434" : "");

    updateActiveState({
      ...assignment,
      provider: id,
      modelName: nextModel,
      connectionType: p.connectionType,
      endpoint: nextEndpoint,
    });
  }

  const currentProvider = providers.find((p) => p.id === assignment.provider);
  const currentModelName = assignment.connectionType === "API" ? assignment.apiModelName || assignment.modelName : assignment.localModelName || assignment.modelName;
  const knownModel = currentProvider?.models.includes(currentModelName) ?? false;
  const [customMode, setCustomMode] = React.useState(!knownModel);

  React.useEffect(() => {
    const nextCustomMode = Boolean(currentProvider) && currentModelName.trim().length > 0 && !knownModel;
    setCustomMode(nextCustomMode);
  }, [currentProvider?.id, currentModelName, knownModel]);

  return (
    <div className="space-y-3">
      {/* Connection type toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setConnectionType("API")}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
            assignment.connectionType === "API"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
          }`}
        >
          API Key
        </button>
        <button
          type="button"
          onClick={() => setConnectionType("LOCAL")}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
            assignment.connectionType === "LOCAL"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
          }`}
        >
          Local CLI
        </button>
      </div>

      {/* Provider */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Provider</Label>
        <Select value={assignment.provider} onValueChange={setProvider}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignment.connectionType === "API"
              ? apiProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))
              : localProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model name (with known-models dropdown) */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Model</Label>
        {!customMode ? (
          currentProvider && currentProvider.models.length > 1 ? (
            <Select
              value={currentModelName}
              onValueChange={(v) => {
                if (v === "__custom__") {
                  setCustomMode(true);
                  return;
                }
                updateActiveState({ ...assignment, modelName: v });
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currentProvider.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">+ Custom model…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-9"
              value={currentModelName}
              onChange={(e) => updateActiveState({ ...assignment, modelName: e.target.value })}
              placeholder="model-name"
            />
          )
        ) : (
          <div className="flex gap-2">
            <Input
              className="h-9 flex-1"
              placeholder="Type exact model name"
              value={currentModelName}
              onChange={(e) => updateActiveState({ ...assignment, modelName: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              onClick={() => setCustomMode(false)}
            >
              ← List
            </Button>
          </div>
        )}
      </div>

      {/* Connection-type-specific fields */}
      {assignment.connectionType === "API" ? (
        <>
          {/* Z.ai doesn't need an API key or endpoint — show info instead */}
          {currentProvider?.id === "zai" ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <strong>No API key needed.</strong> Z.ai is built into NOX AI and works
              from any region. Just pick a model and click Test.
            </div>
          ) : (
            <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">API Key</Label>
            <Input
              type="password"
              className="h-9 font-mono"
              value={assignment.apiKey || ""}
              onChange={(e) =>
                onChange({ ...assignment, apiKey: e.target.value })
              }
              placeholder="Paste your API key"
            />
            <p className="text-[10px] text-muted-foreground">
              Encrypted at rest. Masked when reloaded. The Test button sends a real request to the official provider API and shows the provider response if authentication fails.
            </p>
          </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* For ollama: show Endpoint (HTTP API host) instead of CLI path */}
          {currentProvider?.id === "ollama" ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Ollama Endpoint (HTTP API)
              </Label>
              <Input
                className="h-9 font-mono"
                value={activeEndpoint}
                onChange={(e) =>
                  updateActiveState({
                    ...assignment,
                    endpoint: e.target.value,
                  })
                }
                placeholder="http://127.0.0.1:11434"
              />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                NOX AI's server connects to this address. If hosted,
                "localhost" refers to the server — set this to a public Ollama
                host you control.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">CLI Path</Label>
                <Input
                  className="h-9 font-mono"
                  value={assignment.cliPath || ""}
                  onChange={(e) =>
                    onChange({ ...assignment, cliPath: e.target.value })
                  }
                  placeholder="/usr/local/bin/llama-cli"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  CLI Args (optional)
                </Label>
                <Input
                  className="h-9 font-mono"
                  value={assignment.cliArgs || ""}
                  onChange={(e) =>
                    onChange({ ...assignment, cliArgs: e.target.value })
                  }
                  placeholder="--port 11434"
                />
              </div>
            </>
          )}
        </>
      )}

      {/* Test button + result */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={testState?.status === "testing"}
          onClick={() => test(roleId, assignment)}
        >
          {testState?.status === "testing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1.5" />
          )}
          Test
        </Button>

        {testState?.status === "ready" && (
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Ready
          </Badge>
        )}
        {testState?.status === "error" && (
          <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/20">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        )}
        {testState?.version && testState.status === "ready" && (
          <span className="text-[10px] text-muted-foreground">
            {testState.version}
            {testState.latencyMs ? ` · ${testState.latencyMs}ms` : ""}
          </span>
        )}
      </div>

      {testState?.message && (
        <p
          className={`text-xs leading-relaxed ${
            testState.status === "error"
              ? "text-red-400"
              : "text-muted-foreground"
          }`}
        >
          {testState.message}
        </p>
      )}
      {testState?.reason && (
        <p className="text-[11px] text-amber-400/90 leading-relaxed">
          {testState.reason}
        </p>
      )}
      {testState?.fixSteps && testState.fixSteps.length > 0 && (
        <ol className="text-[11px] text-muted-foreground list-decimal pl-4 space-y-0.5">
          {testState.fixSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
