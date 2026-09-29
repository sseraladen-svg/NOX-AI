"use client";

import React from "react";
import { useAuth } from "@/store/auth-store";
import { useMultiModel } from "@/store/multi-model-store";
import { useConversations } from "@/store/conversations-store";
import { AuthOverlay } from "@/components/nox/auth-overlay";
import { Loader2 } from "lucide-react";

/**
 * Shared shell for every real route (/, /single, /multi, /orchestrator, /usage).
 * Bootstraps auth on mount, then loads multi-model config + conversation list
 * once a user is present. Shows the auth overlay when signed out and a
 * spinner while the initial auth check is in flight.
 *
 * Now supports localStorage fallback - users can use the app without login
 * by storing data in browser localStorage.
 *
 * `requireConfig` gates rendering until the multi-model config has loaded —
 * used by the mode pages (Single/Multi/Orchestrator) so their "ensure mode"
 * effects don't fire against stale/default state. The mode picker and usage
 * dashboard don't need this.
 */
export function AuthGate({
  children,
  requireConfig = false,
}: {
  children: React.ReactNode;
  requireConfig?: boolean;
}) {
  const auth = useAuth();
  const mm = useMultiModel();
  const convs = useConversations();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    // Try to load from localStorage immediately (no login required)
    mm.load();
    // Also load auth in background for logged-in users
    auth.load();
  }, []);

  React.useEffect(() => {
    if (auth.user) {
      convs.loadList();
    }
  }, [auth.user?.id]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Allow access even without auth - localStorage will handle data
  if (requireConfig && !mm.loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
