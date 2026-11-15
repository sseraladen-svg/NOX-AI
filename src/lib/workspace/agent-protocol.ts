// Action protocol the workspace agent uses instead of dumping code into chat.
// Primary format: <nox:...> tags. Fallback (small local models): a fenced code block whose first
// line is a `file: <path>` comment is treated as a full-file write.
import { extractPathHint } from "./code-blocks.ts";

export type AgentAction =
  | { type: "write"; path: string; content: string }
  | { type: "edit"; path: string; find: string; replace: string }
  | { type: "delete"; path: string }
  | { type: "rename"; from: string; to: string }
  | { type: "mkdir"; path: string }
  | { type: "read"; path: string }
  | { type: "list"; path: string }
  | { type: "search"; query: string }
  | { type: "run"; path: string }
  | { type: "shell"; command: string }
  | { type: "done"; summary: string };

export const MAX_ACTIONS_PER_REPLY = 30;

const TAG = /<nox:(write|edit|delete|rename|mkdir|read|list|search|run|shell|done)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/nox:\1>)/g;
const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3] ?? "";
  return out;
}

const trimNl = (s: string) => s.replace(/^\r?\n/, "").replace(/\r?\n$/, "");

/** Removes a wrapping ``` fence the model sometimes adds inside a tag body. */
function unfence(body: string): string {
  const t = body.trim();
  const m = /^```[\w+-]*\n([\s\S]*?)\n?```$/.exec(t);
  return m ? m[1] : body;
}

const abs = (p: string) => (p.startsWith("/") ? p : "/" + p);

export type ParsedReply = { actions: AgentAction[]; truncated: boolean };

export function parseAgentReply(text: string): ParsedReply {
  const actions: AgentAction[] = [];
  let tagged = 0;
  for (const m of text.matchAll(TAG)) {
    tagged++;
    const type = m[1];
    const a = attrs(m[2] ?? "");
    const body = m[3] ?? "";
    switch (type) {
      case "write":
        if (a.path) actions.push({ type, path: abs(a.path), content: trimNl(unfence(trimNl(body))) });
        break;
      case "edit": {
        const f = /<find>([\s\S]*?)<\/find>/.exec(body);
        const r = /<replace>([\s\S]*?)<\/replace>/.exec(body);
        if (a.path && f) actions.push({ type, path: abs(a.path), find: trimNl(f[1]), replace: r ? trimNl(r[1]) : "" });
        break;
      }
      case "delete":
      case "mkdir":
      case "read":
      case "list":
      case "run":
        if (a.path || type === "list") actions.push({ type, path: abs(a.path || "/") });
        break;
      case "rename":
        if (a.from && a.to) actions.push({ type, from: abs(a.from), to: abs(a.to) });
        break;
      case "search":
        if (a.query || body.trim()) actions.push({ type, query: a.query || body.trim() });
        break;
      case "shell":
        if (body.trim()) actions.push({ type, command: body.trim() });
        break;
      case "done":
        actions.push({ type, summary: body.trim() });
        break;
    }
  }
  // An opened <nox:write>/<nox:edit> without a matching close means the reply was cut off.
  const opens = (text.match(/<nox:(write|edit)\b/g) ?? []).length;
  const closes = (text.match(/<\/nox:(write|edit)>/g) ?? []).length;
  const truncated = opens > closes;

  if (tagged === 0 && !truncated) {
    for (const m of text.matchAll(FENCE)) {
      const hint = extractPathHint(m[2]);
      if (hint.path) actions.push({ type: "write", path: hint.path, content: hint.code.replace(/\n$/, "") });
    }
  }
  return { actions: actions.slice(0, MAX_ACTIONS_PER_REPLY), truncated };
}

/** The human-readable part of a reply: prose only, without actions or the code they carry. */
export function stripActions(text: string): string {
  let out = text.replace(TAG, "");
  out = out.replace(/<nox:(write|edit)\b[\s\S]*$/, ""); // unterminated tail
  out = out.replace(FENCE, (block, _l, code: string) => (extractPathHint(code).path ? "" : block));
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** For live streaming: which file is being written right now, if any. */
export function describeStreaming(raw: string): string {
  const open = /<nox:(write|edit)\s+path\s*=\s*"([^"]+)"[^>]*>(?![\s\S]*<\/nox:\1>)/.exec(raw);
  if (open) return `${open[1] === "write" ? "Writing" : "Editing"} ${open[2]}…`;
  return "";
}

const SENSITIVE_NAME = /^(\.env(\..+)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keystore|jks)|credentials(\..*)?|secrets?(\..*)?)$/i;
const SAFE_ENV = /^\.env\.(example|sample|template)$/i;

/** Files whose contents must never be sent to a model or modified by the agent. */
export function isSensitivePath(path: string): boolean {
  const segs = path.split("/").filter(Boolean);
  if (segs.some((s) => s === ".git" || s === "node_modules")) return true;
  const name = segs[segs.length - 1] ?? "";
  return !SAFE_ENV.test(name) && SENSITIVE_NAME.test(name);
}
