import { randomUUID } from "node:crypto";
import { tasks } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { webBadgeAttempts } from "@/db/schema";
import {
  assignWebAttemptBadgeNumber,
  findActiveWebAttempt,
  findCompletedWebBadge,
} from "@/lib/badges";
import { getWebSession } from "@/lib/web-badge-auth";
import type { processWebBadgeTask } from "@/trigger/process-web-badge";

export const runtime = "nodejs";

const maxConvertedUploadBytes = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getWebSession();
  if (!session) {
    return Response.json(
      { ok: false, message: "Sign in first." },
      { status: 401 },
    );
  }

  const [completedBadge, activeAttempt] = await Promise.all([
    findCompletedWebBadge(session.webParticipantId),
    findActiveWebAttempt(session.webParticipantId),
  ]);

  if (completedBadge) {
    return Response.json(
      { ok: false, message: "Your badge is already complete." },
      { status: 409 },
    );
  }
  if (activeAttempt) {
    return Response.json(
      { ok: false, message: "Your badge is already generating." },
      { status: 409 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("photo");

  if (!(file instanceof File)) {
    return Response.json(
      { ok: false, message: "Upload a photo." },
      { status: 400 },
    );
  }
  if (file.type !== "image/webp") {
    return Response.json(
      { ok: false, message: "Upload a browser-converted WebP image." },
      { status: 400 },
    );
  }
  if (file.size > maxConvertedUploadBytes) {
    return Response.json(
      { ok: false, message: "The converted image must be 10 MB or smaller." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  if (
    metadata.format !== "webp" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    return Response.json(
      { ok: false, message: "Choose a valid image and try again." },
      { status: 400 },
    );
  }

  const blob = await put(
    `web-inbound/${session.webParticipantId}/${randomUUID()}.webp`,
    buffer,
    {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: true,
    },
  );
  const now = new Date();
  const [attempt] = await db
    .insert(webBadgeAttempts)
    .values({
      webParticipantId: session.webParticipantId,
      sourceImageUrl: blob.url,
      status: "queued",
      updatedAt: now,
    })
    .returning({ id: webBadgeAttempts.id });
  const badgeNumber = await assignWebAttemptBadgeNumber(attempt.id);
  const handle = await tasks.trigger<typeof processWebBadgeTask>(
    "process-web-badge",
    {
      attemptId: attempt.id,
      badgeNumber,
      imageUrl: blob.url,
    },
  );

  await db
    .update(webBadgeAttempts)
    .set({ generationRunId: handle.id, updatedAt: new Date() })
    .where(eq(webBadgeAttempts.id, attempt.id));

  return Response.json({ ok: true, status: "generating", badgeNumber });
}
