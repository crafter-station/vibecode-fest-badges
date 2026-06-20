import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { badges, whatsappConversations } from "@/db/schema";

const [completedWhatsappResult] = await db
  .select({ value: count() })
  .from(whatsappConversations)
  .where(
    and(
      eq(whatsappConversations.badgeGenerated, true),
      isNotNull(whatsappConversations.badgeNumber),
      isNotNull(whatsappConversations.badgeImageUrl),
    ),
  );
const [canonicalWhatsappResult] = await db
  .select({ value: count() })
  .from(badges)
  .where(eq(badges.sourceChannel, "whatsapp"));
const canonicalBadges = await db
  .select({
    id: badges.id,
    badgeNumber: badges.badgeNumber,
    badgeImageUrl: badges.badgeImageUrl,
  })
  .from(badges);

const completedWhatsappCount = completedWhatsappResult?.value ?? 0;
const canonicalWhatsappCount = canonicalWhatsappResult?.value ?? 0;
const duplicateNumbers = new Set<number>();
const seenNumbers = new Set<number>();
const missingUrls: number[] = [];

for (const badge of canonicalBadges) {
  if (seenNumbers.has(badge.badgeNumber)) {
    duplicateNumbers.add(badge.badgeNumber);
  }
  seenNumbers.add(badge.badgeNumber);

  if (!badge.badgeImageUrl) {
    missingUrls.push(badge.id);
  }
}

const failures = [
  completedWhatsappCount !== canonicalWhatsappCount
    ? `Canonical WhatsApp count ${canonicalWhatsappCount} does not match completed WhatsApp count ${completedWhatsappCount}.`
    : null,
  duplicateNumbers.size > 0
    ? `Duplicate badge numbers: ${Array.from(duplicateNumbers).join(", ")}.`
    : null,
  missingUrls.length > 0
    ? `Badges missing image URLs: ${missingUrls.join(", ")}.`
    : null,
].filter((failure): failure is string => failure !== null);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(
  `Canonical badges verified. WhatsApp: ${canonicalWhatsappCount}. Total canonical: ${canonicalBadges.length}.`,
);
