import "server-only";

type Level = "debug" | "info" | "warn" | "error";

const serialize = (v: unknown): unknown =>
  v instanceof Error ? { name: v.name, message: v.message } : v;

function emit(level: Level, msg: string, extra: unknown[]) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(extra.length ? { extra: extra.map(serialize) } : {}),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** Structured JSON logs (one line each) that Vercel log search can filter by level. */
export const logger = {
  debug: (msg: string, ...extra: unknown[]) => emit("debug", msg, extra),
  info: (msg: string, ...extra: unknown[]) => emit("info", msg, extra),
  warn: (msg: string, ...extra: unknown[]) => emit("warn", msg, extra),
  error: (msg: string, ...extra: unknown[]) => emit("error", msg, extra),
};
