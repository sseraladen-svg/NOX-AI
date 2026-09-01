// Runs in the BROWSER, not the server. This helper lets NOX call a user's
// local Ollama instance when the app itself is deployed remotely.

const BROWSER_OLLAMA_TIMEOUT_MS = 10 * 60 * 1000;

export function normalizeEndpoint(endpoint?: string): string {
  const base = endpoint || "http://127.0.0.1:11434";
  return base.replace("://localhost", "://127.0.0.1");
}

export async function testOllamaFromBrowser(endpoint: string, model: string) {
  const base = normalizeEndpoint(endpoint);

  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(BROWSER_OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      return {
        ok: false,
        message: `Ollama HTTP ${res.status} at ${base}.`,
      };
    }

    const json = await res.json();
    const models: string[] = (json.models || []).map((m: { name?: string }) => m.name || "");
    if (models.length && !models.includes(model)) {
      return {
        ok: false,
        message: `Model "${model}" not found. Available: ${models.slice(0, 5).join(", ")}`,
      };
    }

    return {
      ok: true,
      message: `Connected to Ollama at ${base}. Model "${model}" ready.`,
    };
  } catch {
    return {
      ok: false,
      message: `Could not reach Ollama at ${base} from your browser. Is it running? Did you set OLLAMA_ORIGINS to this site's URL?`,
    };
  }
}

export async function generateFromBrowser(
  endpoint: string,
  model: string,
  prompt: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const base = normalizeEndpoint(endpoint);

  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(BROWSER_OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` };
    }

    const json = await res.json();
    return { ok: true, text: json.response || "" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
