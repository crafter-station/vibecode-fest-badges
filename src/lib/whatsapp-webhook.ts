import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappConversations, whatsappMessages } from "@/db/schema";
import { ensureWhatsAppBadge } from "@/lib/badges";

type WebhookPayload = Record<string, unknown>;

type KapsoMessage = {
  id?: string;
  type?: string;
  image?: { id?: string };
  kapso?: {
    direction?: string;
    content?: string;
    media_url?: string;
    mediaUrl?: string;
    media_data?: { url?: string };
    mediaData?: { url?: string };
    contact_name?: string;
    contactName?: string;
  };
};

type KapsoConversation = {
  id?: string;
  phone_number?: string;
  phoneNumber?: string;
  phone_number_id?: string;
  phoneNumberId?: string;
  kapso?: { contact_name?: string; contactName?: string };
};

type NormalizedWhatsAppMessage = {
  payload: WebhookPayload;
  message: KapsoMessage;
  conversation: KapsoConversation;
  phoneNumberId: string;
  waId: string;
  messageId: string;
  messageType: string;
  content: string | null;
  mediaUrl?: string;
  mediaId?: string;
  contactName?: string;
};

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const payloadEnvelope = (payload: WebhookPayload) =>
  objectValue(payload.data) ??
  objectValue(payload.payload) ??
  objectValue(payload.body) ??
  payload;

export const describeWebhookPayloadShape = (payload: WebhookPayload) => {
  const envelope = payloadEnvelope(payload);

  return {
    topLevelKeys: Object.keys(payload).sort(),
    envelopeKeys: Object.keys(envelope).sort(),
    hasMessage: Boolean(objectValue(envelope.message)),
    hasConversation: Boolean(objectValue(envelope.conversation)),
  };
};

export const normalizeWebhookPayloads = (
  payload: unknown,
): WebhookPayload[] => {
  const root = objectValue(payload);
  if (!root) {
    return [];
  }

  const data = root.data;
  if (Array.isArray(data)) {
    return data.reduce<WebhookPayload[]>((items, event) => {
      const item = objectValue(event);
      if (item) {
        items.push(item);
      }

      return items;
    }, []);
  }

  const events = root.events;
  if (Array.isArray(events)) {
    return events.reduce<WebhookPayload[]>((items, event) => {
      const item = objectValue(event);
      if (item) {
        items.push(item);
      }

      return items;
    }, []);
  }

  return [root];
};

export const normalizeWhatsAppMessage = (
  payload: WebhookPayload,
): NormalizedWhatsAppMessage | undefined => {
  const envelope = payloadEnvelope(payload);
  const message = objectValue(envelope.message) as KapsoMessage | undefined;
  const conversation = objectValue(envelope.conversation) as
    | KapsoConversation
    | undefined;
  if (!message || !conversation) {
    return undefined;
  }

  const phoneNumberId =
    stringValue(envelope.phone_number_id) ??
    stringValue(envelope.phoneNumberId) ??
    stringValue(conversation.phone_number_id) ??
    stringValue(conversation.phoneNumberId);
  const waId = (
    stringValue(conversation.phone_number) ??
    stringValue(conversation.phoneNumber)
  )?.replace(/^\+/, "");
  const messageId = stringValue(message.id);
  const messageType = stringValue(message.type) ?? "unknown";

  if (!phoneNumberId || !waId || !messageId) {
    return undefined;
  }

  return {
    payload,
    message,
    conversation,
    phoneNumberId,
    waId,
    messageId,
    messageType,
    content: stringValue(message.kapso?.content) ?? null,
    mediaUrl:
      stringValue(message.kapso?.media_data?.url) ??
      stringValue(message.kapso?.mediaData?.url) ??
      stringValue(message.kapso?.media_url) ??
      stringValue(message.kapso?.mediaUrl),
    mediaId: stringValue(message.image?.id),
    contactName:
      stringValue(conversation.kapso?.contact_name) ??
      stringValue(conversation.kapso?.contactName) ??
      stringValue(message.kapso?.contact_name) ??
      stringValue(message.kapso?.contactName),
  };
};

