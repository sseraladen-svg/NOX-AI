"use client";

import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";
import { isMaskedApiKey } from "@/lib/crypto";
import type {
  Mode,
  FeatureId,
  SpecialistId,
  ModelAssignment,
  MultiModelConfigDoc,
} from "@/lib/multi-model-types";

export interface TestState {
  status: "idle" | "testing" | "ready" | "error";
  message?: string;
  reason?: string;
  fixSteps?: string[];
  version?: string;
  latencyMs?: number;
}

export interface LimitRow {
  id: string;
  label: string;
  connectionType: "LOCAL" | "API";
  provider: string;
  modelName: string;
  remainingQuota?: number;
  rateLimitPerMin?: number;
  remainingTokens?: number;
  busy?: boolean;
  estimatedCapacity?: number;
  canFinish: boolean;
  reason?: string;
}

interface MultiModelStore {
  // Config (masked form, as returned by the API)
  mode: Mode;
  globalConfig: ModelAssignment | null;
  featureConfigs: Partial<Record<FeatureId, ModelAssignment>>;
  hostConfig: ModelAssignment | null;
  specialistConfigs: Partial<Record<SpecialistId, ModelAssignment>>;
  timeoutOverrides: { LOCAL?: number; API?: number };
  // Default SINGLE mode constants
  defaultMode: Mode;

  // UI state
  loaded: boolean;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;

  // Per-card test state, keyed by role id ("global" | feature id | "host" | specialist id)
  tests: Record<string, TestState>;

  // Multi-agent confirmation flow
  confirmOpen: boolean;
  confirmLimits: LimitRow[];
  confirmMode: Mode | null;

  // Actions
  load: () => Promise<void>;
  setMode: (m: Mode) => void;
  setGlobal: (a: ModelAssignment) => void;
  setFeature: (id: FeatureId, a: ModelAssignment) => void;
  setHost: (a: ModelAssignment) => void;
  setSpecialist: (id: SpecialistId, a: ModelAssignment) => void;
  setTimeoutOverride: (type: "LOCAL" | "API", ms: number) => void;
  save: () => Promise<boolean>;
  test: (id: string, a: ModelAssignment) => Promise<boolean>;
  reset: () => Promise<void>;
  exportConfig: () => Promise<MultiModelConfigDoc | null>;
  importConfig: (doc: MultiModelConfigDoc) => Promise<boolean>;

  openConfirm: (limits: LimitRow[], mode: Mode) => void;
  closeConfirm: () => void;

  asDoc: () => MultiModelConfigDoc;
}

