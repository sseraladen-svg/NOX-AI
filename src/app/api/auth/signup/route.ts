import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, setSessionCookie, createSessionToken } from "@/lib/auth";
import { isRateLimited, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/signup
// Body: { email, password, name? }
// Returns: { ok, user, sessionToken } — sessionToken stored in localStorage
// by the frontend and sent as x-nox-session header on subsequent requests.
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 signups per hour per IP (prevents account farming).
    const ip = getClientIp(req.headers);
    if (isRateLimited(ip, "auth/signup", RATE_LIMITS.SIGNUP.limit, RATE_LIMITS.SIGNUP.windowMs)) {
      return NextResponse.json(
        { ok: false, error: "Too many signups from this IP. Try again later." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as {
      email?: string;
      password?: string;
      name?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const name = (body.name || "").trim() || null;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email." },
        { status: 400 }
      );
    }

    // Basic email format validation — must have a domain with a dot
    const emailParts = email.split("@");
    if (emailParts.length !== 2 || !emailParts[1].includes(".") || emailParts[0].length < 1) {
      return NextResponse.json(
        { ok: false, error: "Email format is invalid. Use a real email like you@example.com" },
        { status: 400 }
      );
    }

    // Check for disposable email domains
    const disposableDomains = [
      "tempmail.com", "throwaway.email", "10minutemail.com", "guerrillamail.com",
      "mailinator.com", "yopmail.com", "trashmail.com", "sharklasers.com",
    ];
    if (disposableDomains.includes(emailParts[1])) {
      return NextResponse.json(
        { ok: false, error: "Disposable email addresses are not allowed." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(password),
      },
      select: { id: true, email: true, name: true },
    });

    // Set cookie + return token for header-based fallback.
    await setSessionCookie(user.id);
    const sessionToken = createSessionToken(user.id);
    return NextResponse.json({ ok: true, user, sessionToken });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
