import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { isRateLimited, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/reset-password
// Body: { email, currentPassword, newPassword }
//
// Self-service password reset — user proves they know their current password,
// then sets a new one. No email service needed (works offline).
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    if (isRateLimited(ip, "auth/reset", 5, 60_000)) {
      return NextResponse.json(
        { ok: false, error: "Too many reset attempts. Wait a minute." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as {
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";

    if (!email || !currentPassword || !newPassword) {
      return NextResponse.json(
        { ok: false, error: "Email, current password, and new password are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: "New password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json(
        { ok: false, error: "Current password is incorrect." },
        { status: 401 }
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
