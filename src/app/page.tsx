"use client";

import { AuthGate } from "@/components/nox/auth-gate";
import { ModePicker } from "@/components/nox/mode-picker";

export default function Home() {
  return (
    <AuthGate>
      <ModePicker />
    </AuthGate>
  );
}
