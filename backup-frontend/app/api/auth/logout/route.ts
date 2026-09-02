import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/logout
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
