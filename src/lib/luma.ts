import { z } from "zod";
import { env } from "@/env";

const lumaGuestSchema = z.object({
  id: z.string(),
  user_email: z.email(),
  user_name: z.string().nullable(),
  user_first_name: z.string().nullable(),
  user_last_name: z.string().nullable(),
  approval_status: z.string(),
});

const lumaGuestListSchema = z.object({
  entries: z.array(lumaGuestSchema),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
});

export type ApprovedLumaGuest = {
  id: string;
  email: string;
  displayName: string | null;
};

export const normalizeParticipantEmail = (email: string) =>
  email.trim().toLowerCase();

export const lookupApprovedLumaGuest = async (
  email: string,
): Promise<ApprovedLumaGuest | null> => {
  const normalizedEmail = normalizeParticipantEmail(email);
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://public-api.luma.com/v1/events/guests/list");
    url.searchParams.set("event_id", env.LUMA_EVENT_ID);
    url.searchParams.set("approval_status", "approved");
    url.searchParams.set("pagination_limit", "200");
    if (cursor) {
      url.searchParams.set("pagination_cursor", cursor);
    }

    const response = await fetch(url, {
      headers: { "x-luma-api-key": env.LUMA_API_KEY },
    });

    if (!response.ok) {
      throw new Error(`Luma guest lookup failed: ${response.status}`);
    }

    const data = lumaGuestListSchema.parse(await response.json());
    const guest = data.entries.find(
      (entry) =>
        normalizeParticipantEmail(entry.user_email) === normalizedEmail,
    );

    if (guest?.approval_status === "approved") {
      const name =
        guest.user_name ??
        [guest.user_first_name, guest.user_last_name].filter(Boolean).join(" ");

      return {
        id: guest.id,
        email: normalizedEmail,
        displayName: name || null,
      };
    }

    if (!data.has_more || !data.next_cursor) {
      return null;
    }

    cursor = data.next_cursor;
  }

  return null;
};
