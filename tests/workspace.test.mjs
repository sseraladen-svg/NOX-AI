import assert from "node:assert/strict";
import test from "node:test";
import { emptyVfs, writeFile, normalizePath, listDir, removePath, movePath, buildTree, isDir } from "../src/lib/workspace/vfs.ts";
import { runCommand, tokenize } from "../src/lib/workspace/shell.ts";
import { extractPathHint } from "../src/lib/workspace/code-blocks.ts";
import { languageFor, extensionFor } from "../src/lib/workspace/language.ts";
import { setEditorContextProvider, injectEditorContext, formatEditorContext } from "../src/lib/workspace/editor-context.ts";

test("normalizePath resolves dots and stays inside root", () => {
  assert.equal(normalizePath("../../x", "/a/b"), "/x");
  assert.equal(normalizePath("c/./d", "/a"), "/a/c/d");
  assert.equal(normalizePath("/", "/a"), "/");
  assert.throws(() => normalizePath("a\0b"));
});

test("vfs write/list/move/remove", () => {
  let s = writeFile(emptyVfs(), "/src/a.ts", "x");
  s = writeFile(s, "/src/lib/b.ts", "y");
  assert.deepEqual(listDir(s, "/src").map((e) => e.name), ["lib", "a.ts"]);
  assert.equal(isDir(s, "/src/lib"), true);
  s = movePath(s, "/src", "/app");
  assert.equal(s.files["/app/lib/b.ts"], "y");
  assert.throws(() => removePath(s, "/app"));
  s = removePath(s, "/app", true);
  assert.deepEqual(Object.keys(s.files), []);
  assert.throws(() => writeFile(writeFile(emptyVfs(), "/f", ""), "/f/g", ""));
});

test("buildTree nests directories first", () => {
  const s = writeFile(writeFile(emptyVfs(), "/z.txt", ""), "/d/a.txt", "");
  const t = buildTree(s);
  assert.equal(t[0].name, "d");
  assert.equal(t[0].children[0].path, "/d/a.txt");
});

test("tokenize honours quotes", () => {
  assert.deepEqual(tokenize(`echo "a b" 'c d' e`), ["echo", "a b", "c d", "e"]);
});

test("shell: files, cd, redirect, grep, mv, rm", () => {
  let st = emptyVfs();
  let cwd = "/";
  const run = (l) => { const r = runCommand(st, cwd, l); st = r.state; cwd = r.cwd; return r; };
  run("mkdir -p proj/src");
  run("cd proj");
  assert.equal(run("pwd").out, "/proj");
  run('echo "hello world" > src/a.txt');
  run("echo more >> src/a.txt");
  assert.equal(run("cat src/a.txt").out, "hello world\nmore");
  assert.match(run("grep -i HELLO").out, /\/proj\/src\/a\.txt:1:hello world/);
  run("mv src/a.txt src/b.txt");
  assert.equal(run("ls src").out, "b.txt");
  assert.match(run("rm src").out, /not empty/);
  run("rm -r src");
  assert.equal(run("ls").out, "");
  assert.match(run("nope").out, /command not found/);
  assert.equal(run("node missing.js").out.includes("no such file"), true);
});

test("shell: open/run return actions", () => {
  const st = writeFile(emptyVfs(), "/a.js", "1");
  assert.equal(runCommand(st, "/", "node a.js").run, "/a.js");
  assert.equal(runCommand(st, "/", "open a.js").open, "/a.js");
});

test("extractPathHint reads marker comments", () => {
  assert.deepEqual(extractPathHint("// file: src/a.ts\nconst a = 1;"), { path: "/src/a.ts", code: "const a = 1;" });
  assert.equal(extractPathHint("# file: app.py\nprint(1)").path, "/app.py");
  assert.equal(extractPathHint("<!-- file: index.html -->\n<p/>").path, "/index.html");
  assert.equal(extractPathHint("// file: ../../etc/passwd\nx").path, null);
  assert.equal(extractPathHint("const x = 1;").path, null);
});

test("language helpers", () => {
  assert.equal(languageFor("/a/b.tsx"), "typescript");
  assert.equal(languageFor("py"), "python");
  assert.equal(languageFor("/README"), "plaintext");
  assert.equal(extensionFor("typescript"), "ts");
});

test("editor context is appended to the last user message only when a provider exists", () => {
  const msgs = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
  assert.equal(injectEditorContext(msgs), msgs);
  setEditorContextProvider(() => ({ paths: ["/a.ts"], openTabs: ["/a.ts"], active: { path: "/a.ts", content: "code", selection: "sel" } }));
  const out = injectEditorContext(msgs);
  assert.equal(out[0].content, "a");
  assert.match(out[2].content, /^c\n\n\[Workspace context/);
  assert.match(out[2].content, /Active file: \/a\.ts/);
  assert.match(formatEditorContext({ paths: [], openTabs: [] }), /Files \(0\)/);
  setEditorContextProvider(null);
});

import { inlineAssets } from "../src/lib/workspace/preview.ts";
test("inlineAssets inlines relative css/js, leaves external urls", () => {
  const s = writeFile(writeFile(emptyVfs(), "/site/style.css", "p{color:red}"), "/site/app.js", "alert(1)</script>");
  const html = '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="https://x.test/a.css"><script src="app.js"></script><script src="missing.js"></script>';
  const out = inlineAssets(html, s, "/site");
  assert.match(out, /<style>p\{color:red\}<\/style>/);
  assert.match(out, /href="https:\/\/x\.test\/a\.css"/);
  assert.match(out, /<script>alert\(1\)<\\\/script><\/script>/);
  assert.match(out, /src="missing\.js"/);
});
