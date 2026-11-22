import "server-only";
import { db } from "@/lib/db";
import type {
  TokenUsage,
  CostBreakdown,
} from "@/lib/multi-model-types";

export interface UsageRecordInput {
  conversationId?: string;
  messageId?: string;
  mode: string;
  role: string;
  provider: string;
  model: string;
  connectionType: string;
  tokens?: TokenUsage;
  cost?: CostBreakdown;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  error: boolean;
}

export async function saveUsage(
  userId: string,
  records: UsageRecordInput[]
): Promise<void> {
  if (records.length === 0) return;
  await db.usageRecord.createMany({
    data: records.map((r) => ({
      userId,
      conversationId: r.conversationId || null,
      messageId: r.messageId || null,
      mode: r.mode,
      role: r.role,
      provider: r.provider,
      model: r.model,
      connectionType: r.connectionType,
      inputTokens: r.tokens?.input ?? null,
      outputTokens: r.tokens?.output ?? null,
      totalTokens: r.tokens?.total ?? null,
      inputCost: r.cost?.input ?? null,
      outputCost: r.cost?.output ?? null,
      totalCost: r.cost?.total ?? null,
      latencyMs: r.latencyMs,
      retries: r.retries,
      timedOut: r.timedOut,
      error: r.error,
    })),
  });
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Aggregated usage summary for the cost dashboard.
export interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  // Per-provider breakdown.
  byProvider: {
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  // Per-model breakdown.
  byModel: {
    model: string;
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  // Per-day breakdown (last 30 days).
  byDay: {
    date: string; // YYYY-MM-DD
    calls: number;
    totalCost: number;
  }[];
}

export async function getUsageSummary(
  userId: string,
  days = 30
): Promise<UsageSummary> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, days - 1));

  const records = await db.usageRecord.findMany({
    where: {
      userId,
      createdAt: { gte: start },
    },
    select: {
      provider: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      inputCost: true,
      outputCost: true,
      totalCost: true,
      error: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const totalCost = records.reduce((s, r) => s + (r.totalCost || 0), 0);
  const totalInputTokens = records.reduce((s, r) => s + (r.inputTokens || 0), 0);
  const totalOutputTokens = records.reduce((s, r) => s + (r.outputTokens || 0), 0);
  const successfulCalls = records.filter((r) => !r.error).length;
  const failedCalls = records.filter((r) => r.error).length;

  // Group by provider.
  const providerMap = new Map<string, {
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>();
  for (const r of records) {
    const key = r.provider;
    const existing = providerMap.get(key) || {
      provider: key,
      calls: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    existing.inputTokens += r.inputTokens || 0;
    existing.outputTokens += r.outputTokens || 0;
    providerMap.set(key, existing);
  }

  // Group by model.
  const modelMap = new Map<string, {
    model: string;
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    const existing = modelMap.get(key) || {
      model: r.model,
      provider: r.provider,
      calls: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    existing.inputTokens += r.inputTokens || 0;
    existing.outputTokens += r.outputTokens || 0;
    modelMap.set(key, existing);
  }

  // Fill every day in the selected window so the chart remains continuous and
  // the date axis stays aligned even when a day has zero cost.
  const dayMap = new Map<string, { calls: number; totalCost: number }>();
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dayMap.set(formatDateKey(cursor), { calls: 0, totalCost: 0 });
  }
  for (const r of records) {
    const date = formatDateKey(new Date(r.createdAt));
    const existing = dayMap.get(date) || { calls: 0, totalCost: 0 };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    dayMap.set(date, existing);
  }

  return {
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    totalInputTokens,
    totalOutputTokens,
    totalCalls: records.length,
    successfulCalls,
    failedCalls,
    byProvider: Array.from(providerMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    byModel: Array.from(modelMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    byDay: Array.from(dayMap.entries())
      .map(([date, v]) => ({
        date,
        calls: v.calls,
        totalCost: Math.round(v.totalCost * 1_000_000) / 1_000_000,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// Get recent usage records (for a list view).
export interface UsageRecordRow {
  id: string;
  conversationId: string | null;
  mode: string;
  role: string;
  provider: string;
  model: string;
  connectionType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  error: boolean;
  createdAt: string;
}

export async function getRecentUsage(
  userId: string,
  limit = 50
): Promise<UsageRecordRow[]> {
  const records = await db.usageRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return records.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    mode: r.mode,
    role: r.role,
    provider: r.provider,
    model: r.model,
    connectionType: r.connectionType,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    totalCost: r.totalCost,
    latencyMs: r.latencyMs,
    retries: r.retries,
    timedOut: r.timedOut,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));
}

