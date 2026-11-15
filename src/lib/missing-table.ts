// Pure helpers (no server imports) so the self-healing logic can be unit-tested.

export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "P2021" || e.code === "42P01") return true;
  const m = e.message ?? "";
  return /does not exist/i.test(m) && /(table|relation)/i.test(m);
}

/** Runs `run`; if the table is missing, calls `ensure()` once and retries. Other errors pass through. */
export async function retryOnMissingTable<T>(run: () => Promise<T>, ensure: () => Promise<void>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    await ensure();
    return run();
  }
}
