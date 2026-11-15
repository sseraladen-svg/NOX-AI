/** Runs one command through the gated Local shell API and returns its combined output (capped). */
export async function execLocalCommand(command: string, cwd = ""): Promise<string> {
  const res = await fetch("/api/workspace/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, cwd }) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(j.error ?? "Local shell failed");
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  let out = "";
  let code = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const raw of lines) {
      if (!raw) continue;
      const e = JSON.parse(raw) as { t: string; d?: string; code?: number };
      if (e.t === "out" || e.t === "err") out += e.d ?? "";
      else if (e.t === "exit") code = e.code ?? 0;
    }
  }
  return `${out.slice(0, 8000)}${code ? `\n[exit ${code}]` : ""}`;
}
