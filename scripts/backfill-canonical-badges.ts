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

let upserted = 0;

for (const conversation of completedConversations) {
  if (!conversation.badgeNumber || !conversation.badgeImageUrl) {
    continue;
  }

  const now = new Date();
  await db
    .insert(badges)
    .values({
      badgeNumber: conversation.badgeNumber,
      sourceChannel: "whatsapp",
      whatsappConversationId: conversation.id,
      participantDisplayName: conversation.contactName,
      sourceImageUrl: conversation.sourceImageUrl,
      pixelArtImageUrl: conversation.pixelArtImageUrl,
      badgeImageUrl: conversation.badgeImageUrl,
      generatedAt: conversation.badgeGeneratedAt ?? conversation.updatedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: badges.whatsappConversationId,
      set: {
        badgeNumber: conversation.badgeNumber,
        participantDisplayName: conversation.contactName,
        sourceImageUrl: conversation.sourceImageUrl,
        pixelArtImageUrl: conversation.pixelArtImageUrl,
        badgeImageUrl: conversation.badgeImageUrl,
        generatedAt: conversation.badgeGeneratedAt ?? conversation.updatedAt,
        updatedAt: now,
      },
    });

  upserted += 1;
}

console.log(`Backfilled ${upserted} canonical WhatsApp badges.`);
