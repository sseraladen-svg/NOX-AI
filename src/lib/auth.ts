import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

const SESSION_COOKIE = "nox_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function getAuthSecret(): string {
  const configured = process.env.NOX_AI_SECRET || process.env.AUTH_SECRET;
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("NOX_AI_SECRET or AUTH_SECRET must be set in production.");
  }

  return "nox-ai-dev-secret-please-override-in-production-32b";
}

export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plaintext, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plaintext: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(plaintext, salt, 64);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sign(payload: string): string {
  const secret = getAuthSecret();
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verify(token: string): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx < 1) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  const [userId, expiresStr] = payload.split("|");
  if (!userId || !expiresStr) return null;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || Date.now() > expires) return null;
  return userId;
}

export function createSessionToken(userId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return sign(`${userId}|${expiresAt}`);
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  try {
    const store = await cookies();
    let token = store.get(SESSION_COOKIE)?.value;
    if (!token) {
      const { headers } = await import("next/headers");
      const h = await headers();
      token = h.get("x-nox-session") || undefined;
    }
    if (!token) return null;
    const userId = verify(token);
    if (!userId) return null;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    return user || null;
  } catch {
    return null;
  }
}

export async function getCurrentSessionToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value || null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<{ id: string; email: string; name: string | null }> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authenticated");
  return u;
}
