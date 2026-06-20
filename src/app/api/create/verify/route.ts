import { cookies } from "next/headers";
import {
  verifyWebOtp,
  WEB_SESSION_COOKIE,
  WEB_SESSION_MAX_AGE_SECONDS,
} from "@/lib/web-badge-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  const result = await verifyWebOtp({
    rawEmail: body.email ?? "",
    code: body.code ?? "",
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(WEB_SESSION_COOKIE, result.cookieValue, {
    httpOnly: true,
    maxAge: WEB_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return Response.json({ ok: true });
}
