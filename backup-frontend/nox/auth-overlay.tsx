"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, Mail, Lock, User as UserIcon, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/store/auth-store";
import { authFetch } from "@/lib/auth-fetch";
import { toast } from "sonner";

type AuthMode = "login" | "signup" | "reset";

export function AuthOverlay() {
  const { signup, login, error, clearError } = useAuth();
  const [mode, setMode] = React.useState<AuthMode>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Reset password fields
  const [resetEmail, setResetEmail] = React.useState("");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "login") {
      await login(email, password);
    } else if (mode === "signup") {
      await signup(email, password, name);
    } else if (mode === "reset") {
      try {
        const res = await authFetch("/api/auth/reset-password", {
          method: "POST",
          body: {
            email: resetEmail,
            currentPassword,
            newPassword,
          },
        });
        const json = await res.json();
        if (json.ok) {
          toast.success("Password updated", {
            description: "Log in with your new password.",
          });
          setMode("login");
          setEmail(resetEmail);
          setPassword("");
          setCurrentPassword("");
          setNewPassword("");
          setResetEmail("");
        } else {
          toast.error(json.error || "Password reset failed");
        }
      } catch {
        toast.error("Network error during password reset");
      }
    }
    setBusy(false);
  };

  const switchMode = (m: AuthMode) => {
    setMode(m);
    clearError();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background nox-aurora p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary via-fuchsia-500 to-cyan-500 flex items-center justify-center nox-glow nox-pulse mb-3">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="nox-text-gradient">NOX AI</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Intelligence in the dark
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-6 shadow-2xl">
          {/* Tabs */}
          <div className="flex rounded-lg bg-muted/40 p-1 mb-5">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 py-2 text-sm rounded-md transition ${
                mode === "login"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`flex-1 py-2 text-sm rounded-md transition ${
                mode === "signup"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign up
            </button>
            <button
              type="button"
              onClick={() => switchMode("reset")}
              className={`flex-1 py-2 text-sm rounded-md transition ${
                mode === "reset"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Reset
            </button>
          </div>

          {mode === "reset" ? (
            /* ─── Password Reset Form ─── */
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="email"
                    required
                    className="pl-9 h-10"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Current Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="password"
                    required
                    className="pl-9 h-10"
                    placeholder="Your current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">New Password</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="password"
                    required
                    className="pl-9 h-10"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Update Password
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Enter your current password to verify identity, then set a new one.
              </p>
            </form>
          ) : (
            /* ─── Login / Signup Form ─── */
            <form onSubmit={submit} className="space-y-4">
              <AnimatePresence mode="wait">
                {mode === "signup" && (
                  <motion.div
                    key="name"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden"
                  >
                    <Label htmlFor="name" className="text-xs text-muted-foreground">
                      Name (optional)
                    </Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        id="name"
                        className="pl-9 h-10"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs text-muted-foreground">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    className="pl-9 h-10"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    required
                    className="pl-9 h-10"
                    placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {mode === "login" ? "Log in" : "Create account"}
              </Button>

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  className="w-full text-xs text-muted-foreground hover:text-primary transition"
                >
                  Forgot password?
                </button>
              )}
            </form>
          )}

          <p className="text-[10px] text-muted-foreground text-center mt-4 leading-relaxed">
            Your account is stored in NOX AI's local database. Passwords are
            hashed with scrypt. Configs and conversations are tied to your
            account.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
