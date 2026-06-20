import { randomUUID } from "node:crypto";
import { tasks } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { badges, webBadgeRequests } from "@/db/schema";
import { allocateBadge } from "@/lib/badges";
import { getWebSession, WEB_SESSION_COOKIE } from "@/lib/web-badge-auth";
import type { processWebBadgeTask } from "@/trigger/process-web-badge";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const responseForRequest = (request: typeof webBadgeRequests.$inferSelect) =>
  Response.json({ ok: true, status: request.status, requestId: request.id });

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = await getWebSession(
    cookieStore.get(WEB_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return Response.json(
      { error: "Sign in with your event email first." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "Upload a processed image file." },
      { status: 400 },
    );
  }

  if (file.type !== "image/webp") {
    return Response.json(
      { error: "Upload must be a browser-processed WebP image." },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: "Upload must be under 5 MB." },
      { status: 400 },
    );
  }

  const [existingRequest] = await db
    .select()
    .from(webBadgeRequests)
    .where(eq(webBadgeRequests.webParticipantId, session.participant.id))
    .limit(1);

  if (existingRequest?.status === "generated") {
    return Response.json(
      { error: "Your Badge is already complete." },
      { status: 409 },
    );
  }

  if (existingRequest?.status === "generating") {
    return responseForRequest(existingRequest);
  }

  if (
    existingRequest &&
    existingRequest.status !== "pending" &&
    existingRequest.status !== "rejected" &&
    existingRequest.status !== "failed"
  ) {
    return Response.json(
      { error: "This Badge request cannot accept another upload." },
      { status: 409 },
    );
  }

  const blob = await put(
    `web-inbound/${session.participant.id}/${randomUUID()}.webp`,
    file,
    {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: true,
    },
  );

  let badge = existingRequest?.badgeId
    ? (
        await db
          .select()
          .from(badges)
          .where(eq(badges.id, existingRequest.badgeId))
          .limit(1)
      )[0]
    : undefined;

  if (!badge) {
    badge = await allocateBadge({ origin: "web", sourceImageUrl: blob.url });
  }

  let badgeRequest = existingRequest;

  if (!badgeRequest) {
    [badgeRequest] = await db
      .insert(webBadgeRequests)
      .values({
        webParticipantId: session.participant.id,
        badgeId: badge.id,
        sourceImageUrl: blob.url,
        status: "pending",
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: webBadgeRequests.webParticipantId,
      })
      .returning();
  }

  if (!badgeRequest) {
    [badgeRequest] = await db
      .select()
      .from(webBadgeRequests)
      .where(eq(webBadgeRequests.webParticipantId, session.participant.id))
      .limit(1);
  }

  if (!badgeRequest) {
    throw new Error("Failed to create web Badge request");
  }

  if (badgeRequest.badgeId === null) {
    const [updatedRequest] = await db
      .update(webBadgeRequests)
      .set({ badgeId: badge.id, updatedAt: new Date() })
      .where(
        and(
          eq(webBadgeRequests.id, badgeRequest.id),
          isNull(webBadgeRequests.badgeId),
        ),
      )
      .returning();

    if (updatedRequest) {
      badgeRequest = updatedRequest;
    }
  }

  const [claimedRequest] = await db
    .update(webBadgeRequests)
    .set({
      sourceImageUrl: blob.url,
      status: "generating",
      generationError: null,
      triggerRunId: null,
      updatedAt: new Date(),
    })
    .where(eq(webBadgeRequests.id, badgeRequest.id))
    .returning();

  if (!claimedRequest) {
    throw new Error("Failed to claim web Badge request");
  }

  const handle = await tasks.trigger<typeof processWebBadgeTask>(
    "process-web-badge",
    {
      requestId: claimedRequest.id,
      badgeId: badge.id,
      badgeNumber: badge.badgeNumber,
      imageUrl: blob.url,
    },
  );

  const [startedRequest] = await db
    .update(webBadgeRequests)
    .set({ triggerRunId: handle.id, updatedAt: new Date() })
    .where(eq(webBadgeRequests.id, claimedRequest.id))
    .returning();

  return responseForRequest(startedRequest ?? claimedRequest);
}
