"use client";

import { AuthGate } from "@/components/nox/auth-gate";
import { MultiModePage } from "@/components/nox/multi-mode-page";

export default function Multi() {
  return (
    <AuthGate requireConfig>
      <MultiModePage />
    </AuthGate>
  );
}
