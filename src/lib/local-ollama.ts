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
      signal: AbortSignal.timeout(10_000),
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
  prompt: string,
  image?: { data: string; mimeType: string },
  onChunk?: (text: string) => void
): Promise<
  | { ok: true; text: string; tokens?: { input: number; output: number; total: number }; latencyMs?: number }
  | { ok: false; error: string }
> {
  const base = normalizeEndpoint(endpoint);

  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        ...(image ? { images: [image.data] } : {}),
      }),
      signal: AbortSignal.timeout(BROWSER_OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` };
    }

    if (!res.body) return { ok: false, error: "Ollama response had no readable body stream." };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalDuration: number | undefined;

    const processChunk = (json: {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    }) => {
      if (json.response) {
        text += json.response;
        onChunk?.(json.response);
      }
      if (typeof json.prompt_eval_count === "number") inputTokens = json.prompt_eval_count;
      if (typeof json.eval_count === "number") outputTokens = json.eval_count;
      if (typeof json.total_duration === "number") totalDuration = json.total_duration;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        processChunk(JSON.parse(line));
      }
    }
    if (buffer.trim()) processChunk(JSON.parse(buffer));

    const totalTokens = inputTokens + outputTokens;

    return {
      ok: true,
      text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      latencyMs: typeof totalDuration === "number" ? Math.round(totalDuration / 1_000_000) : undefined,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function listOllamaModels(endpoint: string): Promise<string[]> {
  const base = normalizeEndpoint(endpoint);
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || [])
      .map((m: { name?: string }) => m.name || "")
      .filter((name: string) => name.length > 0);
  } catch {
    return [];
  }
}
