import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  badges,
  webBadgeAttempts,
  webParticipants,
  whatsappConversations,
} from "@/db/schema";

const inProgressAttemptStatuses = ["queued", "generating"];

const isBadgeNumberConflict = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { code, constraint, message } = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };

  return (
    code === "23505" ||
    constraint?.includes("badge_number") === true ||
    message?.includes("badge_number") === true
  );
};

export const lowestAvailableBadgeNumber = async () => {
  const [canonicalNumbers, legacyWhatsappNumbers, reservedWebNumbers] =
    await Promise.all([
      db.select({ badgeNumber: badges.badgeNumber }).from(badges),
      db
        .select({ badgeNumber: whatsappConversations.badgeNumber })
        .from(whatsappConversations)
        .where(isNotNull(whatsappConversations.badgeNumber)),
      db
        .select({ badgeNumber: webBadgeAttempts.badgeNumber })
        .from(webBadgeAttempts)
        .where(
          and(
            isNotNull(webBadgeAttempts.badgeNumber),
            inArray(webBadgeAttempts.status, inProgressAttemptStatuses),
          ),
        ),
    ]);
  const assignedNumbers = [
    ...canonicalNumbers,
    ...legacyWhatsappNumbers,
    ...reservedWebNumbers,
  ]
    .map((row) => row.badgeNumber)
    .filter((badgeNumber): badgeNumber is number => badgeNumber !== null)
    .sort((a, b) => a - b);

  let badgeNumber = 1;
  for (const assigned of assignedNumbers) {
    if (assigned < badgeNumber) {
      continue;
    }
    if (assigned > badgeNumber) {
      break;
    }
    badgeNumber += 1;
  }

  return badgeNumber;
};

export const ensureWhatsappBadgeNumber = async (conversationId: number) => {
  const [existingConversation] = await db
    .select({ badgeNumber: whatsappConversations.badgeNumber })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId))
    .limit(1);

  if (!existingConversation) {
    throw new Error("Conversation not found");
  }
  if (existingConversation.badgeNumber !== null) {
    return existingConversation.badgeNumber;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const badgeNumber = await lowestAvailableBadgeNumber();

    try {
      const [conversation] = await db
        .update(whatsappConversations)
        .set({ badgeNumber, updatedAt: new Date() })
        .where(
          and(
            eq(whatsappConversations.id, conversationId),
            isNull(whatsappConversations.badgeNumber),
          ),
        )
        .returning({ badgeNumber: whatsappConversations.badgeNumber });

      if (conversation?.badgeNumber !== null && conversation?.badgeNumber) {
        return conversation.badgeNumber;
      }

      const [updatedConversation] = await db
        .select({ badgeNumber: whatsappConversations.badgeNumber })
        .from(whatsappConversations)
        .where(eq(whatsappConversations.id, conversationId))
        .limit(1);

      if (
        updatedConversation?.badgeNumber !== null &&
        updatedConversation?.badgeNumber !== undefined
      ) {
        return updatedConversation.badgeNumber;
      }
    } catch (error) {
      if (!isBadgeNumberConflict(error) || attempt === 4) {
        throw error;
      }
    }
  }

  throw new Error("Failed to assign badge number");
};

export const assignWebAttemptBadgeNumber = async (attemptId: number) => {
  const [existingAttempt] = await db
    .select({ badgeNumber: webBadgeAttempts.badgeNumber })
    .from(webBadgeAttempts)
    .where(eq(webBadgeAttempts.id, attemptId))
    .limit(1);

  if (!existingAttempt) {
    throw new Error("Badge attempt not found");
  }
  if (existingAttempt.badgeNumber !== null) {
    return existingAttempt.badgeNumber;
  }

  const badgeNumber = await lowestAvailableBadgeNumber();
  await db
    .update(webBadgeAttempts)
    .set({ badgeNumber, updatedAt: new Date() })
    .where(eq(webBadgeAttempts.id, attemptId));

  return badgeNumber;
};

