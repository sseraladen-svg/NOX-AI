// Test a Gemini API key against Google's generativelanguage API.
// Usage: bun run /home/z/my-project/scripts/test-gemini-key.ts "<key>"

const key = process.argv[2];
if (!key) {
  console.error("Missing API key argument.");
  process.exit(1);
}

console.log(`Testing key: ${key.slice(0, 4)}...${key.slice(-4)} (length ${key.length})`);

const body = JSON.stringify({
  contents: [{ parts: [{ text: "Reply with exactly: NOX OK" }] }],
  generationConfig: { temperature: 0, maxOutputTokens: 32 },
});

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

const started = Date.now();
try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const latencyMs = Date.now() - started;
  console.log(`\nHTTP ${res.status} (${latencyMs}ms)`);

  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}

  if (res.ok) {
    console.log("\n✅ KEY WORKS — Gemini responded:");
    const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "(no text)";
    console.log(out);
    console.log("\nModel metadata:", {
      finishReason: json?.candidates?.[0]?.finishReason,
      promptTokenCount: json?.usageMetadata?.promptTokenCount,
      candidatesTokenCount: json?.usageMetadata?.candidatesTokenCount,
      totalTokenCount: json?.usageMetadata?.totalTokenCount,
    });
  } else {
    console.log("\n❌ KEY FAILED — error response:");
    console.log(JSON.stringify(json?.error || text, null, 2));
    console.log("\nLikely reason:", diagnoseError(res.status, json?.error?.message || text));
  }
} catch (err: any) {
  console.log(`\n❌ Network error: ${err.message}`);
}

function diagnoseError(status: number, message: string): string {
  const m = (message || "").toLowerCase();
  if (status === 400) {
    if (m.includes("api key not valid") || m.includes("api_key_invalid")) return "API key is invalid or malformed.";
    if (m.includes("api key expired")) return "API key has expired.";
    return "Bad request — model name or payload format issue.";
  }
  if (status === 401 || status === 403) {
    if (m.includes("permission") || m.includes("denied")) return "API key lacks permission for this model.";
    return "Authentication failed — key is wrong or revoked.";
  }
  if (status === 404) return "Model name not found. Check the model id.";
  if (status === 429) return "Rate limit hit. Wait and retry.";
  if (status >= 500) return "Google server error. Retry later.";
  return "Unknown error. See response above.";
}
