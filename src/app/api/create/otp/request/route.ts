import { z } from "zod";
import { requestOtpForApprovedParticipant } from "@/lib/web-badge-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.email(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return Response.json(
      { ok: false, message: "Enter a valid email." },
      { status: 400 },
    );
  }

  await requestOtpForApprovedParticipant(parsed.data.email);

  return Response.json({
    ok: true,
    status: "needs_otp",
    message:
      "If that email is approved for Vibe Code Fest, a verification code has been sent.",
  });
}
