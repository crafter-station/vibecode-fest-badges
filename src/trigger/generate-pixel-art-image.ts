import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { generateText } from "ai";
import sharp from "sharp";
import { z } from "zod";
import {
  assertImageMedia,
  isOpenAIResponsesSocketCloseError,
  loadMediaFromUrl,
  mediaFromStaticToolResults,
  standaloneGeneratedImageSize,
  uploadImageToBlob,
} from "./badge-utils";

const serializeError = (error: unknown, depth = 0): unknown => {
  if (depth > 3) {
    return "[Max depth reached]";
  }

  if (error instanceof Error) {
    const errorWithDetails = error as Error & {
      cause?: unknown;
      data?: unknown;
      errors?: unknown[];
      isRetryable?: unknown;
      lastError?: unknown;
      reason?: unknown;
      responseBody?: unknown;
      responseHeaders?: unknown;
      statusCode?: unknown;
      url?: unknown;
    };
    const responseBody =
      typeof errorWithDetails.responseBody === "string"
        ? errorWithDetails.responseBody.slice(0, 4000)
        : errorWithDetails.responseBody;

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      reason: errorWithDetails.reason,
      url: errorWithDetails.url,
      statusCode: errorWithDetails.statusCode,
      responseHeaders: errorWithDetails.responseHeaders,
      responseBody,
      data: errorWithDetails.data,
      isRetryable: errorWithDetails.isRetryable,
      lastError:
        errorWithDetails.lastError === undefined
          ? undefined
          : serializeError(errorWithDetails.lastError, depth + 1),
      cause:
        errorWithDetails.cause === undefined
          ? undefined
          : serializeError(errorWithDetails.cause, depth + 1),
      errors: Array.isArray(errorWithDetails.errors)
        ? errorWithDetails.errors.map((item) => serializeError(item, depth + 1))
        : undefined,
    };
  }

  if (Array.isArray(error)) {
    return error.map((item) => serializeError(item, depth + 1));
  }

  if (error && typeof error === "object") {
    return Object.fromEntries(
      Object.entries(error).map(([key, value]) => [
        key,
        serializeError(value, depth + 1),
      ]),
    );
  }

  return error;
};

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
    const inputMetadata = await sharp(inputImage.uint8Array).metadata();
    const aiInputImage = await sharp(inputImage.uint8Array)
      .rotate()
      .resize({ height: 1000, withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    const aiInputMetadata = await sharp(aiInputImage).metadata();

    logger.log("Starting pixel art image generation", {
      model: "gpt-5.5",
      tool: "openai.image_generation",
      inputMediaType: inputImage.mediaType,
      inputByteLength: inputImage.uint8Array.byteLength,
      inputFormat: inputMetadata.format,
      inputWidth: inputMetadata.width,
      inputHeight: inputMetadata.height,
      inputSpace: inputMetadata.space,
      inputChannels: inputMetadata.channels,
      inputDepth: inputMetadata.depth,
      inputDensity: inputMetadata.density,
      inputPages: inputMetadata.pages,
      inputOrientation: inputMetadata.orientation,
      inputHasAlpha: inputMetadata.hasAlpha,
      aiInputMediaType: "image/webp",
      aiInputByteLength: aiInputImage.byteLength,
      aiInputFormat: aiInputMetadata.format,
      aiInputWidth: aiInputMetadata.width,
      aiInputHeight: aiInputMetadata.height,
      outputFormat: "webp",
    });

    const result = await (async () => {
      try {
        return await generateText({
          model: openai("gpt-5.5"),
          maxRetries: 0,
          timeout: 5 * 60 * 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Create a square profile-picture version of the attached image. Preserve the person's identity and overall pose. Render it as grayscale pixel art with chunky low-resolution pixels, strong silhouette readability, and a transparent or simple dark background. Return the square image file only as a WebP.",
                },
                {
                  type: "image",
                  image: aiInputImage,
                  mediaType: "image/webp",
                  providerOptions: {
                    openai: { imageDetail: "high" },
                  },
                },
              ],
            },
          ],
          tools: {
            image_generation: openai.tools.imageGeneration({
              outputFormat: "webp",
            }),
          },
          experimental_onToolCallStart: ({ toolCall }) => {
            logger.log("Pixel art tool call started", {
              toolName: toolCall.toolName,
            });
          },
          experimental_onToolCallFinish: (event) => {
            logger.log("Pixel art tool call finished", {
              toolName: event.toolCall.toolName,
              success: event.success,
              output: event.success ? event.output : undefined,
              error: event.success ? undefined : serializeError(event.error),
            });
          },
          experimental_telemetry: {
            isEnabled: true,
          },
        });
      } catch (error) {
        logger.error("Pixel art image generation failed", {
          model: "gpt-5.5",
          tool: "openai.image_generation",
          inputMediaType: inputImage.mediaType,
          inputByteLength: inputImage.uint8Array.byteLength,
          inputFormat: inputMetadata.format,
          inputWidth: inputMetadata.width,
          inputHeight: inputMetadata.height,
          inputPages: inputMetadata.pages,
          inputOrientation: inputMetadata.orientation,
          inputHasAlpha: inputMetadata.hasAlpha,
          aiInputMediaType: "image/webp",
          aiInputByteLength: aiInputImage.byteLength,
          aiInputFormat: aiInputMetadata.format,
          aiInputWidth: aiInputMetadata.width,
          aiInputHeight: aiInputMetadata.height,
          error: serializeError(error),
        });
        if (isOpenAIResponsesSocketCloseError(error)) {
          return {
            rejectedImage: true,
            reason: "openai_responses_socket_closed",
            mediaType: "image/webp",
            byteLength: 0,
          };
        }
        throw error;
      }
    })();

    if ("rejectedImage" in result) {
      return result;
    }

    logger.log("Pixel art image generation completed", {
      finishReason: result.finishReason,
      staticToolResultCount: result.staticToolResults.length,
      textLength: result.text.length,
      usage: result.usage,
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
      .webp({ quality: 100, lossless: true })
      .toBuffer();
    const pixelArtImageUrl = await uploadImageToBlob({
      buffer: generatedSquareImage,
      contentType: "image/webp",
      pathname: `pixel-art/${randomUUID()}.webp`,
    });

    logger.log("Generated pixel art image", {
      finishReason: result.finishReason,
      byteLength: generatedSquareImage.byteLength,
      pixelArtImageUrl,
      usage: result.usage,
    });

    return {
      pixelArtImageUrl,
      mediaType: "image/webp",
      byteLength: generatedSquareImage.byteLength,
    };
  },
});