export const upsertConversationAndMessage = async (
  normalized: NormalizedWhatsAppMessage,
) => {
  const now = new Date();
  const conversationValues = {
    phoneNumber: normalized.conversation.phone_number ?? normalized.waId,
    phoneNumberId: normalized.phoneNumberId,
    kapsoConversationId: normalized.conversation.id,
    contactName: normalized.contactName,
    updatedAt: now,
  };
  const [updatedConversation] = await db
    .update(whatsappConversations)
    .set(conversationValues)
    .where(eq(whatsappConversations.waId, normalized.waId))
    .returning();

  let conversation = updatedConversation;

  if (!conversation) {
    const [insertedConversation] = await db
      .insert(whatsappConversations)
      .values({
        ...conversationValues,
        waId: normalized.waId,
      })
      .onConflictDoNothing({
        target: whatsappConversations.waId,
      })
      .returning();

    conversation = insertedConversation;

    if (!conversation) {
      const [conflictingConversation] = await db
        .update(whatsappConversations)
        .set(conversationValues)
        .where(eq(whatsappConversations.waId, normalized.waId))
        .returning();

      conversation = conflictingConversation;
    }
  }

  if (!conversation) {
    throw new Error("Failed to upsert WhatsApp conversation");
  }

  const insertedMessage = await db
    .insert(whatsappMessages)
    .values({
      whatsappConversationId: conversation.id,
      kapsoMessageId: normalized.messageId,
      direction: normalized.message.kapso?.direction ?? "inbound",
      messageType: normalized.messageType,
      content: normalized.content,
      mediaUrl: normalized.mediaUrl,
      rawPayload: normalized.payload,
    })
    .onConflictDoNothing({
      target: whatsappMessages.kapsoMessageId,
    })
    .returning();

  return { conversation, isDuplicateMessage: insertedMessage.length === 0 };
};

const outboundKapsoMessageId = (response: Record<string, unknown>) => {
  const messages = response.messages;
  const firstMessage = Array.isArray(messages)
    ? objectValue(messages[0])
    : undefined;

  return (
    stringValue(firstMessage?.id) ??
    stringValue(response.message_id) ??
    stringValue(response.messageId) ??
    `outbound:${randomUUID()}`
  );
};

export const insertOutboundWhatsAppMessage = async ({
  conversationId,
  messageType,
  content,
  mediaUrl,
  response,
}: {
  conversationId: number;
  messageType: string;
  content?: string;
  mediaUrl?: string;
  response: Record<string, unknown>;
}) => {
  const now = new Date();

  await db
    .insert(whatsappMessages)
    .values({
      whatsappConversationId: conversationId,
      kapsoMessageId: outboundKapsoMessageId(response),
      direction: "outbound",
      messageType,
      content,
      mediaUrl,
      rawPayload: { response },
      createdAt: now,
    })
    .onConflictDoNothing({
      target: whatsappMessages.kapsoMessageId,
    });

  await db
    .update(whatsappConversations)
    .set({ updatedAt: now })
    .where(eq(whatsappConversations.id, conversationId));
};

export const ensureBadgeNumber = async (conversationId: number) => {
  const badge = await ensureWhatsAppBadge(conversationId);

  return badge.badgeNumber;
};

export const claimBadgeGeneration = async ({
  conversationId,
  sourceImageUrl,
}: {
  conversationId: number;
  sourceImageUrl: string;
}) => {
  const [conversation] = await db
    .update(whatsappConversations)
    .set({
      badgeGenerationStarted: true,
      sourceImageUrl,
      generationError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.badgeGenerationStarted, false),
        eq(whatsappConversations.badgeGenerated, false),
      ),
    )
    .returning();

  return conversation;
};
