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
