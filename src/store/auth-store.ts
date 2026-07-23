"use client";

import { create } from "zustand";

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
    try {
      const res = await fetch("/api/auth/me");
      const json = await res.json();
      set({ user: json.user || null, loading: false });
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
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));
