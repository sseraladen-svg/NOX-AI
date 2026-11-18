import assert from "node:assert/strict";
import test from "node:test";
import { emptyVfs, writeFile } from "../src/lib/workspace/vfs.ts";
import { parseAgentReply, stripActions, isSensitivePath, describeStreaming } from "../src/lib/workspace/agent-protocol.ts";
import { applyAction, summarizeChanges } from "../src/lib/workspace/agent-exec.ts";
import { runAgent } from "../src/lib/workspace/agent-runner.ts";
import { buildWorkspaceContext, shouldPlan } from "../src/lib/workspace/agent-prompts.ts";

test("parseAgentReply reads every tag type", () => {
  const r = parseAgentReply(`Doing it.
<nox:write path="src/a.js">
const a = 1;
</nox:write>
<nox:edit path="/b.js"><find>x</find><replace>y</replace></nox:edit>
<nox:delete path="/c.js"/><nox:rename from="/d" to="/e"/><nox:mkdir path="/m"/>
<nox:read path="/a.js"/><nox:list path="/"/><nox:search query="foo"/><nox:run path="/a.js"/>
<nox:shell>npm test</nox:shell><nox:done>All good</nox:done>`);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.actions.map((a) => a.type), ["write", "edit", "delete", "rename", "mkdir", "read", "list", "search", "run", "shell", "done"]);
  assert.deepEqual(r.actions[0], { type: "write", path: "/src/a.js", content: "const a = 1;" });
  assert.equal(r.actions[1].find, "x");
});

test("write bodies tolerate wrapping code fences; fenced file: blocks are a fallback", () => {
  assert.equal(parseAgentReply('<nox:write path="/a.js">\n```js\nlet x;\n```\n</nox:write>').actions[0].content, "let x;");
  const fb = parseAgentReply("Here:\n```js\n// file: /calc.js\nconsole.log(1)\n```");
  assert.deepEqual(fb.actions, [{ type: "write", path: "/calc.js", content: "console.log(1)" }]);
  assert.equal(parseAgentReply("```js\nconsole.log(1)\n```").actions.length, 0);
});

test("truncated replies are detected and not applied", () => {
  const r = parseAgentReply('ok <nox:write path="/a.js">\nconst a = ');
  assert.equal(r.truncated, true);
  assert.equal(r.actions.length, 0);
  assert.equal(stripActions('ok <nox:write path="/a.js">\nconst a = '), "ok");
  assert.equal(describeStreaming('hi <nox:write path="/a.js">\nconst'), "Writing /a.js…");
});

test("stripActions keeps only prose", () => {
  assert.equal(stripActions('Created it.\n<nox:write path="/a">x</nox:write>\nDone.'), "Created it.\n\nDone.".replace("\n\n", "\n\n"));
});

test("sensitive paths", () => {
  for (const p of ["/.env", "/.env.local", "/a/id_rsa", "/k.pem", "/.git/config", "/node_modules/x/index.js", "/secrets.json"]) assert.equal(isSensitivePath(p), true, p);
  for (const p of ["/.env.example", "/src/app.ts", "/README.md"]) assert.equal(isSensitivePath(p), false, p);
});

test("applyAction: write/edit/delete/rename/read/search", () => {
  let s = emptyVfs();
  const run = (a) => { const r = applyAction(s, a); s = r.state; return r.result; };
  assert.match(run({ type: "write", path: "/a.js", content: "one\ntwo" }).message, /Created \/a\.js \(2 lines\)/);
  assert.match(run({ type: "write", path: "/a.js", content: "three" }).message, /Updated/);
  assert.equal(run({ type: "edit", path: "/a.js", find: "three", replace: "four" }).ok, true);
  assert.equal(s.files["/a.js"], "four");
  assert.match(run({ type: "edit", path: "/a.js", find: "nope", replace: "x" }).message, /not found/);
  run({ type: "write", path: "/b.js", content: "a a" });
  assert.match(run({ type: "edit", path: "/b.js", find: "a", replace: "x" }).message, /matches 2 places/);
  assert.equal(run({ type: "read", path: "/a.js" }).output, "--- /a.js ---\nfour");
  assert.match(run({ type: "search", query: "FOUR" }).output, /\/a\.js:1: four/);
  assert.equal(run({ type: "rename", from: "/a.js", to: "/c/a.js" }).ok, true);
  assert.equal(run({ type: "delete", path: "/c/a.js" }).ok, true);
  assert.match(run({ type: "delete", path: "/c" }).message, /folder/);
  assert.match(run({ type: "write", path: "/.env", content: "X=1" }).message, /protected/);
  assert.match(run({ type: "read", path: "/.env" }).message, /protected/);
});