export const findCompletedWebBadge = async (webParticipantId: number) => {
  const [badge] = await db
    .select()
    .from(badges)
    .where(eq(badges.webParticipantId, webParticipantId))
    .limit(1);

  return badge ?? null;
};

export const findActiveWebAttempt = async (webParticipantId: number) => {
  const [attempt] = await db
    .select()
    .from(webBadgeAttempts)
    .where(
      and(
        eq(webBadgeAttempts.webParticipantId, webParticipantId),
        inArray(webBadgeAttempts.status, inProgressAttemptStatuses),
      ),
    )
    .orderBy(desc(webBadgeAttempts.createdAt))
    .limit(1);

  return attempt ?? null;
};

export const findLatestRetryableWebAttempt = async (
  webParticipantId: number,
) => {
  const [attempt] = await db
    .select()
    .from(webBadgeAttempts)
    .where(
      and(
        eq(webBadgeAttempts.webParticipantId, webParticipantId),
        inArray(webBadgeAttempts.status, ["rejected", "failed"]),
      ),
    )
    .orderBy(desc(webBadgeAttempts.createdAt))
    .limit(1);

  return attempt ?? null;
};

export const upsertCanonicalWhatsappBadge = async ({
  conversationId,
  pixelArtImageUrl,
  badgeImageUrl,
}: {
  conversationId: number;
  pixelArtImageUrl: string;
  badgeImageUrl: string;
}) => {
  const [conversation] = await db
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId))
    .limit(1);

  if (!conversation?.badgeNumber) {
    throw new Error("Cannot create canonical WhatsApp badge without number");
  }

  const now = new Date();
  const [badge] = await db
    .insert(badges)
    .values({
      badgeNumber: conversation.badgeNumber,
      sourceChannel: "whatsapp",
      whatsappConversationId: conversation.id,
      participantDisplayName: conversation.contactName,
      sourceImageUrl: conversation.sourceImageUrl,
      pixelArtImageUrl,
      badgeImageUrl,
      generatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: badges.whatsappConversationId,
      set: {
        participantDisplayName: conversation.contactName,
        sourceImageUrl: conversation.sourceImageUrl,
        pixelArtImageUrl,
        badgeImageUrl,
        generatedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return badge;
};

export const upsertCanonicalWebBadge = async ({
  attemptId,
  pixelArtImageUrl,
  badgeImageUrl,
}: {
  attemptId: number;
  pixelArtImageUrl: string;
  badgeImageUrl: string;
}) => {
  const [attempt] = await db
    .select({
      id: webBadgeAttempts.id,
      webParticipantId: webBadgeAttempts.webParticipantId,
      badgeNumber: webBadgeAttempts.badgeNumber,
      sourceImageUrl: webBadgeAttempts.sourceImageUrl,
      participantEmail: webParticipants.email,
      participantDisplayName: webParticipants.displayName,
    })
    .from(webBadgeAttempts)
    .innerJoin(
      webParticipants,
      eq(webBadgeAttempts.webParticipantId, webParticipants.id),
    )
    .where(eq(webBadgeAttempts.id, attemptId))
    .limit(1);

  if (!attempt?.badgeNumber) {
    throw new Error("Cannot create canonical web badge without number");
  }

  const now = new Date();
  const [badge] = await db
    .insert(badges)
    .values({
      badgeNumber: attempt.badgeNumber,
      sourceChannel: "web",
      webParticipantId: attempt.webParticipantId,
      webBadgeAttemptId: attempt.id,
      participantDisplayName: attempt.participantDisplayName,
      participantEmail: attempt.participantEmail,
      sourceImageUrl: attempt.sourceImageUrl,
      pixelArtImageUrl,
      badgeImageUrl,
      generatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: badges.webParticipantId,
      set: {
        webBadgeAttemptId: attempt.id,
        participantDisplayName: attempt.participantDisplayName,
        participantEmail: attempt.participantEmail,
        sourceImageUrl: attempt.sourceImageUrl,
        pixelArtImageUrl,
        badgeImageUrl,
        generatedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return badge;
};
