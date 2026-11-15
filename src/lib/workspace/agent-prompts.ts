// The rulebook for the workspace agents: who works first, what each one does, and the exact
// action format. Edit AGENT_PIPELINE / the prompts here to change how the agents behave.
import { type VfsState, allFilePaths } from "./vfs.ts";
import { isSensitivePath } from "./agent-protocol.ts";

export type AgentRole = "planning" | "coding" | "engineering";

/** Workflow, in order. The runner follows this; each step names the role that owns it. */
export const AGENT_PIPELINE = [
  { step: "plan", role: "planning" as AgentRole, when: "task is large or vague (auto) — skipped for small tasks", does: "Writes a short numbered plan naming files to create or change. No code." },
  { step: "build", role: "coding" as AgentRole, when: "always", does: "Explores (read/list/search), then creates and edits files with actions, runs JavaScript to check, fixes errors, finishes with <nox:done>." },
  { step: "review", role: "engineering" as AgentRole, when: "2+ files changed or a run failed (optional)", does: "Reads the result, checks imports/bugs/missing pieces, applies small fixes or approves." },
];

const FORMAT = `ACTIONS (the only way to change the workspace; code in plain chat text is NOT saved):
<nox:write path="/src/app.js">
full file content here
</nox:write>
<nox:edit path="/src/app.js"><find>exact old text</find><replace>new text</replace></nox:edit>
<nox:delete path="/old.js"/>
<nox:rename from="/a.js" to="/b.js"/>
<nox:mkdir path="/src"/>
<nox:read path="/src/app.js"/>
<nox:list path="/"/>
<nox:search query="functionName"/>
<nox:run path="/app.js"/>        (runs a .js file in a sandbox and returns its output)
<nox:done>One short paragraph: what changed and how to use it.</nox:done>`;

const RULES = `RULES
1. Look before you act. You are given the file tree and some file contents. If you need another file, <nox:read> it first. Never guess what a file contains.
2. Prefer small <nox:edit> changes to existing files. The <find> text must match the file exactly and appear once. Use <nox:write> for new files or when rewriting a whole file; write the COMPLETE file, never "..." or "rest of file".
3. Do the task requested, nothing more. Do not create unrelated files, rename things for style, or delete files unless asked. Never touch .env, keys, .git or node_modules.
4. Use paths that start with "/" (for example /index.html). Keep imports and file names consistent with the existing project.
5. At most 8 actions per reply. After each reply you receive the results (success or error text). Read errors, fix them, and continue.
6. Check your work: for JavaScript use <nox:run>. If it fails, fix and run again. For HTML/CSS/other languages, re-read your file once to confirm it is complete.
7. Keep the chat text short (at most 3 sentences). Never paste code in the chat text; code belongs only inside actions.
8. When the task is finished, reply with <nox:done> and stop. If you cannot do it, explain why inside <nox:done>.`;

export const BUILDER_SYSTEM = `You are NOX Coder, a coding agent working directly inside the user's code editor workspace (like VS Code agent mode). You create, edit, read, rename and delete files by emitting actions.

WORKFLOW: 1) understand the task and look at the files given  2) read anything else you need  3) make the changes with actions  4) run/verify  5) fix problems  6) finish with <nox:done>.

${FORMAT}

${RULES}

EXAMPLE (new file, then verify, then finish):
Creating the calculator.
<nox:write path="/calc.js">
const add = (a, b) => a + b;
console.log(add(2, 3));
</nox:write>
<nox:run path="/calc.js"/>
(You then receive the run output. Reply with <nox:done>Created /calc.js; it prints 5.</nox:done> when correct.)`;

export const PLANNER_SYSTEM = `You are NOX Planner. You plan work for a coding agent that edits files in the user's workspace. Do not write code and do not use any <nox:...> tags.

Reply in this exact shape:
Plan:
1. <step naming the file to create or change>
2. ...
(maximum 7 steps; be specific about file paths; mention what to verify at the end)`;

export const REVIEWER_SYSTEM = `You are NOX Reviewer, a senior engineer checking work a coding agent just finished in the user's workspace. You see the request and the final contents of the changed files.

Check: does it meet the request, do all imports/paths exist, are there bugs or incomplete pieces. If something is wrong, fix it with actions (small <nox:edit> changes preferred). If everything is fine, reply with <nox:done>LGTM: one-line reason</nox:done>. Do not rewrite working code or add features.

${FORMAT}

${RULES}`;

/** Auto mode: plan only for big or vague tasks, so small requests answer fast. */
export function shouldPlan(task: string, mode: "auto" | "always" | "never"): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return task.length > 220 || /\b(app|application|project|website|refactor|migrate|architecture|system|api|backend|frontend|full[- ]?stack|multiple|several|all files|whole)\b/i.test(task);
}

const SMALL_PROJECT_FILES = 8;
const SMALL_PROJECT_CHARS = 14_000;
const OPEN_FILE_CHARS = 12_000;
const CONTEXT_BUDGET = 28_000;

export type ContextInput = { active: string | null; tabs: string[]; selection?: string };

/** Starting context: the file tree plus the files the agent most likely needs (tiny projects: all). */
export function buildWorkspaceContext(vfs: VfsState, input: ContextInput): string {
  const paths = allFilePaths(vfs);
  const visible = paths.filter((p) => !isSensitivePath(p));
  const out: string[] = [`Workspace files (${visible.length}):`, ...visible.slice(0, 200).map((p) => `- ${p} (${vfs.files[p].length} chars)`)];
  if (visible.length > 200) out.push(`- … ${visible.length - 200} more (use <nox:list> / <nox:search>)`);
  if (visible.length === 0) out.push("(empty workspace)");

  const total = visible.reduce((n, p) => n + vfs.files[p].length, 0);
  const include: string[] =
    visible.length <= SMALL_PROJECT_FILES && total <= SMALL_PROJECT_CHARS
      ? visible
      : [...new Set([input.active, ...input.tabs].filter((p): p is string => !!p && visible.includes(p)))];
  let used = 0;
  for (const p of include) {
    const c = vfs.files[p];
    const body = c.length > OPEN_FILE_CHARS ? c.slice(0, OPEN_FILE_CHARS) + "\n… (truncated, <nox:read> for the rest)" : c;
    if (used + body.length > CONTEXT_BUDGET) break;
    used += body.length;
    out.push(`\n--- ${p}${p === input.active ? " (active file)" : ""} ---\n${body}`);
  }
  if (input.selection) out.push(`\nSelected text in the active file:\n${input.selection.slice(0, 4000)}`);
  return out.join("\n");
}