test("edit preserves CRLF files", () => {
  const s = writeFile(emptyVfs(), "/w.txt", "a\r\nb\r\n");
  const r = applyAction(s, { type: "edit", path: "/w.txt", find: "a\nb", replace: "a\nc" });
  assert.equal(r.state.files["/w.txt"], "a\r\nc\r\n");
});

test("summarizeChanges", () => {
  const a = writeFile(writeFile(emptyVfs(), "/x", "1"), "/y", "1");
  const b = writeFile(writeFile(emptyVfs(), "/x", "2"), "/z", "1");
  assert.deepEqual(summarizeChanges(a, b), [{ path: "/x", status: "modified" }, { path: "/y", status: "deleted" }, { path: "/z", status: "added" }]);
});

test("context: small projects are fully included, secrets never", () => {
  let s = writeFile(writeFile(emptyVfs(), "/a.js", "AAA"), "/.env", "SECRET=1");
  const c = buildWorkspaceContext(s, { active: null, tabs: [] });
  assert.match(c, /AAA/);
  assert.doesNotMatch(c, /SECRET/);
  assert.doesNotMatch(c, /\.env/);
});

test("shouldPlan: auto skips small tasks", () => {
  assert.equal(shouldPlan("make a calculator", "auto"), false);
  assert.equal(shouldPlan("build a full-stack app with login", "auto"), true);
  assert.equal(shouldPlan("x", "always"), true);
  assert.equal(shouldPlan("build an app", "never"), false);
});

function harness(replies, over = {}) {
  let vfs = emptyVfs();
  const events = [], calls = [];
  const queue = { ...replies };
  const deps = {
    callModel: async (role, system, messages) => { calls.push({ role, last: messages[messages.length - 1].content }); const q = queue[role] ?? []; return q.shift() ?? "<nox:done>fallback</nox:done>"; },
    getVfs: () => vfs, commit: (n) => { vfs = n; }, context: () => ({ active: null, tabs: [] }),
    runFile: async () => "5\n", runShell: async () => { throw new Error("off"); }, emit: (e) => events.push(e), ...over,
  };
  return { deps, events, calls, get vfs() { return vfs; } };
}

test("agent: creates a file, runs it, finishes — one coder call per step, no planner for small tasks", async () => {
  const h = harness({ coding: ['Creating.\n<nox:write path="/calc.js">\nconsole.log(2+3)\n</nox:write>\n<nox:run path="/calc.js"/>', "<nox:done>Created /calc.js</nox:done>"] });
  const r = await runAgent("make a calculator", [], h.deps);
  assert.equal(r.status, "done");
  assert.equal(h.vfs.files["/calc.js"], "console.log(2+3)");
  assert.deepEqual(h.calls.map((c) => c.role), ["coding", "coding"]);
  assert.match(h.calls[1].last, /OK: Created \/calc\.js/);
  assert.match(h.calls[1].last, /5/);
  assert.equal(r.summary, "Created /calc.js");
  assert.deepEqual(r.changes, [{ path: "/calc.js", status: "added" }]);
});

