"use client";

import { create } from "zustand";
import {
  setSessionToken,
  clearSessionToken,
  getSessionToken,
} from "@/lib/auth-fetch";

export interface NoxUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthStore {
  user: NoxUser | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  signup: (
    email: string,
    password: string,
    name?: string
  ) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  error: null,

  load: async () => {
    // If we have a stored token, send it as a header to verify the session.
    const token = getSessionToken();
    try {
      const res = await fetch("/api/auth/me", {
        headers: token ? { "x-nox-session": token } : undefined,
      });
      const json = await res.json();
      if (json.ok && json.user) {
        set({ user: json.user, loading: false });
      } else {
        // No valid session — clear any stale token.
        clearSessionToken();
        set({ user: null, loading: false });
      }
    } catch {
      set({ user: null, loading: false });
    }
  },

  signup: async (email, password, name) => {
    set({ error: null });
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const json = await res.json();
      if (json.ok) {
        // Store the session token for header-based auth on subsequent calls.
        if (json.sessionToken) setSessionToken(json.sessionToken);
        set({ user: json.user });
        return true;
      }
      set({ error: json.error || "Signup failed." });
      return false;
    } catch {
      set({ error: "Network error during signup." });
      return false;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (json.ok) {
        // Store the session token for header-based auth on subsequent calls.
        if (json.sessionToken) setSessionToken(json.sessionToken);
        set({ user: json.user });
        return true;
      }
      set({ error: json.error || "Login failed." });
      return false;
    } catch {
      set({ error: "Network error during login." });
      return false;
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearSessionToken();
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));
