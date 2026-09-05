"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bot, Code2, Cog, Cpu, Eye, Network, ShieldAlert } from "lucide-react";
import type { LimitRow } from "@/store/multi-model-store";
import { SPECIALISTS, type IntentClassification, type SpecialistId } from "@/lib/multi-model-types";

interface Props {
  open: boolean;
  limits: LimitRow[];
  mode: string | null;
  classification?: IntentClassification;
  request?: string | null;
  onContinue: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onSwitchToGlobal: () => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
  onHostHandleDirectly: () => void | Promise<void>;
  onChangeSpecialist?: (specialist: SpecialistId) => void;
  highImpact?: boolean;
  highImpactActions?: string[];
  onApproveHighImpact?: () => void | Promise<void>;
}

const ICONS = { planning: Network, coding: Code2, vision: Eye, automation: Cog, engineering: Cpu };

export function MultiAgentConfirmDialog({
  open, limits, classification, request, onContinue, onCancel, onSwitchToGlobal,
  onOpenSettings, onHostHandleDirectly, onChangeSpecialist, highImpact = false,
  highImpactActions = [], onApproveHighImpact,
}: Props) {
  const [submitting, setSubmitting] = React.useState(false);
  const specialistSelectRef = React.useRef<HTMLSelectElement>(null);
  React.useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  const allCanFinish = limits.every((limit) => limit.canFinish);
  const blocked = limits.find((limit) => !limit.canFinish);
  const specialist = classification && SPECIALISTS.find((item) => item.id === classification.specialist);
  const SpecialistIcon = specialist ? ICONS[specialist.id] : Bot;
  const plan = classification?.plan?.length ? classification.plan : ["Understand the project", "Design the approach", "Implement required changes", "Test and verify"];
  const capabilities = classification?.capabilities?.length ? classification.capabilities : ["Read project files", "Modify approved files", "Run tests, typecheck, lint, and build"];
  const submit = (action: () => void | Promise<void>) => {
    if (submitting) return;
    setSubmitting(true);
    void action();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !submitting) onCancel(); }}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto nox-scroll bg-[#0b1018]/98 backdrop-blur-2xl border-white/10 shadow-2xl"
        onEscapeKeyDown={(event) => { if (submitting) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {highImpact ? <ShieldAlert className="h-5 w-5 text-red-400" /> : <Bot className="h-5 w-5 text-primary" />}
            {highImpact ? "Additional Approval Required" : "Confirm Orchestration"}
          </DialogTitle>
          <DialogDescription>
            {highImpact
              ? "Review the exact high-impact action before it is executed."
              : "The Host classified this request and is waiting for your approval before routing it."}
          </DialogDescription>
        </DialogHeader>

        {request && <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm"><div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Request</div>{request}</div>}

        {highImpact && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-300"><AlertTriangle className="h-4 w-4" /> Action requiring approval</div>
            <ul className="list-disc pl-5 mt-2 text-sm text-red-100 space-y-1">
              {(highImpactActions.length ? highImpactActions : ["A high-impact specialist action"]).map((action) => <li key={action}>{action}</li>)}
            </ul>
            <p className="text-xs text-red-200/80 mt-3">This may modify files, execute commands, or change data. Nothing runs until you approve it.</p>
          </div>
        )}

        {classification && !highImpact && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-primary" />Host <span className="text-muted-foreground">→</span> {specialist?.label || classification.specialist}</div>
              <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">{Math.round(classification.confidence * 100)}% confidence</Badge>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-black/20 p-3"><SpecialistIcon className="h-5 w-5 text-primary" /><div><div className="text-sm font-semibold">{specialist?.label || classification.specialist}</div><div className="text-xs text-muted-foreground">Selected specialist</div></div></div>
            {onChangeSpecialist && <label className="block text-xs"><span className="text-muted-foreground">Change specialist</span><select ref={specialistSelectRef} disabled={submitting} value={classification.specialist === "none" ? "" : classification.specialist} onChange={(event) => onChangeSpecialist(event.target.value as SpecialistId)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-xs">{SPECIALISTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
            <div className="text-xs"><div className="text-muted-foreground mb-1">Routing reason</div><p>{classification.reasoning}</p></div>
            <InfoList title="Proposed execution" items={plan} ordered />
            <InfoList title="Capabilities" items={capabilities} />
            <div className="grid sm:grid-cols-2 gap-3 text-xs"><div><div className="font-medium mb-1">External actions</div><div className="text-muted-foreground">{classification.externalActions?.join(", ") || "None"}</div></div><div><div className="font-medium mb-1">Destructive actions</div><div className="text-muted-foreground">{classification.destructiveActions?.join(", ") || "None"}</div></div></div>
          </div>
        )}

        {!highImpact && limits.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center justify-between"><span className="font-medium">Model readiness</span><span className={allCanFinish ? "text-emerald-400" : "text-red-400"}>{allCanFinish ? "Ready" : "Blocked"}</span></div>
            {blocked && <div className="text-red-300 mt-1">{blocked.label}: {blocked.reason || "Not reachable"}</div>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {highImpact ? (
            <><Button variant="ghost" disabled={submitting} onClick={() => submit(onCancel)}>Cancel</Button><Button disabled={submitting} onClick={() => submit(onApproveHighImpact || onCancel)} className="bg-red-600 text-white hover:bg-red-700">{submitting ? "Submitting…" : "Approve Action"}</Button></>
          ) : (
            <div className="flex flex-wrap justify-end gap-2 w-full">
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => specialistSelectRef.current?.focus()}><Network className="h-3.5 w-3.5 mr-1.5" />Change Specialist</Button>
              <Button variant="secondary" disabled={submitting} onClick={() => submit(onHostHandleDirectly)}><Bot className="h-3.5 w-3.5 mr-1.5" />Let Host Answer</Button>
              <Button variant="ghost" disabled={submitting} onClick={() => submit(onCancel)}>Cancel</Button>
              <Button disabled={submitting || !allCanFinish} onClick={() => submit(onContinue)} className="bg-primary text-primary-foreground hover:bg-primary/90">{submitting ? "Submitting…" : "Continue"}</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoList({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return <div className="text-xs"><div className="font-medium mb-1">{title}</div><Tag className="list-disc pl-4 space-y-0.5 text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</Tag></div>;
}
