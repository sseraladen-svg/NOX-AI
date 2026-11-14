// Client-safe helpers (no Node imports) so browser code does not pull in the crypto module.

export function maskApiKey(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 4) return "****";
  const head = plaintext.slice(0, Math.min(3, plaintext.length - 4));
  const tail = plaintext.slice(-4);
  return `${head}${"*".repeat(Math.max(6, plaintext.length - 7))}${tail}`;
}

// A key is "masked" if it's the display placeholder produced by maskApiKey(),
// not a real key. The mask and this check live together so they cannot drift apart.
export function isMaskedApiKey(apiKey: string | undefined | null): boolean {
  return !!apiKey && apiKey.includes("***") && apiKey.length > 8;
}
