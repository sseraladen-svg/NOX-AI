"use client";

import { AuthGate } from "@/components/nox/auth-gate";
import { OrchestratorModePage } from "@/components/nox/orchestrator-mode-page";

export default function Orchestrator() {
  return (
    <AuthGate requireConfig>
      <OrchestratorModePage />
    </AuthGate>
  );
}
