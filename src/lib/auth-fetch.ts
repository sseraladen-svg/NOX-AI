"use client";

// ───────────────────────────────────────────────────────────────────────────
// authFetch — fetch wrapper that auto-attaches the x-nox-session header.
//
// The session token is stored in localStorage by the auth store after login.
// This helper reads it and sends it as a header on every API call, so auth
// works even when the httpOnly session cookie isn't sent (e.g. in the preview
// gateway HTTPS context, where SameSite/Secure cookie rules can drop it).
// ───────────────────────────────────────────────────────────────────────────

const TOKEN_KEY = "nox_session_token";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface AuthFetchOptions extends RequestInit {
  // Allows callers to pass a custom body object that gets JSON.stringified.
  body?: BodyInit | Record<string, unknown> | null;
}

export async function authFetch(
  input: string,
  opts: AuthFetchOptions = {}
): Promise<Response> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };

  // Attach the session token as a header if we have one.
  if (token) {
    headers["x-nox-session"] = token;
  }

  // If body is a plain object, JSON.stringify it and set Content-Type.
  let body = opts.body as BodyInit | null | undefined;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(body);
  }

  return fetch(input, {
    ...opts,
    headers,
    body,
  });
}
