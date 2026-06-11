import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { tasks } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";
import { generateText, stepCountIs, tool } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappConversations, whatsappMessages } from "@/db/schema";
import { env } from "@/env";
import { logError, logInfo, logWarn } from "@/lib/logger";
import {
  downloadKapsoMedia,
  sendWhatsAppImage,
  sendWhatsAppText,
  verifyKapsoSignature,
} from "@/lib/whatsapp";
import {
  claimBadgeGeneration,
  describeWebhookPayloadShape,
  ensureBadgeNumber,
  insertOutboundWhatsAppMessage,
  normalizeWebhookPayloads,
  normalizeWhatsAppMessage,
  upsertConversationAndMessage,
} from "@/lib/whatsapp-webhook";
import type { processWhatsAppBadgeTask } from "@/trigger/process-whatsapp-badge";

export const runtime = "nodejs";

const uploadInboundImage = async ({
  buffer,
  contentType,
  waId,
}: {
  buffer: Buffer;
  contentType: string;
  waId: string;
}) => {
  const extension = contentType.includes("png") ? "png" : "jpg";
  const blob = await put(
    `whatsapp-inbound/${waId}/${randomUUID()}.${extension}`,
    buffer,
    {
      access: "public",
      contentType,
      addRandomSuffix: true,
    },
  );

  return blob.url;
};

const sendAndStoreWhatsAppText = async ({
  conversationId,
  phoneNumberId,
  to,
  body,
}: {
  conversationId: number;
  phoneNumberId: string;
  to: string;
  body: string;
}) => {
  const response = await sendWhatsAppText({ phoneNumberId, to, body });

  await insertOutboundWhatsAppMessage({
    conversationId,
    messageType: "text",
    content: body,
    response,
  });
};

const sendAndStoreWhatsAppImage = async ({
  conversationId,
  phoneNumberId,
  to,
  imageUrl,
}: {
  conversationId: number;
  phoneNumberId: string;
  to: string;
  imageUrl: string;
}) => {
  const caption =
    "Tu badge de VibeCode Fest ya está listo. Guárdalo y compártelo en Instagram, LinkedIn o X para que tus amigos también puedan venir.";
  const response = await sendWhatsAppImage({
    phoneNumberId,
    to,
    imageUrl,
    caption,
  });

  await insertOutboundWhatsAppMessage({
    conversationId,
    messageType: "image",
    content: caption,
    mediaUrl: imageUrl,
    response,
  });
};

const conversationStatus = (
  conversation: typeof whatsappConversations.$inferSelect,
) => ({
  generated: conversation.badgeGenerated,
  generating:
    conversation.badgeGenerationStarted && !conversation.badgeGenerated,
  hasUserImage: Boolean(conversation.sourceImageUrl),
  badgeImageUrl: conversation.badgeImageUrl,
  sourceImageUrl: conversation.sourceImageUrl,
  generationError: conversation.generationError,
});

const getConversationHistory = async (conversationId: number) => {
  const messages = await db
    .select({
      direction: whatsappMessages.direction,
      messageType: whatsappMessages.messageType,
      content: whatsappMessages.content,
      mediaUrl: whatsappMessages.mediaUrl,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.whatsappConversationId, conversationId))
    .orderBy(asc(whatsappMessages.createdAt));

  return messages.map((message, index) => ({
    ...message,
    latest: index === messages.length - 1,
  }));
};

const storeLatestImage = async (
  normalized: NonNullable<ReturnType<typeof normalizeWhatsAppMessage>>,
  conversationId: number,
) => {
  if (normalized.messageType !== "image") {
    return undefined;
  }

  logInfo("kapso.webhook.media.download.start", {
    conversationId,
    messageId: normalized.messageId,
    mediaId: normalized.mediaId,
    mediaUrl: normalized.mediaUrl,
  });
  const media = await downloadKapsoMedia({
    phoneNumberId: normalized.phoneNumberId,
    mediaId: normalized.mediaId,
    mediaUrl: normalized.mediaUrl,
  });
  logInfo("kapso.webhook.media.download.complete", {
    conversationId,
    messageId: normalized.messageId,
    contentType: media.contentType,
    byteLength: media.buffer.byteLength,
  });
  if (!media.contentType.startsWith("image/")) {
    logWarn("kapso.webhook.media.not_image", {
      conversationId,
      messageId: normalized.messageId,
      contentType: media.contentType,
    });
    return undefined;
  }

  const sourceImageUrl = await uploadInboundImage({
    buffer: media.buffer,
    contentType: media.contentType,
    waId: normalized.waId,
  });

  await Promise.all([
    db
      .update(whatsappMessages)
      .set({ mediaUrl: sourceImageUrl })
      .where(eq(whatsappMessages.kapsoMessageId, normalized.messageId)),
    db
      .update(whatsappConversations)
      .set({ sourceImageUrl, generationError: null, updatedAt: new Date() })
      .where(eq(whatsappConversations.id, conversationId)),
  ]);

  logInfo("kapso.webhook.media.uploaded", {
    conversationId,
    messageId: normalized.messageId,
    sourceImageUrl,
  });

  return sourceImageUrl;
};

