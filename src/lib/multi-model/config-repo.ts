import "server-only";
import { db } from "@/lib/db";
import { encryptApiKey, decryptApiKey, maskApiKey, isMaskedApiKey } from "@/lib/crypto";
import {
  type Mode,
  type FeatureId,
  type SpecialistId,
  type ModelAssignment,
  type MultiModelConfigDoc,
  migrateFeatureConfigs,
} from "@/lib/multi-model-types";
import { SCOPE, migrateEndpoint } from "./shared";
import { getCachedConfig, setCachedConfig, invalidateCachedConfig } from "./cache";

function encryptAssignment(a?: ModelAssignment | null): ModelAssignment | null {
  if (!a) return null;
  return {
    ...a,
    apiKey: a.apiKey ? encryptApiKey(a.apiKey) : undefined,
  };
}

function encryptFeatureMap(
  m?: Partial<Record<FeatureId, ModelAssignment>>
): string | null {
  if (!m) return null;
  const out: Record<string, ModelAssignment> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v) out[k] = encryptAssignment(v)!;
  }
  return JSON.stringify(out);
}

function encryptSpecialistMap(
  m?: Partial<Record<SpecialistId, ModelAssignment>>
): string | null {
  if (!m) return null;
  const out: Record<string, ModelAssignment> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v) out[k] = encryptAssignment(v)!;
  }
  return JSON.stringify(out);
}

function maskAssignment(a?: ModelAssignment | null): ModelAssignment | null {
  if (!a) return null;
  return {
    ...a,
    apiKey: a.apiKey ? maskApiKey(decryptApiKey(a.apiKey)) : undefined,
  };
}

function maskFeatureMap(
  raw?: string | null
): Partial<Record<FeatureId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Record<string, ModelAssignment> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as FeatureId] = maskAssignment(v)!;
    }
    return migrateFeatureConfigs(out);
  } catch {
    return undefined;
  }
}

function maskSpecialistMap(
  raw?: string | null
): Partial<Record<SpecialistId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<SpecialistId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as SpecialistId] = maskAssignment(v)!;
    }
    return out;
  } catch {
    return undefined;
  }
}

function unmaskFeatureMap(
  raw?: string | null
): Partial<Record<FeatureId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Record<string, ModelAssignment> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as FeatureId] = {
        ...v,
        apiKey: v.apiKey ? decryptApiKey(v.apiKey) : undefined,
      };
    }
    return migrateFeatureConfigs(out);
  } catch {
    return undefined;
  }
}

function unmaskSpecialistMap(
  raw?: string | null
): Partial<Record<SpecialistId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<SpecialistId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as SpecialistId] = {
        ...v,
        apiKey: v.apiKey ? decryptApiKey(v.apiKey) : undefined,
      };
    }
    return out;
  } catch {
    return undefined;
  }
}

export async function getConfig(
  userId: string
): Promise<MultiModelConfigDoc> {
  const row = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });
  if (!row) {
    return { mode: "SINGLE" };
  }
  return {
    mode: row.mode as Mode,
    globalConfig: maskAssignment(
      row.globalConfig ? JSON.parse(row.globalConfig) : null
    ),
    featureConfigs: maskFeatureMap(row.featureConfigs),
    hostConfig: maskAssignment(
      row.hostConfig ? JSON.parse(row.hostConfig) : null
    ),
    specialistConfigs: maskSpecialistMap(row.specialistConfigs),
    timeoutOverrides: row.timeoutOverrides
      ? JSON.parse(row.timeoutOverrides)
      : undefined,
  };
}

export async function getConfigInternal(
  userId: string
): Promise<MultiModelConfigDoc> {
  const cached = getCachedConfig(userId);
  if (cached) return cached;
  const row = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });
  if (!row) return { mode: "SINGLE" };
  const unmask = (raw: string | null): ModelAssignment | null => {
    if (!raw) return null;
    const a = JSON.parse(raw) as ModelAssignment;
    return {
      ...a,
      apiKey: a.apiKey ? decryptApiKey(a.apiKey) : undefined,
    };
  };
  const doc: MultiModelConfigDoc = {
    mode: row.mode as Mode,
    globalConfig: unmask(row.globalConfig),
    featureConfigs: unmaskFeatureMap(row.featureConfigs),
    hostConfig: unmask(row.hostConfig),
    specialistConfigs: unmaskSpecialistMap(row.specialistConfigs),
    timeoutOverrides: row.timeoutOverrides
      ? JSON.parse(row.timeoutOverrides)
      : undefined,
  };
  setCachedConfig(userId, doc);
  return doc;
}

