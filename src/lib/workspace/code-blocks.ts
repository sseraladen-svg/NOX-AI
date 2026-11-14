// Detects which file an assistant code block is meant for, via a first-line marker comment:
//   // file: src/app.ts      # file: app.py      <!-- file: index.html -->      /* file: a.css */

const HINT = /^\s*(?:\/\/|#|--|\/\*|<!--)\s*file(?:name)?:\s*([^\s*>]+)\s*(?:\*\/|-->)?\s*$/i;

export function extractPathHint(code: string): { path: string | null; code: string } {
  const nl = code.indexOf("\n");
  const first = nl === -1 ? code : code.slice(0, nl);
  const m = HINT.exec(first);
  if (!m) return { path: null, code };
  const path = m[1].replace(/^["'`]|["'`]$/g, "");
  if (!path || path.includes("..")) return { path: null, code };
  return { path: path.startsWith("/") ? path : "/" + path, code: nl === -1 ? "" : code.slice(nl + 1) };
}
