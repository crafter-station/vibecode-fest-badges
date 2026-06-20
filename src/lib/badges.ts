import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { badges, whatsappConversations } from "@/db/schema";

export type BadgeOrigin = "whatsapp" | "web";

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
    constraint === "badges_badge_number_idx" ||
    message?.includes("badges_badge_number_idx") === true
  );
};

const lowestAvailableBadgeNumber = async () => {
  const [canonicalRows, legacyRows] = await Promise.all([
    db
      .select({ badgeNumber: badges.badgeNumber })
      .from(badges)
      .orderBy(asc(badges.badgeNumber)),
    db
      .select({ badgeNumber: whatsappConversations.badgeNumber })
      .from(whatsappConversations)
      .where(isNotNull(whatsappConversations.badgeNumber))
      .orderBy(asc(whatsappConversations.badgeNumber)),
  ]);
  const assignedBadgeNumbers = new Set<number>();

  for (const row of canonicalRows) {
    assignedBadgeNumbers.add(row.badgeNumber);
  }

  for (const row of legacyRows) {
    if (row.badgeNumber !== null) {
      assignedBadgeNumbers.add(row.badgeNumber);
    }
  }

  let badgeNumber = 1;
  while (assignedBadgeNumbers.has(badgeNumber)) {
    badgeNumber += 1;
  }

  return badgeNumber;
};

export const allocateBadge = async ({
  origin,
  sourceImageUrl,
}: {
  origin: BadgeOrigin;
  sourceImageUrl?: string;
}) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const badgeNumber = await lowestAvailableBadgeNumber();

    try {
      const [badge] = await db
        .insert(badges)
        .values({
          badgeNumber,
          origin,
          sourceImageUrl,
          generationStatus: "allocated",
          updatedAt: new Date(),
        })
        .returning();

      if (badge) {
        return badge;
      }
    } catch (error) {
      if (!isBadgeNumberConflict(error) || attempt === 4) {
        throw error;
      }
    }
  }

  throw new Error("Failed to allocate badge number");
};

export const ensureWhatsAppBadge = async (conversationId: number) => {
  const [conversation] = await db
    .select({
      badgeId: whatsappConversations.badgeId,
      badgeNumber: whatsappConversations.badgeNumber,
      sourceImageUrl: whatsappConversations.sourceImageUrl,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId))
    .limit(1);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.badgeId !== null) {
    const [existingBadge] = await db
      .select()
      .from(badges)
      .where(eq(badges.id, conversation.badgeId))
      .limit(1);

    if (existingBadge) {
      return existingBadge;
    }
  }

  const badge = await allocateBadge({
    origin: "whatsapp",
    sourceImageUrl: conversation.sourceImageUrl ?? undefined,
  });

  await db
    .update(whatsappConversations)
    .set({
      badgeId: badge.id,
      badgeNumber: badge.badgeNumber,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, conversationId));

  return badge;
};

export const markBadgeGenerating = async ({
  badgeId,
  sourceImageUrl,
}: {
  badgeId: number;
  sourceImageUrl: string;
}) => {
  await db
    .update(badges)
    .set({
      sourceImageUrl,
      generationStatus: "generating",
      generationError: null,
      updatedAt: new Date(),
    })
    .where(eq(badges.id, badgeId));
};

export const markBadgeGenerated = async ({
  badgeId,
  sourceImageUrl,
  pixelArtImageUrl,
  badgeImageUrl,
}: {
  badgeId: number;
  sourceImageUrl: string;
  pixelArtImageUrl: string;
  badgeImageUrl: string;
}) => {
  const now = new Date();

  await db
    .update(badges)
    .set({
      sourceImageUrl,
      pixelArtImageUrl,
      badgeImageUrl,
      generationStatus: "generated",
      generationError: null,
      generatedAt: now,
      updatedAt: now,
    })
    .where(eq(badges.id, badgeId));
};

export const markBadgeRejected = async ({
  badgeId,
  reason,
}: {
  badgeId: number;
  reason: string;
}) => {
  await db
    .update(badges)
    .set({
      generationStatus: "rejected",
      generationError: reason,
      updatedAt: new Date(),
    })
    .where(eq(badges.id, badgeId));
};

export const markBadgeFailed = async ({
  badgeId,
  error,
}: {
  badgeId: number;
  error: string;
}) => {
  await db
    .update(badges)
    .set({
      generationStatus: "failed",
      generationError: error,
      updatedAt: new Date(),
    })
    .where(eq(badges.id, badgeId));
};
