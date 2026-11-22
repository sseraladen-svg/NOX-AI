// Pure, client-safe workflow helpers for Multi Mode's 5 dedicated sessions:
// deep-analysis, coding, vision, voice, and robotics.

export interface AnalysisSource {
  id: string;
  name: string;
  content: string;
}

export const ANALYSIS_LENSES = [
  {
    id: "breakdown",
    label: "Deep Breakdown",
    instruction:
      "Provide a structured, evidence-backed breakdown with clear headings, key mechanisms, and concrete examples.",
  },
  {
    id: "tradeoffs",
    label: "Trade-off Matrix",
    instruction:
      "Compare the options in a structured Markdown table covering pros, cons, cost/complexity, and when each option wins.",
  },
  {
    id: "risk-audit",
    label: "Risk & Failure Audit",
    instruction:
      "Identify hidden assumptions, edge cases, failure modes, security/operational risks, and concrete mitigations.",
  },
  {
    id: "exec-brief",
    label: "Executive Brief",
    instruction:
      "Lead with a 3-sentence verdict, followed by key metrics, top 3 decisions needed, and next steps.",
  },
] as const;

export type AnalysisLensId = (typeof ANALYSIS_LENSES)[number]["id"];

const MAX_SOURCE_CHARS = 12_000;

export function estimateSourceTokens(sources: AnalysisSource[]): number {
  const totalChars = sources.reduce((sum, s) => sum + s.content.length, 0);
  return Math.ceil(totalChars / 4);
}

export function buildAnalysisPayload(
  prompt: string,
  lensId: AnalysisLensId,
  sources: AnalysisSource[]
): string {
  const lens = ANALYSIS_LENSES.find((l) => l.id === lensId) ?? ANALYSIS_LENSES[0];
  const parts: string[] = [`[Analysis Mode: ${lens.label}]\n${lens.instruction}`];
  if (sources.length > 0) {
    parts.push(
      sources
        .map((s) => {
          const body =
            s.content.length > MAX_SOURCE_CHARS
              ? s.content.slice(0, MAX_SOURCE_CHARS) + "\n…[truncated]"
              : s.content;
          return `--- Source: ${s.name} ---\n${body}`;
        })
        .join("\n\n")
    );
  }
  parts.push(prompt.trim());
  return parts.join("\n\n");
}

// ─── Coding ────────────────────────────────────────────────────────────────

export const CODING_MODES = [
  { id: "generate", label: "Generate", prefix: "Write clean, production-ready code for:" },
  {
    id: "debug",
    label: "Debug Error",
    prefix: "Diagnose the root cause of this bug/stack trace and provide the minimal fix:",
  },
  {
    id: "refactor",
    label: "Refactor",
    prefix: "Refactor this code for clarity, performance, and type safety without changing behavior:",
  },
  {
    id: "tests",
    label: "Write Tests",
    prefix: "Write focused unit tests covering normal cases, edge cases, and error handling for:",
  },
] as const;

export type CodingModeId = (typeof CODING_MODES)[number]["id"];

export function buildCodingPayload(prompt: string, modeId: CodingModeId, language?: string): string {
  const mode = CODING_MODES.find((m) => m.id === modeId) ?? CODING_MODES[0];
  const langNote = language && language !== "auto" ? ` (Target language: ${language})` : "";
  return `${mode.prefix}${langNote}\n\n${prompt.trim()}`;
}

export function extensionForLang(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts",
    tsx: "tsx",
    javascript: "js",
    jsx: "jsx",
    python: "py",
    py: "py",
    rust: "rs",
    go: "go",
    sql: "sql",
    json: "json",
    html: "html",
    css: "css",
    bash: "sh",
    sh: "sh",
  };
  return map[lang.toLowerCase()] || "txt";
}

// ─── Vision ────────────────────────────────────────────────────────────────

export const VISION_MODES = [
  {
    id: "ui-code",
    label: "UI → React/Tailwind",
    prompt: "Convert this UI screenshot/wireframe into clean React + Tailwind CSS code, preserving layout and hierarchy.",
  },
  {
    id: "ocr-json",
    label: "OCR & JSON",
    prompt: "Extract all visible text, labels, and tables from this image accurately, plus a structured JSON summary.",
  },
  {
    id: "defect-audit",
    label: "Defect & Layout Audit",
    prompt: "Inspect this image for alignment issues, contrast/readability defects, or visual anomalies and list exact fixes.",
  },
  {
    id: "diagram-spec",
    label: "Diagram → Spec",
    prompt: "Translate this diagram into a clear step-by-step technical specification and Mermaid flowchart.",
  },
] as const;

export interface VisionRegion {
  label: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function extractVisionRegions(content: string): VisionRegion[] {
  const match = /```(?:nox-vision|json)\s*\n([\s\S]*?)```/i.exec(content);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as { regions?: unknown[] };
    if (!Array.isArray(parsed.regions)) return [];
    return parsed.regions
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        label: typeof r.label === "string" ? r.label : "region",
        kind: typeof r.kind === "string" ? r.kind : "object",
        x: Number(r.x),
        y: Number(r.y),
        width: Number(r.width),
        height: Number(r.height),
      }))
      .filter(
        (r) =>
          Number.isFinite(r.x) &&
          Number.isFinite(r.y) &&
          Number.isFinite(r.width) &&
          Number.isFinite(r.height) &&
          r.width > 0 &&
          r.height > 0
      );
  } catch {
    return [];
  }
}

// ─── Voice ─────────────────────────────────────────────────────────────────

export const VOICE_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "ja-JP", label: "Japanese" },
] as const;

// ─── Robotics ──────────────────────────────────────────────────────────────

export interface Waypoint {
  label?: string;
  x: number;
  y: number;
  z: number;
}

export interface MotionMetrics {
  segments: number;
  totalDistance: number;
  estimatedSeconds: number;
  minZ: number;
  maxZ: number;
}

export function computeMotionMetrics(
  waypoints: Waypoint[],
  speedScale: number,
  accelScale: number
): MotionMetrics {
  if (waypoints.length === 0) {
    return { segments: 0, totalDistance: 0, estimatedSeconds: 0, minZ: 0, maxZ: 0 };
  }
  let totalDistance = 0;
  let minZ = waypoints[0].z;
  let maxZ = waypoints[0].z;
  for (let i = 0; i < waypoints.length; i++) {
    const p = waypoints[i];
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    if (i > 0) {
      const prev = waypoints[i - 1];
      totalDistance += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    }
  }
  const effectiveSpeed = Math.max(0.1, speedScale) * 200; // nominal units/sec scaled
  const accelPenalty = 1 + (1 - Math.min(1, Math.max(0.1, accelScale))) * 0.4;
  const estimatedSeconds =
    waypoints.length > 1 ? (totalDistance / effectiveSpeed) * accelPenalty : 0;
  return {
    segments: Math.max(0, waypoints.length - 1),
    totalDistance: Math.round(totalDistance * 100) / 100,
    estimatedSeconds: Math.round(estimatedSeconds * 100) / 100,
    minZ,
    maxZ,
  };
}

export function exportWaypointsCsv(waypoints: Waypoint[], units: string): string {
  const header = `index,label,x_${units},y_${units},z_${units}`;
  const rows = waypoints.map(
    (w, i) => `${i + 1},"${(w.label || `P${i + 1}`).replace(/"/g, '""')}",${w.x},${w.y},${w.z}`
  );
  return [header, ...rows].join("\n");
}
