"use client";

import { AuthGate } from "@/components/nox/auth-gate";
import { SingleModePage } from "@/components/nox/single-mode-page";

export default function Single() {
  return (
    <AuthGate requireConfig>
      <SingleModePage />
    </AuthGate>
  );
}
