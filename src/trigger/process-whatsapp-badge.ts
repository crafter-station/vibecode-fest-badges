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
import { isOpenAIResponsesSocketCloseError } from "./badge-utils";
import { generateProfileBadgeTask } from "./generate-profile-badge";

const policyImageFailureReply =
  "No pudimos usar esa imagen porque parece no cumplir con nuestras políticas de generación, posiblemente por derechos de autor o contenido protegido. Por favor envíame otra foto clara tuya para crear tu badge.";

const resetGenerationAndAskForNewImage = async ({
  conversationId,
  phoneNumberId,
  to,
  generationError,
}: {
  conversationId: number;
  phoneNumberId: string;
  to: string;
  generationError: string;
}) => {
  await db
    .update(whatsappConversations)
    .set({
      badgeGenerationRunId: null,
      badgeGenerationStarted: false,
      generationError,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, conversationId));

  const textResponse = await sendWhatsAppText({
    phoneNumberId,
    to,
    body: policyImageFailureReply,
  });
  await insertOutboundWhatsAppMessage({
    conversationId,
    messageType: "text",
    content: policyImageFailureReply,
    response: textResponse,
  });
};

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
      if ("rejectedImage" in result.output) {
        const reason = result.output.reason ?? "openai_responses_socket_closed";
        await resetGenerationAndAskForNewImage({
          conversationId,
          phoneNumberId,
          to: waId,
          generationError: reason,
        });

        logger.log("WhatsApp badge image rejected", {
          conversationId,
          badgeNumber,
          reason,
        });

        return result.output;
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
      const shouldAskForNewImage = isOpenAIResponsesSocketCloseError(error);

      if (shouldAskForNewImage) {
        await resetGenerationAndAskForNewImage({
          conversationId,
          phoneNumberId,
          to: waId,
          generationError: message,
        });
      } else {
        await db
          .update(whatsappConversations)
          .set({ generationError: message, updatedAt: new Date() })
          .where(eq(whatsappConversations.id, conversationId));
      }

      logger.error("WhatsApp badge generation failed", {
        conversationId,
        badgeNumber,
        error: message,
        shouldAskForNewImage,
      });

      const body = shouldAskForNewImage
        ? policyImageFailureReply
        : await generateFailureReply();
      if (shouldAskForNewImage) {
        return { rejectedImage: true, reason: message };
      }

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
