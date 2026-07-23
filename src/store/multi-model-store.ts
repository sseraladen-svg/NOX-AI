"use client";

import { create } from "zustand";
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
  mode: "GLOBAL",
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
      const res = await fetch("/api/multi-model/config");
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
      const res = await fetch("/api/multi-model/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: get().asDoc() }),
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
      const res = await fetch("/api/multi-model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment: a }),
      });
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
    } catch {
      set((s) => ({
        tests: {
          ...s.tests,
          [id]: { status: "error", message: "Network error during test." },
        },
      }));
      return false;
    }
  },

  reset: async () => {
    try {
      const res = await fetch("/api/multi-model/export-import?action=reset", {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        const c = json.config as MultiModelConfigDoc;
        set({
          mode: c.mode,
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
      const res = await fetch("/api/multi-model/export-import?action=export", {
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
      const res = await fetch("/api/multi-model/export-import?action=import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: doc }),
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
