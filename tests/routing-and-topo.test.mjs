import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTask, suggestAlternative } from "../src/lib/workspace/agent-routing.ts";
import { sortTasksTopologically } from "../src/lib/workspace/topo-sort.ts";
import { formatEditorContext } from "../src/lib/workspace/editor-context.ts";

test("analyzeTask routes short 'create a simple python app' with plan and review", () => {
  const analysis = analyzeTask("create a simple python app", { fileCount: 0 });
  assert.equal(analysis.intent, "create");
  assert.notEqual(analysis.complexity, "small");
  assert.ok(analysis.steps.some((s) => s.id === "plan"), "should include plan step");
  assert.ok(analysis.steps.some((s) => s.id === "build" && s.role === "coding"), "should include coding build step");
  assert.ok(analysis.steps.some((s) => s.id === "review" && s.role === "coding"), "should route review to coding");
});

test("analyzeTask keeps 'explain' read-only without plan or review", () => {
  const analysis = analyzeTask("explain how auth works?", { fileCount: 5 });
  assert.equal(analysis.intent, "explain");
  assert.equal(analysis.readOnly, true);
  assert.equal(analysis.steps.length, 1);
  assert.equal(analysis.steps[0].id, "build");
});

test("suggestAlternative falls back from engineering to coding", () => {
  const av = [
    { source: "engineering", model: "", kind: "none", status: "unavailable", note: "unset" },
    { source: "coding", model: "qwen2.5-coder:3b", kind: "ollama", status: "ready", note: "ok" },
  ];
  const sug = suggestAlternative("engineering", av);
  assert.equal(sug.source, "coding");
});

test("sortTasksTopologically orders dependency waves and breaks cycles safely", () => {
  const res = sortTasksTopologically([
    { id: "ui", targetFile: "src/App.tsx", action: "create", instruction: "UI", dependsOn: ["api"] },
    { id: "types", targetFile: "src/types.ts", action: "create", instruction: "Types", dependsOn: [] },
    { id: "api", targetFile: "src/api.ts", action: "create", instruction: "API", dependsOn: ["types"] },
  ]);
  assert.equal(res.hadCycle, false);
  assert.equal(res.missingDeps.length, 0);
  assert.deepEqual(res.waves.map((w) => w.map((t) => t.id)), [["types"], ["api"], ["ui"]]);

  const cyclic = sortTasksTopologically([
    { id: "a", targetFile: "a.ts", action: "create", instruction: "a", dependsOn: ["b"] },
    { id: "b", targetFile: "b.ts", action: "create", instruction: "b", dependsOn: ["a"] },
  ]);
  assert.equal(cyclic.hadCycle, true);
  assert.equal(cyclic.waves.flat().length, 2);
});

test("formatEditorContext injects line numbers, cursor line, and problems", () => {
  const text = formatEditorContext({
    paths: ["/src/app.ts"],
    openTabs: ["/src/app.ts"],
    active: { path: "/src/app.ts", content: "const x = 1;\nconst y = 2;", cursorLine: 2 },
    problems: [{ path: "/src/app.ts", line: 2, message: "Unused variable 'y'" }],
  });
  assert.ok(text.includes("cursor line 2"));
  assert.ok(text.includes("2 | const y = 2;"));
  assert.ok(text.includes("/src/app.ts:2: Unused variable 'y'"));
});

import { SPECIALISTS } from "../src/lib/multi-model-types.ts";
import { normalizeEndpoint } from "../src/lib/local-ollama.ts";

test("SPECIALISTS catalog removes duplicate engineering card", () => {
  assert.equal(SPECIALISTS.some((s) => s.id === "engineering"), false);
  assert.deepEqual(
    SPECIALISTS.map((s) => s.id),
    ["planning", "coding", "vision", "automation"]
  );
});

test("normalizeEndpoint rewrites localhost to 127.0.0.1", () => {
  assert.equal(normalizeEndpoint("http://localhost:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeEndpoint(), "http://127.0.0.1:11434");
});

import { formatOrderedPlan } from "../src/lib/workspace/agent-runner.ts";

test("formatOrderedPlan sorts JSON DAG plan into dependency waves and preserves plain text", () => {
  const jsonPlan = JSON.stringify([
    { id: "ui", targetFile: "/src/App.tsx", action: "create", instruction: "Build UI", dependsOn: ["api"] },
    { id: "api", targetFile: "/src/api.ts", action: "create", instruction: "Build API", dependsOn: [] },
  ]);
  const ordered = formatOrderedPlan(jsonPlan);
  assert.ok(ordered.indexOf("Wave 1:") < ordered.indexOf("Wave 2:"));
  assert.ok(ordered.indexOf("/src/api.ts") < ordered.indexOf("/src/App.tsx"));
  assert.equal(formatOrderedPlan("1. Plain plan"), "1. Plain plan");
});

import { FEATURES, normalizeFeatureId } from "../src/lib/multi-model-types.ts";
import {
  buildAnalysisPayload,
  buildCodingPayload,
  computeMotionMetrics,
  exportWaypointsCsv,
  extractVisionRegions,
} from "../src/lib/multi-mode-workflows.ts";

test("Multi Mode FEATURES excludes automation and aliases legacy automation to coding", () => {
  assert.equal(FEATURES.some((f) => f.id === "automation"), false);
  assert.deepEqual(
    FEATURES.map((f) => f.id),
    ["deep-analysis", "voice", "vision", "coding", "robotics"]
  );
  assert.equal(normalizeFeatureId("automation"), "coding");
});

test("Multi Mode workflow helpers build structured payloads and compute robotics metrics", () => {
  const analysis = buildAnalysisPayload("Check latency", "risk-audit", [
    { id: "1", name: "app.log", content: "ERROR timeout" },
  ]);
  assert.ok(analysis.includes("[Analysis Mode: Risk & Failure Audit]"));
  assert.ok(analysis.includes("--- Source: app.log ---"));

  const coding = buildCodingPayload("TypeError: x", "debug", "TypeScript");
  assert.ok(coding.includes("(Target language: TypeScript)"));

  const regions = extractVisionRegions('```nox-vision\n{"regions":[{"label":"btn","kind":"object","x":0.1,"y":0.2,"width":0.3,"height":0.1}]}\n```');
  assert.equal(regions.length, 1);

  const metrics = computeMotionMetrics(
    [{ x: 0, y: 0, z: 0 }, { x: 30, y: 40, z: 0 }],
    0.5,
    1.0
  );
  assert.equal(metrics.totalDistance, 50);
  assert.equal(metrics.segments, 1);
  assert.ok(exportWaypointsCsv([{ label: "Home", x: 0, y: 0, z: 0 }], "mm").includes("1,\"Home\",0,0,0"));
});
