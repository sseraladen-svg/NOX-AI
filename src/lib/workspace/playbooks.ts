// Pre-written "how to create it properly" rules. A short playbook for the detected kind of
// project is added to the builder's first message so even small models start with the right
// structure and quality bar, in fewer steps. Pure.
import { type VfsState, isFile } from "./vfs.ts";

export type ProjectKind = "web" | "node-script" | "python" | "react" | "node-server" | "docs" | "config" | "generic";

export function detectProjectKind(task: string, vfs: VfsState): ProjectKind {
  const t = task.toLowerCase();
  const has = (p: string) => isFile(vfs, p);
  const pkg = has("/package.json") ? vfs.files["/package.json"] : "";
  if (/\b(readme|documentation|docs?|changelog|guide)\b/.test(t) && !/\b(app|component|function)\b/.test(t)) return "docs";
  if (/\b(json|yaml|yml|config|configuration|dockerfile|env example)\b/.test(t)) return "config";
  if (/\b(python|\.py|flask|django|fastapi|pandas)\b/.test(t) || (has("/main.py") && !/\b(html|js|javascript)\b/.test(t))) return "python";
  if (/\b(react|jsx|tsx|next\.?js|component)\b/.test(t) || /"(react|next)"/.test(pkg)) return "react";
  if (/\b(express|server|endpoint|rest api|backend|node api|http server)\b/.test(t)) return "node-server";
  if (/\b(html|css|webpage|web page|website|landing|page|calculator|todo|to-do|timer|stopwatch|game|form|dashboard|button|ui|widget|clock|quiz)\b/.test(t) || has("/index.html")) return "web";
  if (/\b(script|function|algorithm|cli|parse|sort|fibonacci|prime|utility|helper)\b/.test(t) || has("/index.js")) return "node-script";
  return "generic";
}

/** Applies to every creation task. Kept short: it is sent on every call. */
export const CREATION_RULES = `CREATION RULES
- Complete, working files only: no placeholders, no "...", no TODO stubs.
- One clear purpose per file; sensible names (index.html, style.css, script.js, main.py); keep files under ~300 lines.
- Handle bad input and empty states; no hard-coded secrets; comment only what is not obvious.
- When changing existing code: read it first, match its style, change as little as needed.
- Finish a task in as few replies as possible: write all files together, verify once, then <nox:done>.`;

const BASE: Record<ProjectKind, string> = {
  web: `WEB PAGE PLAYBOOK
Files: /index.html (links /style.css and /script.js with relative paths), /style.css, /script.js. Add them all in ONE reply.
HTML: <!doctype html>, <meta charset>, <meta name="viewport" content="width=device-width, initial-scale=1">, <title>, semantic tags, labelled inputs, <button type="button">.
CSS: mobile-first, flex/grid, readable contrast, :focus-visible styles, no external fonts/CDNs unless asked.
JS: wrap in DOMContentLoaded, no eval(), no globals, keyboard support, show errors in the page (not alert), aria-live for results.
Check: every src/href in index.html points at a file you created.`,
  "node-script": `JAVASCRIPT SCRIPT PLAYBOOK
Runs in a browser sandbox: NO require, NO import, NO fs/process; plain JavaScript + console.log only.
Put logic in small pure functions, then call them with sample data and console.log the results so <nox:run> proves it works. Handle invalid input explicitly.`,
  python: `PYTHON PLAYBOOK
Single file /main.py unless more are needed; functions with type hints and short docstrings; guard with if __name__ == "__main__":; standard library only unless asked.
Python cannot run in the editor sandbox (needs the Local shell), so re-read the file once to check indentation and names.`,
  react: `REACT PLAYBOOK
Function components with typed props, hooks at the top level, key props on lists, state kept minimal, styles co-located or in the existing CSS approach. Use only packages already in package.json; match existing file names and import style. Export what the file name implies.`,
  "node-server": `NODE SERVER PLAYBOOK
Validate input, return proper status codes and JSON errors, keep routes in small handlers, read config from environment variables, never log secrets. Only use packages already in package.json; mention what needs installing in <nox:done>.`,
  docs: `DOCS PLAYBOOK
Markdown with: title, one-line summary, install/run steps in code blocks, usage examples, project structure, notes. Use the real file names from the workspace; do not invent features.`,
  config: `CONFIG PLAYBOOK
Valid syntax for the format, sensible defaults, no real secrets (use placeholders like YOUR_KEY_HERE only in .example files), keep keys sorted or grouped logically.`,
  generic: `GENERAL PLAYBOOK
Pick the simplest structure that works, use conventional file names for the language, and verify by re-reading or running the result.`,
};

const TOPICS: [RegExp, string][] = [
  [/calculator/, "Calculator: buttons for digits, + - × ÷, decimal, clear, backspace, equals; keyboard input; chain operations; guard divide by zero; do not use eval(); show a readable display."],
  [/to-?do|task list/, "To-do: add, complete, delete, filter (all/active/done), item count, persist to localStorage inside try/catch, empty-state message."],
  [/timer|stopwatch|countdown|clock/, "Timer: start/pause/reset, drift-free (use timestamps), format mm:ss, stop at zero with a visible message."],
  [/form|signup|login|register/, "Form: label every field, validate on submit and show inline errors, disable the button while submitting, never store passwords client-side."],
  [/game|snake|tic-?tac-?toe|memory|quiz/, "Game: separate state, update and render; handle win/lose/restart; keyboard and touch controls; no external assets."],
  [/landing|portfolio|website|homepage/, "Landing page: header/nav, hero with one call to action, 3 feature blocks, footer; responsive; real-looking placeholder text (no lorem ipsum)."],
  [/dashboard|chart|graph/, "Dashboard: sample data in one array, render cards/charts with plain HTML/SVG/CSS unless a library is requested, responsive grid."],
  [/api|fetch|http/, "API client: wrap fetch in try/catch, check response.ok, show loading and error states, no hard-coded keys."],
];

export function playbookFor(kind: ProjectKind, task: string, modifying: boolean): string {
  const t = task.toLowerCase();
  const topic = TOPICS.filter(([re]) => re.test(t)).slice(0, 2).map(([, hint]) => hint);
  const parts = [modifying ? "CHANGE PLAYBOOK\nRead the affected files first. Keep the existing style and structure. Use <nox:edit> for small changes; do not reformat unrelated code." : BASE[kind]];
  if (modifying && kind !== "generic") parts.push(BASE[kind].split("\n").slice(1).join("\n"));
  return [...parts, ...topic].join("\n");
}
