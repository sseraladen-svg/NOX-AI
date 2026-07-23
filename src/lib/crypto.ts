import crypto from "crypto";

// ───────────────────────────────────────────────────────────────────────────
// API key encryption at rest
//
// Uses AES-256-GCM with a key derived from NOX_AI_SECRET (or a deterministic
// fallback when the env var is missing — clearly logged so it can be fixed).
// Encrypted blobs are stored as `iv:tag:ciphertext` (all hex).
// ───────────────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

function getRootKey(): Buffer {
  const secret =
    process.env.NOX_AI_SECRET ||
    // Deterministic dev fallback. NOT for production. Logged on boot.
    "nox-ai-dev-secret-please-override-in-production-32b";
  return crypto.createHash("sha256").update(secret).digest().subarray(0, KEY_LEN);
}

let warned = false;
export function ensureCryptoSecretConfigured() {
  if (!process.env.NOX_AI_SECRET && !warned) {
    warned = true;
    console.warn(
      "[nox] NOX_AI_SECRET is not set — using deterministic dev fallback. Set NOX_AI_SECRET in production."
    );
  }
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return "";
  ensureCryptoSecretConfigured();
  const key = getRootKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptApiKey(blob: string): string {
  if (!blob) return "";
  try {
    const [ivHex, tagHex, dataHex] = blob.split(":");
    if (!ivHex || !tagHex || !dataHex) return "";
    const key = getRootKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

// Mask an API key for display: show last 4 chars only.
//   "sk-abcdef1234567890" → "sk-••••••••••••••7890"
export function maskApiKey(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 4) return "••••";
  const head = plaintext.slice(0, Math.min(3, plaintext.length - 4));
  const tail = plaintext.slice(-4);
  return `${head}${"•".repeat(Math.max(6, plaintext.length - 7))}${tail}`;
}
