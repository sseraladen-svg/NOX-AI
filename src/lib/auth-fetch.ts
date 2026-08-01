// "use client" is intentional here because this helper runs in browser code.

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

export interface AuthFetchOptions extends Omit<RequestInit, "body"> {
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

  if (token) {
    headers["x-nox-session"] = token;
  }

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
