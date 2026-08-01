export {}

// Test multiple Gemini model names against the same key to determine if
// the key is valid (just the wrong model) or invalid.
// Usage: bun run /home/z/my-project/scripts/test-gemini-key-models.ts "<key>"

const key = process.argv[2];
if (!key) {
  console.error("Missing API key");
  process.exit(1);
}

const models = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-pro",
];

console.log(`Testing key: ${key.slice(0, 4)}...${key.slice(-4)} (length ${key.length})\n`);

let anyWorked = false;

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: "Reply with exactly: NOX OK" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 32 },
  });

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const latency = Date.now() - started;
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}

    if (res.ok) {
      anyWorked = true;
      const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "(no text)";
      console.log(`✅ ${model.padEnd(22)} HTTP ${res.status} ${latency}ms — replied: ${out.trim().slice(0, 40)}`);
    } else {
      const msg = json?.error?.message?.slice(0, 90) || text.slice(0, 90);
      const reason = diagnose(res.status, json?.error?.message || text);
      console.log(`❌ ${model.padEnd(22)} HTTP ${res.status} ${latency}ms — ${msg}`);
      console.log(`   → ${reason}`);
    }
  } catch (err: any) {
    console.log(`❌ ${model.padEnd(22)} NETWORK ERROR — ${err.message}`);
  }
}

console.log("\n--- ListModels check ---");
try {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const text = await res.text();
  if (res.ok) {
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    const models = json?.models || [];
    console.log(`✅ ListModels OK — ${models.length} models visible to this key`);
    const names = models.map((m: any) => m.name?.replace("models/", "")).filter(Boolean);
    console.log("Sample models:", names.slice(0, 8).join(", "));
  } else {
    console.log(`❌ ListModels HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
} catch (err: any) {
  console.log(`❌ ListModels network error: ${err.message}`);
}

console.log(`\n=== SUMMARY: ${anyWorked ? "KEY IS VALID — at least one model worked ✅" : "KEY DOES NOT WORK with any tested model ❌"} ===`);

function diagnose(status: number, message: string): string {
  const m = (message || "").toLowerCase();
  if (status === 400 && (m.includes("api key not valid") || m.includes("api_key_invalid"))) return "API key is invalid";
  if (status === 400 && m.includes("api key expired")) return "API key has expired";
  if (status === 401 || status === 403) {
    if (m.includes("permission") || m.includes("denied")) return "Key lacks permission for this model";
    return "Authentication failed — key is wrong or revoked";
  }
  if (status === 404) return "Model name not found / not supported for this key";
  if (status === 429) return "Rate limit hit — wait and retry";
  if (status >= 500) return "Google server error";
  return "Unknown error";
}
