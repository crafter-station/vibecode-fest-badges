import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webBadgeRequests } from "@/db/schema";
import {
  markBadgeFailed,
  markBadgeGenerated,
  markBadgeGenerating,
  markBadgeRejected,
} from "@/lib/badges";
import { isOpenAIResponsesSocketCloseError } from "./badge-utils";
import { generateProfileBadgeTask } from "./generate-profile-badge";

export const processWebBadgeTask = schemaTask({
  id: "process-web-badge",
  maxDuration: 1500,
  schema: z.object({
    requestId: z.number().int().positive(),
    badgeId: z.number().int().positive(),
    badgeNumber: z.number().int().positive(),
    imageUrl: z.url(),
  }),
  run: async ({ requestId, badgeId, badgeNumber, imageUrl }) => {
    logger.log("Web badge processing started", {
      requestId,
      badgeId,
      badgeNumber,
      imageUrl,
    });

    await Promise.all([
      markBadgeGenerating({ badgeId, sourceImageUrl: imageUrl }),
      db
        .update(webBadgeRequests)
        .set({
          status: "generating",
          generationError: null,
          updatedAt: new Date(),
        })
        .where(eq(webBadgeRequests.id, requestId)),
    ]);

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
        await Promise.all([
          markBadgeRejected({ badgeId, reason }),
          db
            .update(webBadgeRequests)
            .set({
              status: "rejected",
              generationError: reason,
              updatedAt: new Date(),
            })
            .where(eq(webBadgeRequests.id, requestId)),
        ]);

        logger.log("Web badge image rejected", {
          requestId,
          badgeNumber,
          reason,
        });

        return result.output;
      }

      await Promise.all([
        markBadgeGenerated({
          badgeId,
          sourceImageUrl: imageUrl,
          pixelArtImageUrl: result.output.pixelArtImageUrl,
          badgeImageUrl: result.output.badgeImageUrl,
        }),
        db
          .update(webBadgeRequests)
          .set({
            status: "generated",
            pixelArtImageUrl: result.output.pixelArtImageUrl,
            badgeImageUrl: result.output.badgeImageUrl,
            generationError: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(webBadgeRequests.id, requestId)),
      ]);

      logger.log("Web badge processing completed", {
        requestId,
        badgeNumber,
        badgeImageUrl: result.output.badgeImageUrl,
      });

      return result.output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const shouldRetryWithImage = isOpenAIResponsesSocketCloseError(error);
      const status = shouldRetryWithImage ? "rejected" : "failed";

      await Promise.all([
        shouldRetryWithImage
          ? markBadgeRejected({ badgeId, reason: message })
          : markBadgeFailed({ badgeId, error: message }),
        db
          .update(webBadgeRequests)
          .set({
            status,
            generationError: message,
            updatedAt: new Date(),
          })
          .where(eq(webBadgeRequests.id, requestId)),
      ]);

      logger.error("Web badge generation failed", {
        requestId,
        badgeNumber,
        error: message,
        shouldRetryWithImage,
      });

      if (shouldRetryWithImage) {
        return { rejectedImage: true, reason: message };
      }

      throw error;
    }
  },
});
