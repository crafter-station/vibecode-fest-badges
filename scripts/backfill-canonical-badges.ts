import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { badges, whatsappConversations } from "@/db/schema";

const completedConversations = await db
  .select()
  .from(whatsappConversations)
  .where(
    and(
      eq(whatsappConversations.badgeGenerated, true),
      isNotNull(whatsappConversations.badgeNumber),
      isNotNull(whatsappConversations.badgeImageUrl),
    ),
  );

let linkedCount = 0;

for (const conversation of completedConversations) {
  if (conversation.badgeNumber === null || !conversation.badgeImageUrl) {
    continue;
  }

  const now = new Date();
  const [insertedBadge] = await db
    .insert(badges)
    .values({
      badgeNumber: conversation.badgeNumber,
      origin: "whatsapp",
      sourceImageUrl: conversation.sourceImageUrl,
      pixelArtImageUrl: conversation.pixelArtImageUrl,
      badgeImageUrl: conversation.badgeImageUrl,
      generationStatus: "generated",
      generationError: conversation.generationError,
      generatedAt: conversation.badgeGeneratedAt ?? now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: badges.badgeNumber })
    .returning();

  const badge =
    insertedBadge ??
    (
      await db
        .select()
        .from(badges)
        .where(eq(badges.badgeNumber, conversation.badgeNumber))
        .limit(1)
    )[0];

  if (!badge) {
    throw new Error(`Failed to backfill badge #${conversation.badgeNumber}`);
  }

  await db
    .update(whatsappConversations)
    .set({ badgeId: badge.id, updatedAt: now })
    .where(eq(whatsappConversations.id, conversation.id));
  linkedCount += 1;
}

console.log(
  `Backfilled ${linkedCount} completed WhatsApp Badge conversations into canonical badges.`,
);
