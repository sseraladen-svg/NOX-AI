"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  Coins,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";

// ───────────────────────────────────────────────────────────────────────────
// Usage dashboard — shows total cost, tokens, per-model breakdown, per-day
// chart, and recent calls. Reads from /api/usage/summary + /api/usage/recent.
// ───────────────────────────────────────────────────────────────────────────

interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  byProvider: {
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  byModel: {
    model: string;
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  byDay: {
    date: string;
    calls: number;
    totalCost: number;
  }[];
}

interface UsageRecordRow {
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

export function UsageDashboard({ onBack }: { onBack: () => void }) {
  const [summary, setSummary] = React.useState<UsageSummary | null>(null);
  const [recent, setRecent] = React.useState<UsageRecordRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, recRes] = await Promise.all([
        authFetch(`/api/usage/summary?days=${days}`),
        authFetch(`/api/usage/recent?limit=50`),
      ]);
      const sumJson = await sumRes.json();
      const recJson = await recRes.json();
      if (sumJson.ok) setSummary(sumJson.summary);
      if (recJson.ok) setRecent(recJson.records);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [days]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background nox-aurora">
      {/* Header */}
      <header className="nox-topbar sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="flex items-center gap-2 ml-1">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center">
                <TrendingUp className="h-3.5 w-3.5 text-background" />
              </div>
              <div className="leading-none">
                <div className="font-semibold text-sm">Usage & Cost</div>
                <div className="text-[10px] text-muted-foreground">
                  Track every token, every dollar
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-0.5">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-md transition",
                    days === d
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {loading && !summary ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !summary ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>Could not load usage data.</p>
            <Button variant="ghost" size="sm" onClick={load} className="mt-3">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={DollarSign}
                label="Total Cost"
                value={`$${summary.totalCost.toFixed(6)}`}
                accent="emerald"
                sublabel={`Last ${days} days`}
              />
              <StatCard
                icon={Coins}
                label="Total Tokens"
                value={formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}
                accent="cyan"
                sublabel={`${formatTokens(summary.totalInputTokens)} in · ${formatTokens(summary.totalOutputTokens)} out`}
              />
              <StatCard
                icon={Activity}
                label="Total Calls"
                value={String(summary.totalCalls)}
                accent="violet"
                sublabel={`${summary.successfulCalls} ok · ${summary.failedCalls} failed`}
              />
              <StatCard
                icon={CheckCircle2}
                label="Success Rate"
                value={
                  summary.totalCalls > 0
                    ? `${Math.round((summary.successfulCalls / summary.totalCalls) * 100)}%`
                    : "—"
                }
                accent="amber"
                sublabel={
                  summary.failedCalls > 0
                    ? `${summary.failedCalls} failed calls`
                    : "No failures"
                }
              />
            </div>

            {/* Per-day cost chart */}
            {summary.byDay.length > 0 && (
              <Card className="p-5 bg-card/40 backdrop-blur border-border">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Daily Cost
                  </h3>
                  <span className="text-[10px] text-muted-foreground">
                    Last {summary.byDay.length} day{summary.byDay.length === 1 ? "" : "s"}
                  </span>
                </div>
                {summary.byDay.every((d) => d.totalCost === 0) ? (
                  <div className="h-32 flex flex-col items-center justify-center gap-1.5 text-center">
                    <TrendingUp className="h-5 w-5 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      {summary.totalCalls > 0
                        ? "No billable cost yet — calls so far were free, failed, or timed out."
                        : "No activity yet. Costs will appear here once you send a message."}
                    </p>
                  </div>
                ) : (
                  <DailyCostChart data={summary.byDay} />
                )}
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Per-model breakdown */}
              <Card className="p-5 bg-card/40 backdrop-blur border-border">
                <h3 className="font-medium text-sm mb-4">Cost by Model</h3>
                {summary.byModel.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    No model usage yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {summary.byModel.slice(0, 8).map((m, i) => {
                      const maxCost = summary.byModel[0]?.totalCost || 1;
                      const pct = (m.totalCost / maxCost) * 100;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono truncate">
                              <span className="text-muted-foreground">{m.provider}/</span>
                              <span className="text-foreground">{m.model}</span>
                            </span>
                            <span className="text-emerald-400 font-mono ml-2 shrink-0">
                              ${m.totalCost.toFixed(6)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <motion.div
                                className="h-full bg-gradient-to-r from-primary to-emerald-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.5, delay: i * 0.05 }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono w-16 text-right shrink-0">
                              {m.calls} calls
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Per-provider breakdown */}
              <Card className="p-5 bg-card/40 backdrop-blur border-border">
                <h3 className="font-medium text-sm mb-4">Cost by Provider</h3>
                {summary.byProvider.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    No provider usage yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {summary.byProvider.map((p, i) => {
                      const maxCost = summary.byProvider[0]?.totalCost || 1;
                      const pct = (p.totalCost / maxCost) * 100;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono text-foreground capitalize">
                              {p.provider}
                            </span>
                            <span className="text-foreground font-mono ml-2 shrink-0">
                              ${p.totalCost.toFixed(6)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <motion.div
                                className="h-full bg-foreground/70"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.5, delay: i * 0.05 }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono w-16 text-right shrink-0">
                              {p.calls} calls
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {formatTokens(p.inputTokens)} in · {formatTokens(p.outputTokens)} out
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Recent calls */}
            <Card className="p-5 bg-card/40 backdrop-blur border-border">
              <h3 className="font-medium text-sm mb-4">Recent Calls</h3>
              {recent.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No calls yet. Send a message to see usage here.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto nox-scroll">
                  {recent.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition text-xs"
                    >
                      <div
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          r.error ? "bg-red-400" : "bg-emerald-400"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-foreground truncate">
                            {r.provider}/{r.model}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 px-1 shrink-0"
                          >
                            {r.connectionType}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {r.role} · {r.mode} · {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {r.totalTokens != null && (
                          <div className="text-foreground font-mono text-[11px]">
                            {r.totalTokens} tok
                          </div>
                        )}
                        {r.totalCost != null && r.totalCost > 0 && (
                          <div className="text-foreground font-mono text-[11px]">
                            ${r.totalCost.toFixed(6)}
                          </div>
                        )}
                        <div className="text-muted-foreground font-mono text-[10px]">
                          {r.latencyMs}ms
                        </div>
                      </div>
                      {r.timedOut && (
                        <Badge
                          variant="outline"
                          className="text-[9px] py-0 px-1 border-red-500/30 text-red-400 shrink-0"
                        >
                          timeout
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sublabel?: string;
  accent: "emerald" | "cyan" | "violet" | "amber";
}) {
  const colorMap = {
    emerald: "from-foreground/15 to-foreground/5 text-foreground border-foreground/20",
    cyan: "from-foreground/10 to-foreground/[0.03] text-foreground/90 border-foreground/15",
    violet: "from-muted to-muted/40 text-muted-foreground border-border",
    amber: "from-muted/70 to-muted/20 text-foreground/70 border-border/60",
  };
  return (
    <Card className={cn("p-4 bg-gradient-to-br border", colorMap[accent])}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-wider opacity-80">
          {label}
        </span>
      </div>
      <div className="text-xl font-semibold font-mono">{value}</div>
      {sublabel && (
        <div className="text-[10px] opacity-70 mt-1 font-mono">{sublabel}</div>
      )}
    </Card>
  );
}

// Simple bar chart for daily cost — keeps the axis ordered and readable.
function DailyCostChart({ data }: { data: { date: string; calls: number; totalCost: number }[] }) {
  const maxCost = Math.max(...data.map((d) => d.totalCost), 0.0001);
  const labelInterval = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5 h-32">
        {data.map((d, i) => {
          const height = (d.totalCost / maxCost) * 100;
          return (
            <div
              key={i}
              className="flex-1 group relative flex flex-col items-center justify-end"
              title={`${d.date}: ${d.calls} calls · $${d.totalCost.toFixed(6)}`}
            >
              <motion.div
                className="w-full bg-gradient-to-t from-primary/60 to-emerald-400/80 rounded-t-sm min-h-[2px]"
                initial={{ height: 0 }}
                animate={{ height: `${d.totalCost > 0 ? Math.max(height, 6) : 0}%` }}
                transition={{ duration: 0.4, delay: i * 0.02 }}
              />
            </div>
          );
        })}
      </div>

      <div
        className="grid gap-1 text-[10px] text-muted-foreground font-mono"
        style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
      >
        {data.map((d, i) => {
          const showLabel = i % labelInterval === 0 || i === data.length - 1;
          return (
            <span
              key={`${d.date}-${i}`}
              className="text-center truncate"
              style={{ opacity: showLabel ? 1 : 0.3 }}
              title={d.date}
            >
              {showLabel ? formatShortDate(d.date) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function formatShortDate(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}