test("agent: plans for big tasks, reviews multi-file changes, review fixes apply", async () => {
  const h = harness({
    planning: ["Plan:\n1. /a.js\n2. /b.js"],
    coding: ['<nox:write path="/a.js">\nA\n</nox:write><nox:write path="/b.js">\nB\n</nox:write>', "<nox:done>built</nox:done>"],
    engineering: ['<nox:edit path="/b.js"><find>B</find><replace>B2</replace></nox:edit>', "<nox:done>fixed b</nox:done>"],
  });
  const r = await runAgent("build a full-stack app", [], h.deps);
  assert.deepEqual(h.calls.map((c) => c.role), ["planning", "coding", "coding", "engineering", "engineering"]);
  assert.equal(h.vfs.files["/b.js"], "B2");
  assert.match(r.summary, /built[\s\S]*Review: fixed b/);
});

test("agent: failed edit is reported back so the model can retry; reads feed content", async () => {
  const h = harness({ coding: ['<nox:read path="/a.js"/>', '<nox:edit path="/a.js"><find>zzz</find><replace>q</replace></nox:edit>', '<nox:edit path="/a.js"><find>old</find><replace>new</replace></nox:edit>', "<nox:done>ok</nox:done>"] });
  h.deps.commit(writeFile(emptyVfs(), "/a.js", "old"));
  const r = await runAgent("fix it", [], h.deps);
  assert.match(h.calls[1].last, /--- \/a\.js ---\nold/);
  assert.match(h.calls[2].last, /ERROR: Edit failed/);
  assert.equal(h.vfs.files["/a.js"], "new");
  assert.equal(r.status, "done");
});

test("agent: truncated reply is not applied and the model is told", async () => {
  const h = harness({ coding: ['<nox:write path="/big.js">\nconst x = ', '<nox:write path="/big.js">\nok\n</nox:write>', "<nox:done>done</nox:done>"] });
  await runAgent("write big", [], h.deps);
  assert.match(h.calls[1].last, /cut off/);
  assert.equal(h.vfs.files["/big.js"], "ok");
});

test("agent: code pasted in chat is nudged into a file write once", async () => {
  const h = harness({ coding: ["Here you go:\n```js\nfunction add(a, b) { return a + b; }\nconsole.log(add(1, 2));\n```", '<nox:write path="/add.js">\nfunction add(a, b) { return a + b; }\n</nox:write>', "<nox:done>saved</nox:done>"] });
  const r = await runAgent("add function", [], h.deps);
  assert.match(h.calls[1].last, /NOT saved/);
  assert.ok(h.vfs.files["/add.js"]);
  assert.equal(r.status, "done");
});

test("agent: plain answer without actions ends as chat; step limit stops; abort stops", async () => {
  let h = harness({ coding: ["It is a function that adds numbers."] });
  assert.equal((await runAgent("what does this do", [], h.deps)).status, "chat");
  h = harness({ coding: Array(20).fill('<nox:list path="/"/>') });
  assert.equal((await runAgent("loop", [], h.deps, { maxSteps: 3 })).status, "limit");
  const ctl = new AbortController();
  h = harness({ coding: ['<nox:list path="/"/>'] }, { signal: ctl.signal, callModel: async () => { ctl.abort(); return '<nox:list path="/"/>'; } });
  assert.equal((await runAgent("x", [], h.deps)).status, "stopped");
});

test("agent: model errors surface as status error; shell declined is reported to the model", async () => {
  let h = harness({}, { callModel: async () => { throw new Error("Ollama not reachable"); } });
  const r = await runAgent("x", [], h.deps);
  assert.equal(r.status, "error");
  assert.ok(h.events.some((e) => e.type === "error" && /Ollama/.test(e.message)));
  h = harness({ coding: ["<nox:shell>npm test</nox:shell>", "<nox:done>ok</nox:done>"] });
  await runAgent("run tests", [], h.deps);
  assert.match(h.calls[1].last, /ERROR: Shell command not run: off/);
});

