import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { generateBadgeTask } from "./generate-badge";
import { generatePixelArtImageTask } from "./generate-pixel-art-image";

export const generateProfileBadgeTask = schemaTask({
  id: "generate-profile-badge",
  maxDuration: 1200,
  schema: z.object({
    badgeNumber: z.number().int().nonnegative(),
    imageUrl: z.url(),
  }),
  run: async ({ badgeNumber, imageUrl }) => {
    const pixelArtResult = await generatePixelArtImageTask.triggerAndWait({
      imageUrl,
    });
    if (!pixelArtResult.ok) {
      throw pixelArtResult.error;
    }
    if ("rejectedImage" in pixelArtResult.output) {
      return {
        badgeNumber,
        imageUrl,
        rejectedImage: true,
        reason: pixelArtResult.output.reason,
      };
    }

    const badgeResult = await generateBadgeTask.triggerAndWait({
      badgeNumber,
      pixelArtImageUrl: pixelArtResult.output.pixelArtImageUrl,
    });
    if (!badgeResult.ok) {
      throw badgeResult.error;
    }

    return {
      badgeNumber,
      imageUrl,
      pixelArtImageUrl: pixelArtResult.output.pixelArtImageUrl,
      badgeImageUrl: badgeResult.output.badgeImageUrl,
    };
  },
});
