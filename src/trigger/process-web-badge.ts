import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webBadgeAttempts } from "@/db/schema";
import { upsertCanonicalWebBadge } from "@/lib/badges";
import { isOpenAIResponsesSocketCloseError } from "./badge-utils";
import { generateProfileBadgeTask } from "./generate-profile-badge";

export const processWebBadgeTask = schemaTask({
  id: "process-web-badge",
  maxDuration: 1500,
  schema: z.object({
    attemptId: z.number().int().positive(),
    badgeNumber: z.number().int().positive(),
    imageUrl: z.url(),
  }),
  run: async ({ attemptId, badgeNumber, imageUrl }) => {
    logger.log("Web badge processing started", {
      attemptId,
      badgeNumber,
      imageUrl,
    });

    await db
      .update(webBadgeAttempts)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(webBadgeAttempts.id, attemptId));

    try {
      const result = await generateProfileBadgeTask.triggerAndWait({
        badgeNumber,
        imageUrl,
      });

      if (!result.ok) {
        throw result.error;
      }

      if ("rejectedImage" in result.output) {
        const reason = result.output.reason ?? "image_rejected";
        await db
          .update(webBadgeAttempts)
          .set({
            status: "rejected",
            generationError: reason,
            updatedAt: new Date(),
          })
          .where(eq(webBadgeAttempts.id, attemptId));

        logger.log("Web badge image rejected", {
          attemptId,
          badgeNumber,
          reason,
        });
        return result.output;
      }

      const now = new Date();
      await db
        .update(webBadgeAttempts)
        .set({
          status: "completed",
          pixelArtImageUrl: result.output.pixelArtImageUrl,
          badgeImageUrl: result.output.badgeImageUrl,
          generationError: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(webBadgeAttempts.id, attemptId));
      await upsertCanonicalWebBadge({
        attemptId,
        pixelArtImageUrl: result.output.pixelArtImageUrl,
        badgeImageUrl: result.output.badgeImageUrl,
      });

      logger.log("Web badge processing completed", {
        attemptId,
        badgeNumber,
        pixelArtImageUrl: result.output.pixelArtImageUrl,
        badgeImageUrl: result.output.badgeImageUrl,
      });

      return result.output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = isOpenAIResponsesSocketCloseError(error)
        ? "rejected"
        : "failed";

      await db
        .update(webBadgeAttempts)
        .set({ status, generationError: message, updatedAt: new Date() })
        .where(eq(webBadgeAttempts.id, attemptId));

      logger.error("Web badge generation failed", {
        attemptId,
        badgeNumber,
        status,
        error: message,
      });

      if (status === "rejected") {
        return { rejectedImage: true, reason: message };
      }

      throw error;
    }
  },
});