import { revertChanges } from "../src/lib/workspace/agent-exec.ts";
import { formatEditorContext } from "../src/lib/workspace/editor-context.ts";
test("revertChanges restores only agent-touched files", () => {
  const before = writeFile(writeFile(emptyVfs(), "/a", "A"), "/b", "B");
  let cur = writeFile(writeFile(writeFile(before, "/a", "A2"), "/new", "N"), "/user", "U");
  cur = { files: { ...cur.files }, dirs: cur.dirs }; delete cur.files["/b"];
  const out = revertChanges(cur, before, [{ path: "/a", status: "modified" }, { path: "/b", status: "deleted" }, { path: "/new", status: "added" }]);
  assert.deepEqual(out.files, { "/a": "A", "/b": "B", "/user": "U" });
});
test("editor context hides protected files", () => {
  const t = formatEditorContext({ paths: ["/.env", "/a.js"], openTabs: [], active: { path: "/.env", content: "SECRET=1" } });
  assert.doesNotMatch(t, /SECRET|- \/\.env/);
  assert.match(t, /hidden: protected/);
});

import { analyzeTask, suggestAlternative, rankModels, modelQuality, paramsB } from "../src/lib/workspace/agent-routing.ts";
import { compactMessages, dropFileBodies, formatHandoff } from "../src/lib/workspace/agent-runner.ts";

test("analyzeTask: intent, size and agents by rules (no model call)", () => {
  let a = analyzeTask("create a simple calculator", { fileCount: 2 });
  assert.deepEqual([a.intent, a.complexity, a.readOnly, a.autoFinish], ["create", "small", false, true]);
  assert.deepEqual(a.steps.map((s) => s.id), ["build"]);
  assert.equal(a.budget.ctx, 4096);
  a = analyzeTask("Explain what this project does", { fileCount: 3 });
  assert.deepEqual([a.intent, a.readOnly], ["explain", true]);
  assert.deepEqual(a.steps.map((s) => s.id), ["build"]);
  assert.equal(a.maxSteps, 3);
  a = analyzeTask("build a full-stack app with login, a dashboard and an admin API", { fileCount: 0 });
  assert.equal(a.complexity, "large");
  assert.deepEqual(a.steps.map((s) => s.id), ["plan", "build", "review"]);
  a = analyzeTask("plan the architecture for a chat system", { fileCount: 0 });
  assert.deepEqual([a.intent, a.planOnly], ["plan", true]);
  assert.deepEqual(a.steps.map((s) => s.id), ["plan"]);
  a = analyzeTask("automate the daily report with a workflow script", { fileCount: 1 });
  assert.equal(a.steps.find((s) => s.id === "build").role, "automation");
  assert.match(analyzeTask("fix the bug in the screenshot", { fileCount: 1 }).notes.join(" "), /image/i);
  assert.match(analyzeTask("delete the unused files", { fileCount: 5 }).notes.join(" "), /undone/i);
});

test("model quality, ranking and alternatives", () => {
  assert.equal(modelQuality("moondream:latest").ok, false);
  assert.match(modelQuality("llama3.2:latest").warn, /Small model/);
  assert.equal(modelQuality("qwen2.5-coder:7b").warn, undefined);
  assert.equal(paramsB("llama3.2:latest"), 3);
  assert.deepEqual(rankModels(["moondream:latest", "llama3.2:latest", "qwen2.5-coder:7b"]), ["qwen2.5-coder:7b", "llama3.2:latest"]);
  const av = [
    { source: "coding", model: "llama3.2:latest", kind: "ollama", status: "unavailable", note: "x", installed: [] },
    { source: "host", model: "moondream:latest", kind: "ollama", status: "ready", note: "", installed: ["moondream:latest"] },
    { source: "engineering", model: "gpt-4o-mini", kind: "api", status: "unavailable", note: "no key" },
  ];
  assert.match(suggestAlternative("coding", av).message, /pull qwen2\.5-coder/);
  const av2 = [{ ...av[0], status: "ready" }, ...av.slice(1)];
  assert.equal(suggestAlternative("coding", av2).source, "coding");
  assert.equal(suggestAlternative("engineering", av2).source, "coding");
});

