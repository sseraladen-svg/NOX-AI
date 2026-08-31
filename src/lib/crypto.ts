import crypto from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

function getRootKey(): Buffer {
  const configured = process.env.NOX_AI_SECRET || process.env.AUTH_SECRET;
  const secret = configured ||
    "nox-ai-dev-secret-please-override-in-production-32b";
  return crypto.createHash("sha256").update(secret).digest().subarray(0, KEY_LEN);
}

let warned = false;
export function ensureCryptoSecretConfigured() {
  const configured = process.env.NOX_AI_SECRET || process.env.AUTH_SECRET;
  if (!configured && !warned) {
    warned = true;
    if (process.env.NODE_ENV === "production") {
      console.warn("[nox] NOX_AI_SECRET or AUTH_SECRET is not set in production.");
    } else {
      console.warn(
        "[nox] NOX_AI_SECRET is not set — using deterministic dev fallback. Set NOX_AI_SECRET in production."
      );
    }
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

export function maskApiKey(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 4) return "****";
  const head = plaintext.slice(0, Math.min(3, plaintext.length - 4));
  const tail = plaintext.slice(-4);
  return `${head}${"*".repeat(Math.max(6, plaintext.length - 7))}${tail}`;
}

// A key is "masked" if it's the display placeholder produced by maskApiKey(),
// not a real key. Both the mask and this check must use the same character —
// this is the single source of truth so they can't drift apart again.
export function isMaskedApiKey(apiKey: string | undefined | null): boolean {
  return !!apiKey && apiKey.includes("***") && apiKey.length > 8;
}
