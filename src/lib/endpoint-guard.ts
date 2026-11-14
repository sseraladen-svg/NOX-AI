// Pure module (no server-only / alias imports) so it can be unit-tested with node --test.

const BLOCKED_ALWAYS = /^(169\.254\.|0\.0\.0\.0$|metadata\.google\.internal$|\[?fe80:|\[?::ffff:169\.254\.)/i;
const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|.*\.(internal|local)$)/i;

/** Rejects non-http(s) URLs, cloud-metadata hosts, and (API type, production) private/loopback hosts. */
export function assertSafeEndpoint(
  raw: string,
  blockPrivate: boolean,
  nodeEnv: string | undefined = process.env.NODE_ENV
): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Endpoint is not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Endpoint must use http or https.");
  }
  if (u.username || u.password) throw new Error("Endpoint must not contain credentials.");
  const host = u.hostname.toLowerCase();
  if (BLOCKED_ALWAYS.test(host)) throw new Error("Endpoint host is not allowed.");
  if (blockPrivate && nodeEnv === "production" && PRIVATE_HOST.test(host)) {
    throw new Error(
      "Private or loopback endpoints cannot be reached from the hosted server. Use the browser Ollama bridge or a public host."
    );
  }
  return raw;
}
