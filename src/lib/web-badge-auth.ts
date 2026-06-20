import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { Resend } from "resend";
import { db } from "@/db";
import { otpChallenges, webParticipants, webSessions } from "@/db/schema";
import { env } from "@/env";
import { lookupApprovedLumaGuest, normalizeParticipantEmail } from "@/lib/luma";

export const webSessionCookieName = "vcf_web_session";

const otpTtlMs = 10 * 60 * 1000;
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxOtpAttempts = 5;
const otpSendCooldownMs = 60 * 1000;
const resend = new Resend(env.RESEND_API_KEY);

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const hashOtpCode = (code: string, salt: string) => sha256(`${salt}:${code}`);

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
};

const createOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const hashSessionToken = (token: string) =>
  sha256(`web-session:${token}`);

export const requestOtpForApprovedParticipant = async (email: string) => {
  const normalizedEmail = normalizeParticipantEmail(email);
  const approvedGuest = await lookupApprovedLumaGuest(normalizedEmail);

  if (!approvedGuest) {
    return { ok: false as const };
  }

  const now = new Date();
  const [participant] = await db
    .insert(webParticipants)
    .values({
      email: normalizedEmail,
      lumaGuestId: approvedGuest.id,
      displayName: approvedGuest.displayName,
      approvalStatus: "approved",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: webParticipants.email,
      set: {
        lumaGuestId: approvedGuest.id,
        displayName: approvedGuest.displayName,
        approvalStatus: "approved",
        updatedAt: now,
      },
    })
    .returning();

  const [latestChallenge] = await db
    .select({ sentAt: otpChallenges.sentAt })
    .from(otpChallenges)
    .where(eq(otpChallenges.email, normalizedEmail))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (
    latestChallenge &&
    now.getTime() - latestChallenge.sentAt.getTime() < otpSendCooldownMs
  ) {
    return { ok: true as const, email: normalizedEmail };
  }

  const code = createOtpCode();
  const salt = randomBytes(16).toString("hex");
  await db.insert(otpChallenges).values({
    webParticipantId: participant.id,
    email: normalizedEmail,
    codeHash: `${salt}:${hashOtpCode(code, salt)}`,
    expiresAt: new Date(now.getTime() + otpTtlMs),
  });

  await resend.emails.send({
    from: "Anthony de Crafter <hello@cueva.io>",
    to: normalizedEmail,
    subject: "Your Vibe Code Fest badge code",
    text: `Your Vibe Code Fest verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Vibe Code Fest verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes.</p>`,
  });

  return { ok: true as const, email: normalizedEmail };
};

export const verifyOtpAndCreateSession = async ({
  email,
  code,
}: {
  email: string;
  code: string;
}) => {
  const normalizedEmail = normalizeParticipantEmail(email);
  const now = new Date();
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.email, normalizedEmail))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (
    !challenge ||
    challenge.verifiedAt ||
    challenge.expiresAt <= now ||
    challenge.attemptCount >= maxOtpAttempts
  ) {
    return { ok: false as const, reason: "invalid" };
  }

  const [salt, storedHash] = challenge.codeHash.split(":");
  const codeMatches = Boolean(
    salt && storedHash && safeEqual(hashOtpCode(code, salt), storedHash),
  );

  if (!codeMatches) {
    await db
      .update(otpChallenges)
      .set({ attemptCount: challenge.attemptCount + 1 })
      .where(eq(otpChallenges.id, challenge.id));

    return { ok: false as const, reason: "invalid" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  await Promise.all([
    db
      .update(otpChallenges)
      .set({ verifiedAt: now })
      .where(eq(otpChallenges.id, challenge.id)),
    db.insert(webSessions).values({
      webParticipantId: challenge.webParticipantId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    }),
  ]);

  return { ok: true as const, token, expiresAt };
};

export const setWebSessionCookie = async (token: string, expiresAt: Date) => {
  const cookieStore = await cookies();
  cookieStore.set(webSessionCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
};

export const getWebSessionByToken = async (token: string) => {
  const [session] = await db
    .select({
      id: webSessions.id,
      webParticipantId: webSessions.webParticipantId,
      expiresAt: webSessions.expiresAt,
      participantEmail: webParticipants.email,
      participantDisplayName: webParticipants.displayName,
    })
    .from(webSessions)
    .innerJoin(
      webParticipants,
      eq(webSessions.webParticipantId, webParticipants.id),
    )
    .where(
      and(
        eq(webSessions.tokenHash, hashSessionToken(token)),
        isNull(webSessions.revokedAt),
      ),
    )
    .limit(1);

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  return session;
};

export const getWebSession = async () => {
  const token = (await cookies()).get(webSessionCookieName)?.value;
  if (!token) {
    return null;
  }

  return getWebSessionByToken(token);
};

export const getLatestOtpEmail = async () => {
  const [challenge] = await db
    .select({ email: otpChallenges.email, expiresAt: otpChallenges.expiresAt })
    .from(otpChallenges)
    .where(gt(otpChallenges.expiresAt, new Date()))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  return challenge ?? null;
};
