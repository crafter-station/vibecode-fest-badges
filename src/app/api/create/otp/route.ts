import { requestWebOtp } from "@/lib/web-badge-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const result = await requestWebOtp(body.email ?? "");

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ ok: true, email: result.email });
}
