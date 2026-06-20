import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { badges, webBadgeRequests } from "@/db/schema";
import { getWebSession, WEB_SESSION_COOKIE } from "@/lib/web-badge-auth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const session = await getWebSession(
    cookieStore.get(WEB_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return Response.json({ authenticated: false });
  }

  const [request] = await db
    .select({ request: webBadgeRequests, badge: badges })
    .from(webBadgeRequests)
    .leftJoin(badges, eq(webBadgeRequests.badgeId, badges.id))
    .where(eq(webBadgeRequests.webParticipantId, session.participant.id))
    .limit(1);

  return Response.json({
    authenticated: true,
    email: session.participant.email,
    request: request
      ? {
          status: request.request.status,
          error: request.request.generationError,
          badgeNumber: request.badge?.badgeNumber ?? null,
          badgeImageUrl: request.request.badgeImageUrl,
          canUpload:
            request.request.status === "rejected" ||
            request.request.status === "failed",
        }
      : null,
  });
}
