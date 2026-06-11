import { randomUUID } from "node:crypto";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import sharp from "sharp";
import { z } from "zod";
import { logoImageUrl, templateImageUrl } from "@/lib/contants";
import {
  assertImageMedia,
  generatedImageSize,
  loadMediaFromUrl,
  uploadImageToBlob,
} from "./badge-utils";

const badgeNumberGlyphs: Record<string, string[]> = {
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "01010"],
  "0": ["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
  "3": ["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
  "4": ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  "5": ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  "6": ["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
  "9": ["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
};

export const createBadgeNumberOverlay = (badgeNumber: number) => {
  const formattedBadgeNumber = `#${String(badgeNumber).padStart(4, "0")}`;
  const glyphs = [...formattedBadgeNumber]
    .map((character) => badgeNumberGlyphs[character])
    .filter((glyph): glyph is string[] => Boolean(glyph));
  const glyphWidth = 5;
  const glyphHeight = 7;
  const glyphGap = 1;
  const overlayWidth = 230;
  const overlayHeight = 80;
  const totalColumns =
    glyphs.length * glyphWidth + Math.max(glyphs.length - 1, 0) * glyphGap;
  const cellSize = Math.floor(
    Math.min(
      (overlayWidth - 20) / totalColumns,
      (overlayHeight - 18) / glyphHeight,
    ),
  );
  const renderedWidth = totalColumns * cellSize;
  const renderedHeight = glyphHeight * cellSize;
  const startX = Math.round((overlayWidth - renderedWidth) / 2);
  const startY = Math.round((overlayHeight - renderedHeight) / 2);
  const rects = glyphs.flatMap((glyph, glyphIndex) =>
    glyph.flatMap((row, rowIndex) =>
      [...row]
        .map((pixel, columnIndex) => {
          if (pixel !== "1") {
            return undefined;
          }

          const x =
            startX +
            (glyphIndex * (glyphWidth + glyphGap) + columnIndex) * cellSize;
          const y = startY + rowIndex * cellSize;
          return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#000000" />`;
        })
        .filter(Boolean),
    ),
  );

  return Buffer.from(`
<svg width="${overlayWidth}" height="${overlayHeight}" viewBox="0 0 ${overlayWidth} ${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${overlayWidth}" height="${overlayHeight}" fill="#ffffff" />
  ${rects.join("\n  ")}
</svg>`);
};

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

    const numberOverlay = createBadgeNumberOverlay(badgeNumber);

    const badgeImage = await sharp(templateBuffer)
      .composite([
        {
          input: centeredGeneratedImage,
          left: Math.round((templateMetadata.width - generatedImageSize) / 2),
          top: Math.round((templateMetadata.height - generatedImageSize) / 2),
        },
        { input: logoBuffer, left: 403, top: 236 },
        { input: numberOverlay, left: 205, top: 925 },
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
