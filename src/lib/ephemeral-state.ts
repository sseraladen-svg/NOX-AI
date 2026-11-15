import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { retryOnMissingTable } from "@/lib/missing-table";

const TEN_MIN_MS = 10 * 60 * 1000;

// Creates the table (same shape as prisma/schema.prisma) if `prisma db push` has not been run yet,
// so a fresh deploy works without a manual step. Safe to run repeatedly.
let ensuring: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ensuring ??= (async () => {
    logger.warn("EphemeralState table missing; creating it. Run `npx prisma db push` to keep the schema in sync.");
    await db.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "EphemeralState" ("key" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL)'
    );
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "EphemeralState_expiresAt_idx" ON "EphemeralState" ("expiresAt")');
  })().catch((e) => {
    ensuring = null;
    throw e;
  });
  return ensuring;
}

const withTable = <T>(fn: () => Promise<T>) => retryOnMissingTable(fn, ensureTable);

// Opportunistic cleanup (~2% of writes) so no cron job is needed.
async function maybePrune(): Promise<void> {
  if (Math.random() > 0.02) return;
  await db.ephemeralState.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}

export async function rememberApproval(approvalId: string, userId: string): Promise<void> {
  await maybePrune();
  await withTable(() =>
    db.ephemeralState.create({
      data: { key: `approval:${approvalId}`, userId, expiresAt: new Date(Date.now() + TEN_MIN_MS) },
    })
  );
}

/** Atomically consumes an approval. Returns true only once, for the owner, before expiry. */
export async function consumeApproval(approvalId: string, userId: string): Promise<boolean> {
  const res = await withTable<{ count: number }>(() =>
    db.ephemeralState.deleteMany({
      where: { key: `approval:${approvalId}`, userId, expiresAt: { gte: new Date() } },
    })
  );
  return res.count > 0;
}

/** Marks a resume step as used. Returns false if it was already consumed (replay). */
export async function markStepConsumed(userId: string, stepId: string): Promise<boolean> {
  const key = `step:${userId}:${stepId}`;
  await maybePrune();
  await withTable(() => db.ephemeralState.deleteMany({ where: { key, expiresAt: { lt: new Date() } } }));
  try {
    await db.ephemeralState.create({
      data: { key, userId, expiresAt: new Date(Date.now() + TEN_MIN_MS) },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

/** Atomic fixed-window counter shared by all instances. Returns the hit count in the window. */
export async function hitCounter(key: string, windowMs: number): Promise<number> {
  await maybePrune();
  const secs = windowMs / 1000;
  const rows = await withTable<{ count: number }[]>(() => db.$queryRaw<{ count: number }[]>`
    INSERT INTO "EphemeralState" ("key", "count", "expiresAt")
    VALUES (${key}, 1, (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${secs}::double precision))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "EphemeralState"."expiresAt" < (NOW() AT TIME ZONE 'UTC') THEN 1 ELSE "EphemeralState"."count" + 1 END,
      "expiresAt" = CASE WHEN "EphemeralState"."expiresAt" < (NOW() AT TIME ZONE 'UTC')
        THEN (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${secs}::double precision)
        ELSE "EphemeralState"."expiresAt" END
    RETURNING "count"`);
  return Number(rows[0]?.count ?? 1);
}
