import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

// ───────────────────────────────────────────────────────────────────────────
// NOX AI — Local auth (email + password, server-side sessions)
//
// • Passwords are hashed with scrypt (salt + 64-byte hash, formatted as
//   `saltHex:hashHex`).
// • Sessions are signed HMAC tokens stored in an httpOnly cookie. The token
//   payload is `userId.expiresAtMs`. No session DB table needed.
// ───────────────────────────────────────────────────────────────────────────

const SESSION_COOKIE = "nox_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function getAuthSecret(): string {
  const s =
    process.env.NOX_AI_SECRET ||
    "nox-ai-dev-secret-please-override-in-production-32b";
  return s;
}

// ─── Password hashing (scrypt) ─────────────────────────────────────────────

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

// ─── Session tokens (HMAC-signed) ──────────────────────────────────────────

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
  // payload = userId.expiresAtMs
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

// ─── Cookie helpers (server-side) ──────────────────────────────────────────

export async function setSessionCookie(userId: string): Promise<void> {
  const token = createSessionToken(userId);
  const store = await cookies();
  // Always use sameSite="lax" + secure only in production. The preview
  // gateway proxies to localhost:3000 over HTTPS, and lax cookies are sent
  // on same-site navigations and same-origin fetches, which covers our case.
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
    const token = store.get(SESSION_COOKIE)?.value;
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

export async function requireUser(): Promise<{ id: string; email: string; name: string | null }> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authenticated");
  return u;
}
