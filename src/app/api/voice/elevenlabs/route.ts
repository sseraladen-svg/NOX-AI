import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { ok: false, error: "ElevenLabs is not configured. Add ELEVENLABS_API_KEY." },
      { status: 503 }
    );
  }

  const body = (await req.json()) as { text?: string; voiceId?: string };
  if (!body.text?.trim()) {
    return Response.json({ ok: false, error: "Text is required." }, { status: 400 });
  }

  const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: body.text.slice(0, 5000),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return Response.json({ ok: false, error: `ElevenLabs request failed: ${detail}` }, { status: 502 });
  }

  return new Response(await response.arrayBuffer(), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
