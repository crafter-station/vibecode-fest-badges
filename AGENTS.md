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
- Database schema push: `bun run db:push` uses `drizzle.config.ts`, targets `src/db/schema.ts`, and requires `DATABASE_URL`; there are no checked-in migration files.
- `bun run db:push:prod` loads `.env.prod`; do not print env files or secrets.
- `generate:badge`, `generate:profile-animation`, and `generate:badges-video` point at missing files under `scripts/`; do not rely on them until those scripts exist.
- `bun run hello:gpt` is only a smoke script for `OPENAI_API_KEY` and `gpt-5.5`.
- There is no test script or configured test runner in this repo.

## Environment

- Server env is validated in `src/env.ts`; code importing it needs `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `OPENAI_API_KEY`, and `TRIGGER_SECRET_KEY`.
- `KAPSO_API_BASE_URL` is optional; `src/lib/whatsapp.ts` defaults to `https://api.kapso.ai`.
- Do not read or print `.env`; it exists locally and may contain real secrets.

## Architecture

- App Router lives under `src/app`; the active integration entrypoint is `src/app/api/kapso/webhook/route.ts`, which explicitly runs on Node via `export const runtime = "nodejs"`.
- The Kapso webhook verifies `x-webhook-signature`, ignores non-`whatsapp.message.received` events, normalizes payload envelopes, deduplicates by `kapsoMessageId`, stores inbound media in Vercel Blob, and uses an AI SDK `generateText` tool call to trigger `process-whatsapp-badge`.
- Trigger.dev tasks are discovered from `src/trigger` by `trigger.config.ts`; `sharp` is externalized there because badge rendering depends on it.
- Badge generation flow is `process-whatsapp-badge` -> `generate-profile-badge` -> `generate-pixel-art-image` -> `generate-badge`.
- Drizzle schema is in `src/db/schema.ts`; `ensureBadgeNumber` assigns the lowest available positive integer and retries on unique-index conflicts.
- `/badges`, `/badges/[page]`, and `/badges/print?ids=...` read generated badge rows from `whatsapp_conversations` where `badge_generated`, `badge_image_url`, and `badge_number` are present.
- Shared imports use the `@/*` alias to `src/*`.

## Repo Quirks

- `src/lib/contants.ts` is misspelled and imported that way; rename only if updating all imports.
- Biome is the formatter/linter, uses 2-space indentation, organizes imports, and ignores `.next`, `dist`, and `build`.
- Tailwind uses v4 via `@tailwindcss/postcss` and `src/app/globals.css`; there is no Tailwind config file.
- Next 16 route props such as `params` and `searchParams` are promises in this codebase; follow the local pattern before changing routes.
- `README.md`, `src/app/page.tsx`, and root metadata are still create-next-app boilerplate; do not treat them as product documentation.
