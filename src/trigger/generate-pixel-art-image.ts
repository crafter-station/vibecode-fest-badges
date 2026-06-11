import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { generateText } from "ai";
import sharp from "sharp";
import { z } from "zod";
import {
  assertImageMedia,
  loadMediaFromUrl,
  mediaFromStaticToolResults,
  standaloneGeneratedImageSize,
  uploadImageToBlob,
} from "./badge-utils";

export const generatePixelArtImageTask = schemaTask({
  id: "generate-pixel-art-image",
  maxDuration: 900,
  machine: { preset: "medium-1x" },
  schema: z.object({
    imageUrl: z.url(),
  }),
  run: async ({ imageUrl }) => {
    const inputImage = await loadMediaFromUrl(imageUrl);
    assertImageMedia(inputImage, "input image URL");

    const result = await generateText({
      model: openai("gpt-5.5"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Create a square profile-picture version of the attached image. Preserve the person's identity and overall pose. Render it as grayscale pixel art with chunky low-resolution pixels, strong silhouette readability, and a transparent or simple dark background. Return the square image file only as a PNG.",
            },
            {
              type: "image",
              image: inputImage.uint8Array,
              mediaType: inputImage.mediaType,
              providerOptions: {
                openai: { imageDetail: "high" },
              },
            },
          ],
        },
      ],
      tools: {
        image_generation: openai.tools.imageGeneration({ outputFormat: "png" }),
      },
    });

    const generatedFile = mediaFromStaticToolResults(result.staticToolResults);
    if (!generatedFile) {
      throw new Error(
        `No generated image file returned by gpt-5.5. Text response: ${result.text}`,
      );
    }

    const generatedSquareImage = await sharp(generatedFile.uint8Array)
      .resize(standaloneGeneratedImageSize, standaloneGeneratedImageSize, {
        fit: "cover",
        kernel: sharp.kernel.nearest,
      })
      .png()
      .toBuffer();
    const pixelArtImageUrl = await uploadImageToBlob({
      buffer: generatedSquareImage,
      pathname: `pixel-art/${randomUUID()}.png`,
    });

    logger.log("Generated pixel art image", {
      finishReason: result.finishReason,
      byteLength: generatedSquareImage.byteLength,
      pixelArtImageUrl,
      usage: result.usage,
    });

    return {
      pixelArtImageUrl,
      mediaType: "image/png",
      byteLength: generatedSquareImage.byteLength,
    };
  },
});