export const useMultiModel = create<MultiModelStore>((set, get) => ({
  mode: "SINGLE",
  defaultMode: "SINGLE",
  globalConfig: null,
  featureConfigs: {},
  hostConfig: null,
  specialistConfigs: {},
  timeoutOverrides: {},
  loaded: false,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  tests: {},
  confirmOpen: false,
  confirmLimits: [],
  confirmMode: null,

  load: async () => {
    try {
      const res = await authFetch("/api/multi-model/config");
      const json = await res.json();
      if (json.ok) {
        const c = json.config as MultiModelConfigDoc;
        set({
          mode: c.mode,
          globalConfig: c.globalConfig || null,
          featureConfigs: c.featureConfigs || {},
          hostConfig: c.hostConfig || null,
          specialistConfigs: c.specialistConfigs || {},
          timeoutOverrides: c.timeoutOverrides || {},
          loaded: true,
          dirty: false,
        });
      } else {
        // Auth failure or other error — still mark loaded so the UI doesn't
        // spin forever. The auth gate will redirect to the login screen.
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setMode: (m) => set({ mode: m, dirty: true }),

  setGlobal: (a) => set({ globalConfig: a, dirty: true }),

  setFeature: (id, a) =>
    set((s) => ({
      featureConfigs: { ...s.featureConfigs, [id]: a },
      dirty: true,
    })),

  setHost: (a) => set({ hostConfig: a, dirty: true }),

  setSpecialist: (id, a) =>
    set((s) => ({
      specialistConfigs: { ...s.specialistConfigs, [id]: a },
      dirty: true,
    })),

  setTimeoutOverride: (type, ms) =>
    set((s) => ({
      timeoutOverrides: { ...s.timeoutOverrides, [type]: ms },
      dirty: true,
    })),

  save: async () => {
    set({ saving: true });
    try {
      const res = await authFetch("/api/multi-model/config", {
        method: "PUT",
        body: { config: get().asDoc() },
      });
      const json = await res.json();
      if (json.ok) {
        const c = json.config as MultiModelConfigDoc;
        const keepRealKey = (
          incoming: ModelAssignment | null | undefined,
          fromServer: ModelAssignment | null | undefined
        ): ModelAssignment | null => {
          if (!fromServer) return incoming || null;
          if (!incoming?.apiKey || isMaskedApiKey(incoming.apiKey)) return fromServer;
          return { ...fromServer, apiKey: incoming.apiKey };
        };
        const keepMap = (
          incoming: Partial<Record<string, ModelAssignment>> | undefined,
          fromServer: Partial<Record<string, ModelAssignment>> | undefined
        ): Partial<Record<string, ModelAssignment>> => {
          const out: Partial<Record<string, ModelAssignment>> = {};
          const serverMap = fromServer || {};
          const prevMap = incoming || {};
          for (const [id, serverValue] of Object.entries(serverMap)) {
            const prevValue = prevMap[id];
            const nextValue = keepRealKey(prevValue, serverValue);
            if (nextValue) out[id] = nextValue;
          }
          for (const [id, prevValue] of Object.entries(prevMap)) {
            if (!(id in serverMap) && prevValue) out[id] = prevValue;
          }
          return out;
        };
        const prev = get();
        set({
          mode: c.mode,
          globalConfig: keepRealKey(prev.globalConfig, c.globalConfig) || null,
          featureConfigs: keepMap(prev.featureConfigs, c.featureConfigs || {}),
          hostConfig: keepRealKey(prev.hostConfig, c.hostConfig) || null,
          specialistConfigs: keepMap(prev.specialistConfigs, c.specialistConfigs || {}),
          timeoutOverrides: c.timeoutOverrides || {},
          dirty: false,
          saving: false,
          lastSavedAt: Date.now(),
        });
        return true;
      }
      set({ saving: false });
      return false;
    } catch {
      set({ saving: false });
      return false;
    }
  },

  test: async (id, a) => {
    set((s) => ({ tests: { ...s.tests, [id]: { status: "testing" } } }));
    try {
      const res = await authFetch("/api/multi-model/test", {
        method: "POST",
        body: { id, assignment: a },
      });

      // Check if the response is JSON before trying to parse it.
      // If the route is missing (404), the server returns an HTML error page.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        // Not JSON — likely a 404 HTML page or server error.
        set((s) => ({
          tests: {
            ...s.tests,
            [id]: {
              status: "error",
              message: res.status === 404
                ? "The test endpoint is not available. Restart the dev server and try again."
                : `Server returned ${res.status} (non-JSON response). The server may need to be restarted.`,
              reason: `HTTP ${res.status} — expected JSON but got ${contentType || "unknown"}.`,
            },
          },
        }));
        return false;
      }

      const json = await res.json();
      if (json.ok) {
        const r = json.result;
        set((s) => ({
          tests: {
            ...s.tests,
            [id]: {
              status: r.status,
              message: r.message,
              reason: r.reason,
              fixSteps: r.fixSteps,
              version: r.version,
              latencyMs: r.latencyMs,
            },
          },
        }));
        return r.ok;
      }
      set((s) => ({
        tests: {
          ...s.tests,
          [id]: { status: "error", message: json.error || "Test failed." },
        },
      }));
      return false;
    } catch (err) {
      const e = err as Error;
      // Check if this is a JSON parse error (response was HTML, not JSON)
      const isParseError = e.message.includes("Unexpected token") || e.message.includes("is not valid JSON");
      set((s) => ({
        tests: {
          ...s.tests,
          [id]: {
            status: "error",
            message: isParseError
              ? "The test endpoint returned an HTML page instead of JSON. Restart the dev server (bun run dev) and try again."
              : `Network error: ${e.message || "Request failed"}. Check your connection and that NOX AI is reachable.`,
            reason: isParseError
              ? "The /api/multi-model/test route may be missing. Restart the server."
              : "The test request could not reach the server.",
          },
        },
      }));
      return false;
    }
  },

  reset: async () => {
    try {
      const res = await authFetch("/api/multi-model/export-import?action=reset", {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        const c = json.config as MultiModelConfigDoc;
        set({
          mode: c.mode || "SINGLE",
          globalConfig: null,
          featureConfigs: {},
          hostConfig: null,
          specialistConfigs: {},
          timeoutOverrides: {},
          dirty: false,
          tests: {},
        });
      }
    } catch {
      /* ignore */
    }
  },

  exportConfig: async () => {
    try {
      const res = await authFetch("/api/multi-model/export-import?action=export", {
        method: "POST",
      });
      const json = await res.json();
      return json.ok ? (json.config as MultiModelConfigDoc) : null;
    } catch {
      return null;
    }
  },

  importConfig: async (doc) => {
    try {
      const res = await authFetch("/api/multi-model/export-import?action=import", {
        method: "POST",
        body: { config: doc },
      });
      const json = await res.json();
      if (json.ok) {
        const c = json.config as MultiModelConfigDoc;
        set({
          mode: c.mode,
          globalConfig: c.globalConfig || null,
          featureConfigs: c.featureConfigs || {},
          hostConfig: c.hostConfig || null,
          specialistConfigs: c.specialistConfigs || {},
          timeoutOverrides: c.timeoutOverrides || {},
          dirty: false,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  openConfirm: (limits, mode) =>
    set({ confirmOpen: true, confirmLimits: limits, confirmMode: mode }),
  closeConfirm: () =>
    set({ confirmOpen: false, confirmLimits: [], confirmMode: null }),

  asDoc: () => {
    const s = get();
    return {
      mode: s.mode,
      globalConfig: s.globalConfig,
      featureConfigs: s.featureConfigs,
      hostConfig: s.hostConfig,
      specialistConfigs: s.specialistConfigs,
      timeoutOverrides: s.timeoutOverrides,
    };
  },
}));
