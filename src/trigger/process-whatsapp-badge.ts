import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappConversations } from "@/db/schema";
import {
  generateFailureReply,
  sendWhatsAppImage,
  sendWhatsAppText,
} from "@/lib/whatsapp";
import { insertOutboundWhatsAppMessage } from "@/lib/whatsapp-webhook";
import { generateProfileBadgeTask } from "./generate-profile-badge";

export const processWhatsAppBadgeTask = schemaTask({
  id: "process-whatsapp-badge",
  maxDuration: 1500,
  schema: z.object({
    conversationId: z.number().int().positive(),
    phoneNumberId: z.string().min(1),
    waId: z.string().min(1),
    badgeNumber: z.number().int().nonnegative(),
    imageUrl: z.url(),
  }),
  run: async ({
    conversationId,
    phoneNumberId,
    waId,
    badgeNumber,
    imageUrl,
  }) => {
    logger.log("WhatsApp badge processing started", {
      conversationId,
      phoneNumberId,
      waId,
      badgeNumber,
      imageUrl,
    });

    try {
      const result = await generateProfileBadgeTask.triggerAndWait({
        badgeNumber,
        imageUrl,
      });

      if (!result.ok) {
        throw result.error;
      }

      await db
        .update(whatsappConversations)
        .set({
          badgeGenerated: true,
          pixelArtImageUrl: result.output.pixelArtImageUrl,
          badgeImageUrl: result.output.badgeImageUrl,
          generationError: null,
          badgeGeneratedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(whatsappConversations.id, conversationId));

      const imageCaption =
        "Tu badge de VibeCode Fest ya está listo. Guárdalo y compártelo en Instagram, LinkedIn o X para que tus amigos también puedan venir.";
      const imageResponse = await sendWhatsAppImage({
        phoneNumberId,
        to: waId,
        imageUrl: result.output.badgeImageUrl,
        caption: imageCaption,
      });
      await insertOutboundWhatsAppMessage({
        conversationId,
        messageType: "image",
        content: imageCaption,
        mediaUrl: result.output.badgeImageUrl,
        response: imageResponse,
      });

      logger.log("WhatsApp badge processing completed", {
        conversationId,
        badgeNumber,
        pixelArtImageUrl: result.output.pixelArtImageUrl,
        badgeImageUrl: result.output.badgeImageUrl,
      });

      return result.output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      await db
        .update(whatsappConversations)
        .set({ generationError: message, updatedAt: new Date() })
        .where(eq(whatsappConversations.id, conversationId));

      logger.error("WhatsApp badge generation failed", {
        conversationId,
        badgeNumber,
        error: message,
      });

      const body = await generateFailureReply();
      const textResponse = await sendWhatsAppText({
        phoneNumberId,
        to: waId,
        body,
      });
      await insertOutboundWhatsAppMessage({
        conversationId,
        messageType: "text",
        content: body,
        response: textResponse,
      });

      throw error;
    }
  },
});