const processMessage = async (payload: Record<string, unknown>) => {
  const normalized = normalizeWhatsAppMessage(payload);
  if (!normalized || normalized.message.kapso?.direction === "outbound") {
    logInfo("kapso.webhook.message.skipped", {
      reason: !normalized ? "unrecognized_payload" : "outbound_message",
      ...(!normalized ? describeWebhookPayloadShape(payload) : {}),
    });
    return;
  }

  logInfo("kapso.webhook.message.received", {
    messageId: normalized.messageId,
    messageType: normalized.messageType,
    phoneNumberId: normalized.phoneNumberId,
    waId: normalized.waId,
    hasMediaUrl: Boolean(normalized.mediaUrl),
    hasMediaId: Boolean(normalized.mediaId),
  });

  const { conversation, isDuplicateMessage } =
    await upsertConversationAndMessage(normalized);
  if (isDuplicateMessage) {
    logInfo("kapso.webhook.message.duplicate", {
      messageId: normalized.messageId,
      conversationId: conversation.id,
      waId: normalized.waId,
    });
    return;
  }

  logInfo("kapso.webhook.conversation.upserted", {
    conversationId: conversation.id,
    badgeGenerationStarted: conversation.badgeGenerationStarted,
    badgeGenerated: conversation.badgeGenerated,
    hasBadgeImageUrl: Boolean(conversation.badgeImageUrl),
  });

  const canAcceptImage =
    !conversation.badgeGenerationStarted && !conversation.badgeGenerated;
  const latestImageUrl = canAcceptImage
    ? await storeLatestImage(normalized, conversation.id)
    : undefined;
  const sourceImageUrl = latestImageUrl ?? conversation.sourceImageUrl;
  const history = await getConversationHistory(conversation.id);
  const badgePrompt = JSON.stringify({
    badgeStatus: {
      ...conversationStatus(conversation),
      hasUserImage: Boolean(sourceImageUrl),
      sourceImageUrl,
    },
    imageUrls: history
      .map((message) => message.mediaUrl)
      .filter((url): url is string => Boolean(url)),
    latestMessage: { ...normalized, storedImageUrl: latestImageUrl },
    conversationHistory: history,
  });
  const tools = {
    triggerGenerateBadgeTask: tool({
      description:
        "Start badge generation after the user's image has been stored.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!sourceImageUrl) {
          return { ok: false, reason: "no stored image URL" };
        }

        const claimedConversation = await claimBadgeGeneration({
          conversationId: conversation.id,
          sourceImageUrl,
        });

        if (!claimedConversation) {
          logInfo("kapso.webhook.badge.claim_missed", {
            conversationId: conversation.id,
            messageId: normalized.messageId,
            waId: normalized.waId,
          });
          return { ok: false, reason: "badge generation already started" };
        }

        const badgeNumber =
          claimedConversation.badgeNumber ??
          (await ensureBadgeNumber(claimedConversation.id));
        const handle = await tasks.trigger<typeof processWhatsAppBadgeTask>(
          "process-whatsapp-badge",
          {
            conversationId: claimedConversation.id,
            phoneNumberId: normalized.phoneNumberId,
            waId: normalized.waId,
            badgeNumber,
            imageUrl: sourceImageUrl,
          },
        );

        await db
          .update(whatsappConversations)
          .set({ badgeGenerationRunId: handle.id, updatedAt: new Date() })
          .where(eq(whatsappConversations.id, claimedConversation.id));

        logInfo("kapso.webhook.badge.triggered", {
          conversationId: claimedConversation.id,
          badgeNumber,
          runId: handle.id,
          sourceImageUrl,
        });

        return { ok: true, runId: handle.id, badgeNumber };
      },
    }),
    sendBadgeImage: tool({
      description:
        "Send the existing generated badge image to the participant as an image-only WhatsApp message.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!conversation.badgeGenerated || !conversation.badgeImageUrl) {
          return { ok: false, reason: "no generated badge image available" };
        }

        await sendAndStoreWhatsAppImage({
          conversationId: conversation.id,
          phoneNumberId: normalized.phoneNumberId,
          to: normalized.waId,
          imageUrl: conversation.badgeImageUrl,
        });

        logInfo("kapso.webhook.badge.image_sent", {
          conversationId: conversation.id,
          messageId: normalized.messageId,
          badgeImageUrl: conversation.badgeImageUrl,
        });

        return { ok: true };
      },
    }),
  };
  const result = await generateText({
    model: openai("gpt-5.5"),
    stopWhen: stepCountIs(3),
    system:
      "You are the VibeCode Fest WhatsApp badge assistant. Reply in Spanish unless the participant clearly writes in another language. Keep replies short, direct, warm, celebratory, and human. Use the full conversation history, the highlighted latest message, and the injected image URLs. Exactly one badge is allowed per participant. Never offer, request, or trigger a regenerated or second badge after generation has started or completed. If the participant greets you or says hello before sending an image, welcome them with event context: they are in VibeCode Fest, congratulations, see you there, and ask for the photo they want on their badge. If a badge is generated, call sendBadgeImage instead of writing the badge URL, then invite them to save it and share it on Instagram, LinkedIn, or X so their friends can come too; optionally add a short note that only one badge is available per participant. If generation is already started, say it is in progress, can take a few minutes, they should wait here, and you will send it as soon as it is ready; do not trigger generation again. If an image URL is available and generation has not started, call triggerGenerateBadgeTask, then tell the user you got their photo, the badge is being generated, it can take a few minutes, they should wait here, and you will send it as soon as it is ready. If there is no image URL yet, ask for the photo they want on their badge. Do not mention tools, internals, URLs, or policy.",
    prompt: badgePrompt,
    tools,
    experimental_onToolCallStart: ({ toolCall }) => {
      logInfo("kapso.webhook.badge.tool_call.start", {
        conversationId: conversation.id,
        messageId: normalized.messageId,
        toolName: toolCall.toolName,
      });
    },
    experimental_onToolCallFinish: (event) => {
      logInfo("kapso.webhook.badge.tool_call.finish", {
        conversationId: conversation.id,
        messageId: normalized.messageId,
        toolName: event.toolCall.toolName,
        success: event.success,
      });
    },
  });

  const responseText = result.text.trim();
  if (responseText) {
    await sendAndStoreWhatsAppText({
      conversationId: conversation.id,
      phoneNumberId: normalized.phoneNumberId,
      to: normalized.waId,
      body: responseText,
    });
  }
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const event = request.headers.get("x-webhook-event");
  const idempotencyKey = request.headers.get("x-idempotency-key");

  logInfo("kapso.webhook.request.received", {
    event,
    idempotencyKey,
    byteLength: body.length,
  });

  if (
    !verifyKapsoSignature({
      body,
      signature,
      secret: env.KAPSO_WEBHOOK_SECRET,
    })
  ) {
    logWarn("kapso.webhook.signature.invalid", { event, idempotencyKey });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event && event !== "whatsapp.message.received") {
    logInfo("kapso.webhook.event.ignored", { event, idempotencyKey });
    return Response.json({ ok: true });
  }

  try {
    const payload = JSON.parse(body) as unknown;
    const payloads = normalizeWebhookPayloads(payload);

    logInfo("kapso.webhook.payload.normalized", {
      event,
      idempotencyKey,
      payloadCount: payloads.length,
    });

    await Promise.all(payloads.map((item) => processMessage(item)));

    logInfo("kapso.webhook.request.completed", {
      event,
      idempotencyKey,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({ ok: true });
  } catch (error) {
    logError("kapso.webhook.request.failed", {
      event,
      idempotencyKey,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
