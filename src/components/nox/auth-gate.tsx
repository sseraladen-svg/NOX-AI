"use client";

import React from "react";
import { useAuth } from "@/store/auth-store";
import { useMultiModel } from "@/store/multi-model-store";
import { useConversations } from "@/store/conversations-store";
import { AuthOverlay } from "@/components/nox/auth-overlay";
import { Loader2 } from "lucide-react";
import { isGuestSession } from "@/lib/local-storage";
import { useShallow } from "zustand/react/shallow";

/**
 * Shared shell for every real route (/, /single, /multi, /orchestrator, /usage).
 * Bootstraps auth on mount, then loads multi-model config + conversation list
 * once a user is present. Shows the auth overlay when signed out and a
 * spinner while the initial auth check is in flight.
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
  const auth = useAuth(useShallow((s) => ({ load: s.load, loading: s.loading, user: s.user })));
  const mm = useMultiModel(useShallow((s) => ({ load: s.load, loaded: s.loaded })));
  const convs = useConversations(useShallow((s) => ({ loadList: s.loadList })));
  const [guestSession, setGuestSession] = React.useState(false);

  const { load: loadAuth, user, loading } = auth;
  const { load: loadConfig, loaded } = mm;
  const { loadList } = convs;

  React.useEffect(() => {
    if (isGuestSession()) {
      setGuestSession(true);
      return;
    }
    loadAuth();
  }, [loadAuth]);

  const userId = user?.id;
  React.useEffect(() => {
    if (guestSession || userId) {
      loadConfig();
      loadList();
    }
  }, [guestSession, userId, loadConfig, loadList]);

  if (loading && !guestSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && !guestSession) {
    return <AuthOverlay />;
  }

  if (requireConfig && !loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background nox-aurora">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
