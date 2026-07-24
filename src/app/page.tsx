"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/store/auth-store";
import { useMultiModel } from "@/store/multi-model-store";
import { useConversations } from "@/store/conversations-store";
import { AuthOverlay } from "@/components/nox/auth-overlay";
import { ModePicker } from "@/components/nox/mode-picker";
import { SingleModePage } from "@/components/nox/single-mode-page";
import { MultiModePage } from "@/components/nox/multi-mode-page";
import { OrchestratorModePage } from "@/components/nox/orchestrator-mode-page";
import { Loader2 } from "lucide-react";

/**
 * Inner component that consumes useSearchParams. MUST be wrapped in <Suspense>
 * in Next.js 16 or client-side navigation will bail out.
 */
function HomeInner() {
  const auth = useAuth();
  const mm = useMultiModel();
  const convs = useConversations();
  const searchParams = useSearchParams();
  const modeParam = (searchParams.get("mode") || "").toLowerCase();

  // Bootstrap auth on mount
  React.useEffect(() => {
    auth.load();
  }, []);

  // Once authenticated, load multi-model config + conversation list
  React.useEffect(() => {
    if (auth.user) {
      mm.load();
      convs.loadList();
    }
  }, [auth.user?.id]);

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!auth.user) {
    return <AuthOverlay />;
  }

  // Wait for multi-model config to load before rendering mode pages
  // (so each page's "ensure mode" effect doesn't fire with stale state)
  if (!mm.loaded && modeParam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Route based on ?mode= query param
  if (modeParam === "single") return <SingleModePage />;
  if (modeParam === "multi") return <MultiModePage />;
  if (modeParam === "orchestrator") return <OrchestratorModePage />;

  // Default: mode picker landing
  return <ModePicker />;
}

export default function Home() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <HomeInner />
    </React.Suspense>
  );
}
