import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, setSessionCookie, createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/login
// Body: { email, password }
// Returns: { ok, user, sessionToken } — sessionToken is stored in localStorage
// by the frontend and sent as x-nox-session header on subsequent requests,
// as a fallback when cookies aren't sent (e.g. preview gateway HTTPS contexts).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      password?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: "Email and password are required." },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { ok: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Set the cookie (primary auth path).
    await setSessionCookie(user.id);
    // Also return the token in the response body so the frontend can store it
    // in localStorage and send it as a header (fallback auth path).
    const sessionToken = createSessionToken(user.id);
    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      sessionToken,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