test("compaction drops stale file bodies and old write bodies", () => {
  const ctx = "Workspace files (2):\n- /a.js\n- /b.js\n\n--- /a.js (active file) ---\nAAAA\nmore\n\n--- /b.js ---\nBBBB\n\nTask: x";
  assert.match(dropFileBodies(ctx, new Set(["/a.js"])), /--- \/a\.js ---\n\[changed by the agent[\s\S]*--- \/b\.js ---\nBBBB/);
  assert.doesNotMatch(dropFileBodies(ctx, new Set(["/a.js"])), /AAAA/);
  const msgs = [
    { role: "user", content: ctx },
    { role: "assistant", content: '<nox:write path="/a.js">\nl1\nl2\nl3\n</nox:write>' },
    { role: "user", content: "Results:\n" + "x".repeat(900) },
    { role: "assistant", content: "ok" }, { role: "user", content: "r" }, { role: "assistant", content: '<nox:write path="/z">\nkeep\n</nox:write>' },
    { role: "user", content: "r2" }, { role: "assistant", content: "ok2" },
  ];
  const out = compactMessages(msgs, new Set(["/a.js"]));
  assert.match(out[0].content, /changed by the agent/);
  assert.match(out[1].content, /content omitted: 5 lines|content omitted: 4 lines/);
  assert.match(out[2].content, /older results trimmed/);
  assert.match(out[5].content, /keep/); // recent messages stay intact
});

test("formatHandoff carries plan, changes, run log and issues", () => {
  const vfs = writeFile(emptyVfs(), "/a.js", "code");
  const t = formatHandoff("do x", { plan: "1. a", summary: "built", changes: [{ path: "/a.js", status: "added" }], runLog: ["/a.js: 5"], issues: ["Edit failed"] }, vfs);
  for (const part of ["Request: do x", "1. a", "built", "added /a.js", "/a.js: 5", "Edit failed", "--- /a.js (added) ---"]) assert.ok(t.includes(part), part);
});

test("agent: read-only rejects writes; plan-only stops after the plan; small tasks auto-finish in one call", async () => {
  let h = harness({ coding: ['<nox:write path="/x.js">\n1\n</nox:write>', "It prints a greeting."] });
  const r1 = await runAgent("what does this do", [], h.deps, { readOnly: true });
  assert.equal(h.vfs.files["/x.js"], undefined);
  assert.match(h.calls[1].last, /read-only request/);
  assert.equal(r1.status, "done");
  h = harness({ planning: ["Plan:\n1. do it"] });
  const r2 = await runAgent("plan a thing", [], h.deps, { planOnly: true });
  assert.deepEqual(h.calls.map((c) => c.role), ["planning"]);
  assert.deepEqual([r2.status, r2.summary, r2.calls], ["chat", "Plan:\n1. do it", 1]);
  h = harness({ coding: ['<nox:write path="/c.js">\nconsole.log(1)\n</nox:write>'] });
  const r3 = await runAgent("make c", [], h.deps, { autoFinish: true });
  assert.equal(r3.calls, 1);
  assert.equal(h.vfs.files["/c.js"], "console.log(1)");
  h = harness({ coding: ['<nox:write path="/c.js">\nconsole.log(1)\n</nox:write><nox:run path="/c.js"/>', "<nox:done>ok</nox:done>"] });
  assert.equal((await runAgent("make c", [], h.deps, { autoFinish: true })).calls, 2); // run needs its result
});

test("agent: planner sees the tree without file bodies; automation role is used for the build", async () => {
  const h = harness({ planning: ["Plan:\n1. a"], coding: ["x"], automation: ["<nox:done>ok</nox:done>"] });
  h.deps.commit(writeFile(emptyVfs(), "/secret-code.js", "UNIQUE_BODY"));
  await runAgent("build an app", [], h.deps, { plan: "always", buildRole: "automation" });
  assert.doesNotMatch(h.calls[0].last, /UNIQUE_BODY/);
  assert.match(h.calls[0].last, /\/secret-code\.js/);
  assert.deepEqual(h.calls.map((c) => c.role), ["planning", "automation"]);
});

import { effectiveSource } from "../src/lib/workspace/agent-routing.ts";
test("effectiveSource honours usable overrides and rejects unusable ones", () => {
  const av = [
    { source: "coding", model: "qwen2.5-coder:7b", kind: "ollama", status: "ready", note: "" },
    { source: "host", model: "moondream:latest", kind: "ollama", status: "warn", note: "vision model" },
    { source: "engineering", model: "gpt-4o-mini", kind: "api", status: "unavailable", note: "no key" },
  ];
  assert.equal(effectiveSource("coding", null, av), "coding");
  assert.equal(effectiveSource("engineering", null, av), "coding");
  assert.equal(effectiveSource("coding", "engineering", av), null);
  assert.equal(effectiveSource("coding", "host", av), null);
});

import { fuzzyMatch, fuzzyFilter } from "../src/lib/workspace/fuzzy.ts";
import { searchFiles, replaceInFiles, globToRegExp } from "../src/lib/workspace/search.ts";
import { validateFiles } from "../src/lib/workspace/validators.ts";
import { detectProjectKind, playbookFor, CREATION_RULES } from "../src/lib/workspace/playbooks.ts";
import { parseHostClassification } from "../src/lib/workspace/classify.ts";

test("fuzzy: subsequence match, ranking prefers file names and consecutive hits", () => {
  assert.equal(fuzzyMatch("xyz", "/src/app.js"), null);
  const r = fuzzyFilter(["/src/components/button.tsx", "/src/app.ts", "/README.md"], "app", (x) => x);
  assert.equal(r[0].item, "/src/app.ts");
  assert.ok(fuzzyMatch("bt", "/src/button.tsx").positions.length === 2);
  assert.equal(fuzzyFilter(["a", "b"], "", (x) => x).length, 2);
});

test("search: plain, regex, whole word, case, include globs", () => {
  let s = writeFile(writeFile(writeFile(emptyVfs(), "/src/a.js", "const Foo = 1;\nfoo(foo)"), "/src/b.ts", "foobar"), "/c.md", "foo");
  assert.equal(searchFiles(s, { query: "foo" }).total, 5);
  assert.equal(searchFiles(s, { query: "foo", caseSensitive: true }).total, 4);
  assert.equal(searchFiles(s, { query: "foo", wholeWord: true }).total, 4);
  assert.equal(searchFiles(s, { query: "fo+", regex: true, include: "*.js" }).results.length, 1);
  assert.equal(searchFiles(s, { query: "foo", include: "src/**", exclude: "*.ts" }).results.length, 1);
  assert.match(searchFiles(s, { query: "(", regex: true }).error, /./);
  assert.equal(globToRegExp("*.js").test("/x/y/a.js"), true);
  assert.equal(globToRegExp("src/**").test("/src/a/b.js"), true);
  const r = replaceInFiles(s, { query: "foo", caseSensitive: true }, "BAR");
  assert.deepEqual([r.count, r.vfs.files["/src/a.js"]], [4, "const Foo = 1;\nBAR(BAR)"]);
  const r2 = replaceInFiles(s, { query: "(f)oo", regex: true }, "[$1]", ["/c.md"]);
  assert.equal(r2.vfs.files["/c.md"], "[f]");
  assert.equal(r2.vfs.files["/src/b.ts"], "foobar");
});

test("validators catch broken references, syntax, JSON, braces and placeholders", () => {
  const s = writeFile(writeFile(writeFile(writeFile(writeFile(emptyVfs(),
    "/index.html", '<html><link rel="stylesheet" href="style.css"><script src="missing.js"></script></html>'),
    "/bad.js", "const = ;"), "/c.json", "{a:1}"), "/s.css", "p { color: red;"), "/p.js", "function f() {\n  // ... rest of file\n}");
  const issues = validateFiles(s, ["/index.html", "/bad.js", "/c.json", "/s.css", "/p.js"]);
  const msgs = issues.map((i) => `${i.path}|${i.severity}|${i.message}`).join("\n");
  assert.match(msgs, /index\.html\|error\|References "style\.css"/);
  assert.match(msgs, /index\.html\|error\|References "missing\.js"/);
  assert.match(msgs, /index\.html\|warning\|Missing <!doctype/);
  assert.match(msgs, /bad\.js\|error\|Syntax error/);
  assert.match(msgs, /c\.json\|error\|Invalid JSON/);
  assert.match(msgs, /s\.css\|error\|Unbalanced braces/);
  assert.match(msgs, /p\.js\|error\|Contains a placeholder/);
  const ok = writeFile(writeFile(writeFile(emptyVfs(), "/index.html", '<!doctype html><title>t</title><meta name="viewport" content="x"><link rel="stylesheet" href="s.css"><script src="a.js"></script>'), "/s.css", "p{}"), "/a.js", "import './b.js'");
  assert.equal(validateFiles(writeFile(ok, "/b.js", "1"), ["/index.html", "/a.js"]).filter((i) => i.severity === "error").length, 0);
  assert.equal(validateFiles(ok, ["/a.js"]).filter((i) => /b\.js/.test(i.message)).length, 1);
});

test("playbooks: kind detection and topic hints", () => {
  const e = emptyVfs();
  assert.equal(detectProjectKind("create a simple calculator", e), "web");
  assert.equal(detectProjectKind("write a python script to sort files", e), "python");
  assert.equal(detectProjectKind("add a Button component", e), "react");
  assert.equal(detectProjectKind("write a README", e), "docs");
  assert.equal(detectProjectKind("sort an array of numbers", e), "node-script");
  const pb = playbookFor("web", "create a calculator", false);
  assert.match(pb, /WEB PAGE PLAYBOOK/);
  assert.match(pb, /divide by zero/);
  assert.match(playbookFor("web", "fix the layout", true), /CHANGE PLAYBOOK/);
  assert.match(CREATION_RULES, /no placeholders/);
});

test("host classification parsing", () => {
  assert.deepEqual(parseHostClassification('Sure! {"intent":"create","size":"large"}'), { intent: "create", complexity: "large" });
  assert.equal(parseHostClassification("no json"), null);
  assert.equal(parseHostClassification('{"intent":"dance","size":"small"}'), null);
});

test("analyzeTask with a Host classification override", () => {
  const a = analyzeTask("hmm do the thing", { fileCount: 0 }, { intent: "create", complexity: "large" });
  assert.deepEqual([a.source, a.intent, a.complexity, a.confidence], ["host", "create", "large", 0.85]);
  assert.deepEqual(a.steps.map((s) => s.id), ["plan", "build", "review"]);
  assert.equal(analyzeTask("make a calculator", { fileCount: 0 }).source, "rules");
});

test("agent: automatic checks send errors back, the builder fixes them, then it passes", async () => {
  const h = harness({ coding: ['<nox:write path="/index.html">\n<!doctype html><title>t</title><meta name="viewport" content="x"><script src="app.js"></script>\n</nox:write>', '<nox:write path="/app.js">\nconsole.log(1)\n</nox:write><nox:done>fixed</nox:done>'] });
  const events = h.events;
  const r = await runAgent("make a page", [], h.deps, { autoFinish: true, fixRounds: 1 });
  assert.match(h.calls[1].last, /Automatic checks found problems[\s\S]*app\.js/);
  assert.equal(h.vfs.files["/app.js"], "console.log(1)");
  const v = events.filter((e) => e.type === "verify");
  assert.deepEqual(v.map((e) => e.passed), [false, true]);
  assert.equal(r.status, "done");
});

test("agent: playbook is added for creation, not for read-only", async () => {
  let h = harness({ coding: ["<nox:done>x</nox:done>"] });
  await runAgent("create a simple calculator", [], h.deps);
  assert.match(h.calls[0].last, /WEB PAGE PLAYBOOK[\s\S]*divide by zero/);
  h = harness({ coding: ["answer"] });
  await runAgent("explain this", [], h.deps, { readOnly: true });
  assert.doesNotMatch(h.calls[0].last, /PLAYBOOK/);
});
