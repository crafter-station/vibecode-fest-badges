import { put } from "@vercel/blob";

export const standaloneGeneratedImageSize = 1024;
export const generatedImageSize = 730;

export type GeneratedMedia = {
  mediaType: string;
  uint8Array: Uint8Array;
};

export const collectErrorText = (error: unknown, depth = 0): string => {
  if (depth > 4 || error === null || error === undefined) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const errorWithDetails = error as Error & {
      cause?: unknown;
      data?: unknown;
      errors?: unknown[];
      lastError?: unknown;
      responseBody?: unknown;
      statusCode?: unknown;
      url?: unknown;
    };

    return [
      error.name,
      error.message,
      error.stack,
      collectErrorText(errorWithDetails.cause, depth + 1),
      collectErrorText(errorWithDetails.data, depth + 1),
      collectErrorText(errorWithDetails.errors, depth + 1),
      collectErrorText(errorWithDetails.lastError, depth + 1),
      collectErrorText(errorWithDetails.responseBody, depth + 1),
      collectErrorText(errorWithDetails.statusCode, depth + 1),
      collectErrorText(errorWithDetails.url, depth + 1),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (Array.isArray(error)) {
    return error.map((item) => collectErrorText(item, depth + 1)).join("\n");
  }

  if (typeof error === "object") {
    return Object.values(error)
      .map((value) => collectErrorText(value, depth + 1))
      .join("\n");
  }

  return String(error);
};

export const isOpenAIResponsesSocketCloseError = (error: unknown) => {
  const errorText = collectErrorText(error).toLowerCase();

  return (
    (errorText.includes("other side closed") &&
      errorText.includes("api.openai.com/v1/responses")) ||
    (errorText.includes('"type": "image_generation_call"') &&
      errorText.includes('"status": "failed"')) ||
    (errorText.includes("image_generation_call") &&
      errorText.includes("status") &&
      errorText.includes("failed") &&
      errorText.includes("couldn") &&
      errorText.includes("generate the requested image"))
  );
};

type UploadImageToBlobOptions = {
  buffer: Buffer;
  contentType?: string;
  pathname: string;
};

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const mediaFromStaticToolResults = (
  toolResults: unknown,
): GeneratedMedia | undefined => {
  const imageGenerationResult = (Array.isArray(toolResults) ? toolResults : [])
    .map(getObject)
    .find((toolResult) => toolResult?.toolName === "image_generation");

  const output = getObject(imageGenerationResult?.output);
  const result = getString(output?.result);
  if (!result) {
    return undefined;
  }

  const outputFormat = getString(output?.output_format) ?? "png";

  return {
    mediaType: `image/${outputFormat}`,
    uint8Array: Buffer.from(result, "base64"),
  };
};

const mediaFromDataUrl = (url: string): GeneratedMedia | undefined => {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match) {
    return undefined;
  }

  return {
    mediaType: match[1] ?? "application/octet-stream",
    uint8Array: Buffer.from(match[2] ?? "", "base64"),
  };
};

export const loadMediaFromUrl = async (
  url: string,
): Promise<GeneratedMedia> => {
  if (!url) {
    throw new Error("Missing image URL");
  }

  const dataUrlMedia = mediaFromDataUrl(url);
  if (dataUrlMedia) {
    return dataUrlMedia;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image URL ${url}: ${response.status}`);
  }

  const mediaType = response.headers.get("content-type") ?? "image/jpeg";
  const uint8Array = new Uint8Array(await response.arrayBuffer());

  return { mediaType, uint8Array };
};

export const assertImageMedia = (media: GeneratedMedia, label: string) => {
  if (!media.mediaType.startsWith("image/")) {
    throw new Error(
      `Expected ${label} to be an image, got ${media.mediaType}. Check the URL in src/lib/contants.ts`,
    );
  }
};

export const uploadImageToBlob = async ({
  buffer,
  contentType = "image/png",
  pathname,
}: UploadImageToBlobOptions): Promise<string> => {
  const blob = await put(pathname, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });

  return blob.url;
};

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