export async function saveConfig(
  userId: string,
  doc: MultiModelConfigDoc
): Promise<void> {
  if (!["SINGLE", "MULTI", "ORCHESTRATOR"].includes(doc.mode)) {
    throw new Error("Invalid mode.");
  }
  invalidateCachedConfig(userId);
  // Load the existing config so we can preserve API keys that are sent back
  // masked (e.g. "sk-••••7890"). When the frontend loads a config, the keys
  // are masked via maskApiKey() which uses the bullet character. If the user
  // doesn't re-type a key, the masked version gets sent back on save. We use
  // isMaskedApiKey() (shared with crypto.ts) to detect this and preserve the
  // existing encrypted key from the DB instead of overwriting with the mask.
  const existing = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });

  const preserveMaskedKey = (incoming: ModelAssignment | null | undefined, existingJson: string | null): ModelAssignment | null => {
    if (!incoming) return null;
    // First migrate any legacy endpoint field to the correct field
    const migrated = migrateEndpoint(incoming);
    if (!migrated) return null;
    
    // If the incoming key is missing or masked, preserve the existing key.
    if (!migrated.apiKey || isMaskedApiKey(migrated.apiKey)) {
      if (existingJson) {
        try {
          const existingAssign = JSON.parse(existingJson) as ModelAssignment;
          const decrypted = existingAssign.apiKey ? decryptApiKey(existingAssign.apiKey) : undefined;
          return { ...migrated, apiKey: decrypted };
        } catch {
          return { ...migrated, apiKey: undefined };
        }
      }
      return { ...migrated, apiKey: undefined };
    }
    return migrated;
  };

  const globalConfig = doc.globalConfig
    ? JSON.stringify(encryptAssignment(preserveMaskedKey(doc.globalConfig, existing?.globalConfig || null)))
    : null;

  // For feature/specialist maps, preserve per-key.
  const preserveMap = (
    incoming: Partial<Record<string, ModelAssignment>> | undefined,
    existingJson: string | null
  ): Partial<Record<string, ModelAssignment>> | undefined => {
    if (!incoming) return undefined;
    let existingMap: Record<string, ModelAssignment> = {};
    if (existingJson) {
      try {
        existingMap = JSON.parse(existingJson) as Record<string, ModelAssignment>;
      } catch {
        /* ignore */
      }
    }
    const out: Record<string, ModelAssignment> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!v) continue;
      // First migrate any legacy endpoint field to the correct field
      const migrated = migrateEndpoint(v);
      if (!migrated) continue;
      
      if (!migrated.apiKey || isMaskedApiKey(migrated.apiKey)) {
        // Preserve the existing key for this role, but decrypt it before the
        // next encryptAssignment pass so we never double-encrypt a stored key.
        const preserved = existingMap[k]?.apiKey ? decryptApiKey(existingMap[k].apiKey) : undefined;
        out[k] = { ...migrated, apiKey: preserved };
      } else {
        out[k] = migrated;
      }
    }
    return out;
  };

  let existingFeatureConfigs: Partial<Record<FeatureId, ModelAssignment>> = {};
  if (existing?.featureConfigs) {
    try {
      existingFeatureConfigs = migrateFeatureConfigs(
        JSON.parse(existing.featureConfigs)
      );
    } catch {
      existingFeatureConfigs = {};
    }
  }
  const featureConfigs = encryptFeatureMap(
    preserveMap(
      migrateFeatureConfigs(doc.featureConfigs),
      JSON.stringify(existingFeatureConfigs)
    ) as Partial<Record<FeatureId, ModelAssignment>> | undefined
  );
  const hostConfig = doc.hostConfig
    ? JSON.stringify(encryptAssignment(preserveMaskedKey(doc.hostConfig, existing?.hostConfig || null)))
    : null;
  const specialistConfigs = encryptSpecialistMap(preserveMap(doc.specialistConfigs, existing?.specialistConfigs || null) as Partial<Record<SpecialistId, ModelAssignment>> | undefined);
  // A zero, negative or NaN timeout would make every call time out at once.
  const clampTimeout = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(600_000, Math.max(1_000, Math.round(v)))
      : undefined;
  const timeoutOverrides = doc.timeoutOverrides
    ? JSON.stringify({
        LOCAL: clampTimeout(doc.timeoutOverrides.LOCAL),
        API: clampTimeout(doc.timeoutOverrides.API),
      })
    : null;

  await db.multiModelConfig.upsert({
    where: { userId_scope: { userId, scope: SCOPE } },
    create: {
      userId,
      scope: SCOPE,
      mode: doc.mode,
      globalConfig,
      featureConfigs,
      hostConfig,
      specialistConfigs,
      timeoutOverrides,
    },
    update: {
      mode: doc.mode,
      globalConfig,
      featureConfigs,
      hostConfig,
      specialistConfigs,
      timeoutOverrides,
    },
  });
}
