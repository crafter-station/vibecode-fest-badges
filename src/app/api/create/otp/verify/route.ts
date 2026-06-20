import { z } from "zod";
import {
  setWebSessionCookie,
  verifyOtpAndCreateSession,
} from "@/lib/web-badge-auth";

export const runtime = "nodejs";

const verifySchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { ok: false, message: "Enter the 6-digit code from your email." },
      { status: 400 },
    );
  }

  const result = await verifyOtpAndCreateSession(parsed.data);
  if (!result.ok) {
    return Response.json(
      { ok: false, message: "That code is invalid or expired." },
      { status: 400 },
    );
  }

  await setWebSessionCookie(result.token, result.expiresAt);

  return Response.json({ ok: true });
}
