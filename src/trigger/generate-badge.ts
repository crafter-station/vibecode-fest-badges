import { randomUUID } from "node:crypto";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import sharp from "sharp";
import { z } from "zod";
import { fontUrl, logoImageUrl, templateImageUrl } from "@/lib/contants";
import {
  assertImageMedia,
  escapeXml,
  generatedImageSize,
  loadMediaFromUrl,
  uploadImageToBlob,
} from "./badge-utils";

export const generateBadgeTask = schemaTask({
  id: "generate-badge",
  maxDuration: 300,
  machine: { preset: "medium-1x" },
  schema: z.object({
    badgeNumber: z.number().int().nonnegative(),
    pixelArtImageUrl: z.url(),
  }),
  run: async ({ badgeNumber, pixelArtImageUrl }) => {
    const pixelArtImage = await loadMediaFromUrl(pixelArtImageUrl);
    const templateImage = await loadMediaFromUrl(templateImageUrl);
    const logoImage = await loadMediaFromUrl(logoImageUrl);
    const font = await loadMediaFromUrl(fontUrl);
    assertImageMedia(pixelArtImage, "pixel art image URL");
    assertImageMedia(templateImage, "templateImageUrl");
    assertImageMedia(logoImage, "logoImageUrl");
    const templateBuffer = Buffer.from(templateImage.uint8Array);
    const logoBuffer = Buffer.from(logoImage.uint8Array);
    const templateMetadata = await sharp(templateBuffer).metadata();

    if (!templateMetadata.width || !templateMetadata.height) {
      throw new Error("Could not read template image dimensions");
    }

    const centeredGeneratedImage = await sharp(pixelArtImage.uint8Array)
      .resize(generatedImageSize, generatedImageSize, {
        fit: "cover",
        kernel: sharp.kernel.nearest,
      })
      .png()
      .toBuffer();

    const fontData = Buffer.from(font.uint8Array).toString("base64");
    const formattedBadgeNumber = `#${String(badgeNumber).padStart(4, "0")}`;
    const escapedBadgeNumber = escapeXml(formattedBadgeNumber);
    const numberOverlay = Buffer.from(`
<svg width="230" height="80" viewBox="0 0 230 80" xmlns="http://www.w3.org/2000/svg">
  <style>
    @font-face {
      font-family: 'Tiny5';
      src: url('data:font/truetype;base64,${fontData}') format('truetype');
    }
    text {
      font-family: 'Tiny5';
      font-size: 64px;
    }
  </style>
  <rect x="0" y="0" width="230" height="80" fill="#ffffff" />
  <text x="115" y="59" fill="#000000" text-anchor="middle">${escapedBadgeNumber}</text>
</svg>`);

    const badgeImage = await sharp(templateBuffer)
      .composite([
        {
          input: centeredGeneratedImage,
          left: Math.round((templateMetadata.width - generatedImageSize) / 2),
          top: Math.round((templateMetadata.height - generatedImageSize) / 2),
        },
        { input: logoBuffer, left: 383, top: 356 },
        { input: numberOverlay, left: 235, top: 895 },
      ])
      .png()
      .toBuffer();
    const badgeImageUrl = await uploadImageToBlob({
      buffer: badgeImage,
      pathname: `badges/badge-${badgeNumber}-${randomUUID()}.png`,
    });

    logger.log("Generated badge", {
      badgeNumber,
      byteLength: badgeImage.byteLength,
      badgeImageUrl,
    });

    return {
      badgeImageUrl,
      mediaType: "image/png",
      byteLength: badgeImage.byteLength,
    };
  },
});
