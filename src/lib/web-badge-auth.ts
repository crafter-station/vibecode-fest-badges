import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { webOtpCodes, webParticipants, webSessions } from "@/db/schema";
import { env } from "@/env";

export const WEB_SESSION_COOKIE = "vcf_web_session";
export const WEB_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const OTP_EXPIRES_IN_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

type LumaGuest = {
  id?: string;
  api_id?: string;
  user_email?: string;
  email?: string;
  approval_status?: string;
  guest?: LumaGuest;
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const hmac = (value: string) =>
  createHmac("sha256", env.TRIGGER_SECRET_KEY).update(value).digest("hex");

const safeEqual = (a: string, b: string) => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
};

const sixDigitOtp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

const lumaGuestEmail = (guest: LumaGuest) =>
  normalizeEmail(
    guest.user_email ?? guest.email ?? guest.guest?.user_email ?? "",
  );

const lumaGuestApprovalStatus = (guest: LumaGuest) =>
  guest.approval_status ?? guest.guest?.approval_status;

const lumaGuestId = (guest: LumaGuest) =>
  guest.api_id ?? guest.id ?? guest.guest?.api_id ?? guest.guest?.id;

const lumaGuestsFromResponse = (payload: unknown): LumaGuest[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const data = payload as {
    entries?: unknown[];
    guests?: unknown[];
    data?: unknown[];
  };
  const entries = data.entries ?? data.guests ?? data.data ?? [];

  return entries.filter(
    (entry): entry is LumaGuest =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
};

const getApprovedLumaGuest = async (email: string) => {
  const url = new URL("https://public-api.lu.ma/public/v1/event/get-guests");
  url.searchParams.set("event_api_id", env.LUMA_EVENT_ID);
  url.searchParams.set("email", email);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-luma-api-key": env.LUMA_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Luma guest lookup failed with ${response.status}`);
  }

  const guests = lumaGuestsFromResponse(await response.json());

  return guests.find(
    (guest) =>
      lumaGuestEmail(guest) === email &&
      lumaGuestApprovalStatus(guest) === "approved",
  );
};

const sendOtpEmail = async ({
  email,
  code,
}: {
  email: string;
  code: string;
}) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Anthony de Crafter <hello@cueva.io>",
      to: [email],
      subject: "Your Vibe Code Fest Badge code",
      text: `Your Vibe Code Fest Badge code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your Vibe Code Fest Badge code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend OTP delivery failed with ${response.status}`);
  }
};

export const requestWebOtp = async (rawEmail: string) => {
  const email = normalizeEmail(rawEmail);

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false as const, error: "Enter a valid email address." };
  }

  const guest = await getApprovedLumaGuest(email);

  if (!guest) {
    return {
      ok: false as const,
      error: "That email is not approved for this Luma event.",
    };
  }

  const now = new Date();
  const [participant] = await db
    .insert(webParticipants)
    .values({
      email,
      lumaGuestId: lumaGuestId(guest),
      lumaApprovalStatus: "approved",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: webParticipants.email,
      set: {
        lumaGuestId: lumaGuestId(guest),
        lumaApprovalStatus: "approved",
        updatedAt: now,
      },
    })
    .returning();

  if (!participant) {
    throw new Error("Failed to create web participant");
  }

  const code = sixDigitOtp();

  await db.insert(webOtpCodes).values({
    webParticipantId: participant.id,
    codeHash: hmac(`${email}:${code}`),
    expiresAt: new Date(now.getTime() + OTP_EXPIRES_IN_MS),
  });
  await sendOtpEmail({ email, code });

  return { ok: true as const, email };
};

const createSessionValue = (sessionId: number, token: string) => {
  const unsigned = `${sessionId}.${token}`;

  return `${unsigned}.${hmac(unsigned)}`;
};

export const verifyWebOtp = async ({
  rawEmail,
  code,
}: {
  rawEmail: string;
  code: string;
}) => {
  const email = normalizeEmail(rawEmail);
  const normalizedCode = code.trim();

  const [participant] = await db
    .select()
    .from(webParticipants)
    .where(eq(webParticipants.email, email))
    .limit(1);

  if (!participant) {
    return { ok: false as const, error: "Request a new code first." };
  }

  const [otp] = await db
    .select()
    .from(webOtpCodes)
    .where(
      and(
        eq(webOtpCodes.webParticipantId, participant.id),
        isNull(webOtpCodes.consumedAt),
        gt(webOtpCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(webOtpCodes.createdAt))
    .limit(1);

  if (!otp) {
    return {
      ok: false as const,
      error: "That code is expired. Request a new one.",
    };
  }

  if (otp.attemptCount >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false as const,
      error: "Too many attempts. Request a new code.",
    };
  }

  if (!safeEqual(otp.codeHash, hmac(`${email}:${normalizedCode}`))) {
    await db
      .update(webOtpCodes)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(webOtpCodes.id, otp.id));

    return { ok: false as const, error: "That code is incorrect." };
  }

  await db
    .update(webOtpCodes)
    .set({ consumedAt: new Date() })
    .where(eq(webOtpCodes.id, otp.id));

  const token = randomUUID();
  const [session] = await db
    .insert(webSessions)
    .values({
      webParticipantId: participant.id,
      tokenHash: hmac(token),
      expiresAt: new Date(Date.now() + WEB_SESSION_MAX_AGE_SECONDS * 1000),
    })
    .returning();

  if (!session) {
    throw new Error("Failed to create web session");
  }

  return {
    ok: true as const,
    cookieValue: createSessionValue(session.id, token),
    participant,
  };
};

export const getWebSession = async (cookieValue: string | undefined) => {
  if (!cookieValue) {
    return undefined;
  }

  const [sessionIdValue, token, signature] = cookieValue.split(".");
  const sessionId = Number(sessionIdValue);
  const unsigned = `${sessionIdValue}.${token}`;

  if (
    !Number.isInteger(sessionId) ||
    !token ||
    !signature ||
    !safeEqual(signature, hmac(unsigned))
  ) {
    return undefined;
  }

  const [session] = await db
    .select({
      session: webSessions,
      participant: webParticipants,
    })
    .from(webSessions)
    .innerJoin(
      webParticipants,
      eq(webSessions.webParticipantId, webParticipants.id),
    )
    .where(
      and(eq(webSessions.id, sessionId), gt(webSessions.expiresAt, new Date())),
    )
    .limit(1);

  if (!session || !safeEqual(session.session.tokenHash, hmac(token))) {
    return undefined;
  }

  return session;
};
