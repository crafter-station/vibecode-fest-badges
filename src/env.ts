import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    KAPSO_API_BASE_URL: z.url().optional(),
    KAPSO_API_KEY: z.string().min(1),
    KAPSO_WEBHOOK_SECRET: z.string().min(1),
    LUMA_API_KEY: z.string().min(1),
    LUMA_EVENT_ID: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    TRIGGER_SECRET_KEY: z.string().min(1),
  },
  client: {},
  runtimeEnv: {
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    KAPSO_API_BASE_URL: process.env.KAPSO_API_BASE_URL,
    KAPSO_API_KEY: process.env.KAPSO_API_KEY,
    KAPSO_WEBHOOK_SECRET: process.env.KAPSO_WEBHOOK_SECRET,
    LUMA_API_KEY: process.env.LUMA_API_KEY,
    LUMA_EVENT_ID: process.env.LUMA_EVENT_ID,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
  },
  emptyStringAsUndefined: true,
});
