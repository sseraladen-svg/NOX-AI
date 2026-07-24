"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, XCircle, Globe, Settings } from "lucide-react";
import type { LimitRow } from "@/store/multi-model-store";

interface Props {
  open: boolean;
  limits: LimitRow[];
  mode: string | null;
  onContinue: () => void;
  onCancel: () => void;
  onSwitchToGlobal: () => void;
  onOpenSettings: () => void;
}

export function MultiAgentConfirmDialog({
  open,
  limits,
  mode,
  onContinue,
  onCancel,
  onSwitchToGlobal,
  onOpenSettings,
}: Props) {
  const allCanFinish = limits.every((l) => l.canFinish);
  const blocked = limits.find((l) => !l.canFinish);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-lg bg-card/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Multi-Agent Task Detected
          </DialogTitle>
          <DialogDescription>
            The host model wants to route this request to one or more specialist
            models. Review the per-model capacity before continuing.
          </DialogDescription>
        </DialogHeader>

        {/* Limit summary */}
        <div className="space-y-2 max-h-72 overflow-y-auto nox-scroll py-1">
          <AnimatePresence>
            {limits.map((l) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-lg border border-border bg-muted/40 p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm capitalize">{l.label}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono shrink-0"
                    >
                      {l.connectionType === "API" ? "API" : "LOCAL"}
                    </Badge>
                  </div>
                  {l.canFinish ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mb-1">
                  {l.provider} · {l.modelName}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {l.connectionType === "API" ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">Quota:</span>{" "}
                        <span className="text-foreground">
                          {Math.round((l.remainingQuota || 0) * 100)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Rate:</span>{" "}
                        <span className="text-foreground">
                          {l.rateLimitPerMin || 0}/min
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tokens:</span>{" "}
                        <span className="text-foreground">
                          {l.remainingTokens || 0}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-muted-foreground">Busy:</span>{" "}
                        <span className={l.busy ? "text-red-400" : "text-emerald-400"}>
                          {l.busy ? "Yes" : "No"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Capacity:</span>{" "}
                        <span className="text-foreground">
                          {Math.round((l.estimatedCapacity || 0) * 100)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
                {l.reason && (
                  <p className="text-[11px] text-amber-400/90 mt-1.5 leading-relaxed">
                    {l.reason}
                  </p>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {blocked ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs">
            <p className="font-medium text-red-400 mb-1">
              Cannot run: &ldquo;{blocked.label}&rdquo; cannot complete its part.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              {blocked.reason}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
            All models have enough capacity to finish this task.
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {allCanFinish ? (
            <div className="flex gap-2 w-full">
              <Button variant="ghost" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={onContinue}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Continue with {limits.length} model{limits.length > 1 ? "s" : ""}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 w-full">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={onSwitchToGlobal}
                  className="w-full"
                >
                  <Globe className="h-3.5 w-3.5 mr-1.5" />
                  Switch to Global
                </Button>
                <Button variant="secondary" onClick={onOpenSettings} className="w-full">
                  <Settings className="h-3.5 w-3.5 mr-1.5" />
                  Change model
                </Button>
              </div>
              <Button variant="ghost" onClick={onCancel} className="w-full">
                Cancel
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
