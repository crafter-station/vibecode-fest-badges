import { createHmac, timingSafeEqual } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { env } from "@/env";
import { logError, logInfo, logWarn } from "@/lib/logger";

const defaultKapsoBaseUrl = "https://api.kapso.ai";

const kapsoBaseUrl = () =>
  (env.KAPSO_API_BASE_URL ?? defaultKapsoBaseUrl).replace(/\/$/, "");

const kapsoApiKey = () => env.KAPSO_API_KEY;

const parseKapsoResponse = async (response: Response) => {
  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return { raw: responseText };
  }
};

export const verifyKapsoSignature = ({
  body,
  signature,
  secret,
}: {
  body: string;
  signature: string | null;
  secret: string | undefined;
}) => {
  if (!secret) {
    return true;
  }
  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
};

export const generateFailureReply = async () => {
  try {
    logInfo("whatsapp.reply.generate.start", { kind: "failed" });
    const result = await generateText({
      model: openai("gpt-5.5"),
      maxRetries: 0,
      timeout: 1500,
      system:
        "You write short Spanish WhatsApp bot replies for accepted VibeCode Fest participants. Be warm, direct, celebratory, and under 320 characters.",
      prompt:
        "Say you could not generate the VibeCode Fest badge from that image and ask them to contact the VibeCode Fest team for help.",
    });

    const text = result.text.trim();
    logInfo("whatsapp.reply.generate.complete", {
      kind: "failed",
      empty: text.length === 0,
    });

    if (!text) {
      throw new Error("Generated WhatsApp reply was empty");
    }

    return text;
  } catch (error) {
    logWarn("whatsapp.reply.generate.failed", {
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const sendWhatsAppText = async ({
  phoneNumberId,
  to,
  body,
}: {
  phoneNumberId: string;
  to: string;
  body: string;
}) => {
  logInfo("whatsapp.text.send.start", {
    phoneNumberId,
    to,
    bodyLength: body.length,
  });

  const response = await fetch(
    `${kapsoBaseUrl()}/meta/whatsapp/v24.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": kapsoApiKey(),
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body, preview_url: true },
      }),
    },
  );

  const responseBody = await parseKapsoResponse(response);

  if (!response.ok) {
    logError("whatsapp.text.send.failed", {
      phoneNumberId,
      to,
      status: response.status,
      responseBody,
    });
    throw new Error(`Failed to send WhatsApp text: ${response.status}`);
  }

  logInfo("whatsapp.text.send.complete", { phoneNumberId, to });
  return responseBody;
};

export const sendWhatsAppImage = async ({
  phoneNumberId,
  to,
  imageUrl,
  caption,
}: {
  phoneNumberId: string;
  to: string;
  imageUrl: string;
  caption?: string;
}) => {
  logInfo("whatsapp.image.send.start", {
    phoneNumberId,
    to,
    imageUrl,
    captionLength: caption?.length ?? 0,
  });

  const response = await fetch(
    `${kapsoBaseUrl()}/meta/whatsapp/v24.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": kapsoApiKey(),
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: imageUrl, caption },
      }),
    },
  );

  const responseBody = await parseKapsoResponse(response);

  if (!response.ok) {
    logError("whatsapp.image.send.failed", {
      phoneNumberId,
      to,
      imageUrl,
      status: response.status,
      responseBody,
    });
    throw new Error(`Failed to send WhatsApp image: ${response.status}`);
  }

  logInfo("whatsapp.image.send.complete", { phoneNumberId, to, imageUrl });
  return responseBody;
};

export const downloadKapsoMedia = async ({
  phoneNumberId,
  mediaId,
  mediaUrl,
}: {
  phoneNumberId: string;
  mediaId?: string;
  mediaUrl?: string;
}) => {
  let downloadUrl = mediaUrl;

  if (!downloadUrl && mediaId) {
    const metadataResponse = await fetch(
      `${kapsoBaseUrl()}/meta/whatsapp/v24.0/${mediaId}?phone_number_id=${phoneNumberId}`,
      { headers: { "X-API-Key": kapsoApiKey() } },
    );
    if (!metadataResponse.ok) {
      throw new Error(
        `Failed to get WhatsApp media URL: ${metadataResponse.status}`,
      );
    }

    const metadata = (await metadataResponse.json()) as { url?: string };
    downloadUrl = metadata.url;
  }

  if (!downloadUrl) {
    throw new Error("Inbound image did not include a media URL or media ID");
  }

  const mediaResponse = await fetch(downloadUrl, {
    headers: { "X-API-Key": kapsoApiKey() },
  });
  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download WhatsApp media: ${mediaResponse.status}`,
    );
  }

  return {
    buffer: Buffer.from(await mediaResponse.arrayBuffer()),
    contentType: mediaResponse.headers.get("content-type") ?? "image/jpeg",
  };
};
