"use client";

import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/nox/auth-gate";
import { UsageDashboard } from "@/components/nox/usage-dashboard";

export default function Usage() {
  const router = useRouter();
  return (
    <AuthGate>
      <UsageDashboard onBack={() => router.push("/")} />
    </AuthGate>
  );
}
