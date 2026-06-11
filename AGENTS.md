<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo uses Next.js `16.2.9`; APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before changing Next-specific code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

- Use Bun as the package manager; `bun.lock` is the lockfile.
- Dev server: `bun run dev`.
- Production build: `bun run build`.
- Lint/format check: `bun run lint` (`biome check`).
- Format writes: `bun run format`.
- Typecheck when needed: `bunx tsc --noEmit`; there is no `typecheck` script.
- Database schema push: `bun run db:push` uses `drizzle.config.ts` and requires `DATABASE_URL`.
- Local badge generation: `bun run generate:badge <number>` or `bun run generate:profile-animation <number>`. Add `--from-image=<path>` to skip OpenAI image generation and use an existing image.
- There is no test script or configured test runner in this repo.

## Environment

- Server env is validated in `src/env.ts`; code importing it needs `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, and `OPENAI_API_KEY`.
- `KAPSO_API_BASE_URL` is optional; `src/lib/whatsapp.ts` defaults to `https://api.kapso.ai`.
- Do not read or print `.env`; it exists locally and may contain real secrets.

## Architecture

- App Router lives under `src/app`; the active integration entrypoint is `src/app/api/kapso/webhook/route.ts` and explicitly runs on Node via `export const runtime = "nodejs"`.
- The webhook verifies `x-webhook-signature`, ignores non-`whatsapp.message.received` events, normalizes payload envelopes, deduplicates by `kapsoMessageId`, stores inbound media in Vercel Blob, then triggers Trigger.dev task `process-whatsapp-badge`.
- Trigger.dev tasks are discovered from `src/trigger` by `trigger.config.ts`; `sharp` is externalized there because badge rendering depends on it.
- Badge generation flow is `process-whatsapp-badge` -> `generate-profile-badge` -> `generate-pixel-art-image` -> `generate-badge`.
- Drizzle schema is in `src/db/schema.ts`; badge numbers currently mirror the conversation id in `ensureBadgeNumber`.
- Shared imports use the `@/*` alias to `src/*`.

## Repo Quirks

- `src/lib/contants.ts` is misspelled and imported that way; rename only if updating all imports.
- Biome is the formatter/linter, uses 2-space indentation, and ignores `.next`, `dist`, and `build`.
- Tailwind uses the v4 PostCSS plugin in `postcss.config.mjs`; there is no Tailwind config file.
- The README is the default create-next-app text and incorrectly points at `app/page.tsx`; this repo uses `src/app/page.tsx`.
