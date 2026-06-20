# Web Badge Generator PRD

## Problem Statement

Vibe Code Fest participants can currently create a Badge through the WhatsApp bot by sending a photo and waiting for the generated image to be returned in WhatsApp. The team wants the same Badge creation capability on the web, but it cannot be open to everyone because unrestricted generation would create API key and image generation cost risk.

The web flow must only allow a Web Participant whose email is approved for the Vibe Code Fest event in Luma to create one Badge, then view and download it from the web.

## Solution

Build a private `/create` web flow where a participant enters the email they used for Luma registration. The app validates that email server-side against Luma using the configured event ID and only proceeds when Luma returns `approval_status === "approved"`. The app then sends a one-time password by email using Resend from `Anthony de Crafter <hello@cueva.io>`.

After OTP verification, the Web Participant can upload a photo. The browser resizes and converts the photo to WebP before upload, the server stores the processed image in Blob storage, and a Trigger.dev task reuses the existing Badge generation pipeline. The page shows progress via polling, then displays the final Badge with a download action. Each Web Participant can create at most one web Badge. If the input image is rejected before a Badge is completed, the participant can upload another photo; after completion, regeneration is not allowed.

The existing Badge Wall remains visually unchanged, but its data source becomes canonical so it can include generated Badges from both WhatsApp and web origins.

## User Stories

1. As a Web Participant, I want to enter my Luma registration email, so that the app can confirm I am allowed to create a Badge.
2. As a Web Participant, I want the app to reject emails that are not approved in Luma, so that only accepted event participants can use the generator.
3. As a Web Participant, I want to receive an OTP at my Luma email, so that I can prove I control the approved address.
4. As a Web Participant, I want to enter my OTP in the same web flow, so that I can unlock Badge creation without leaving the page.
5. As a Web Participant, I want a clear error when my OTP is wrong, expired, or already used, so that I know what to do next.
6. As a Web Participant, I want to request a new OTP when needed, so that I can recover from an expired or lost code.
7. As a Web Participant, I want my session to persist for several days, so that I can return to download my Badge again.
8. As a Web Participant, I want to upload a photo from my device, so that the app can generate my Badge.
9. As a Web Participant, I want JPEG, PNG, WebP, and browser-decodable HEIC photos to work, so that common phone camera photos are accepted.
10. As a Web Participant, I want the browser to optimize my photo before upload, so that the upload is faster and less bandwidth is used.
11. As a Web Participant, I want a clear message if my browser cannot decode my HEIC photo, so that I can retry with JPG/PNG/WebP or a compatible browser.
12. As a Web Participant, I want to see that generation has started, so that I know my photo was accepted.
13. As a Web Participant, I want to see generation progress or waiting states, so that I know the app is still working while the Badge is created.
14. As a Web Participant, I want to see my completed Badge in the browser, so that I can verify the result.
15. As a Web Participant, I want to download my completed Badge, so that I can save and share it.
16. As a Web Participant, I want to return later and see my already generated Badge, so that I do not need to generate it again.
17. As a Web Participant, I want to upload a different photo if the first image is rejected before completion, so that I still have a chance to create my one Badge.
18. As a Web Participant, I do not want accidental duplicate clicks to create multiple Badges, so that my one Badge allocation is protected.
19. As an event organizer, I want only Luma-approved participants to generate web Badges, so that API costs and abuse are controlled.
20. As an event organizer, I want each approved email to create at most one web Badge, so that the feature is fair and bounded.
21. As an event organizer, I want web Badges and WhatsApp Badges to share one global Badge numbering system, so that Badge numbers stay unique across origins.
22. As an event organizer, I want existing WhatsApp Badges preserved during the schema cleanup, so that current generated Badges are not lost.
23. As an event organizer, I want the Badge Wall to look the same as it does today, so that the public experience does not change unexpectedly.
24. As an event organizer, I want the Badge Wall to include both WhatsApp and web Badges, so that the gallery represents the full event.
25. As a developer, I want the web flow to reuse the existing Badge generation pipeline, so that generation quality and behavior stay consistent with WhatsApp.
26. As a developer, I want a canonical Badge model, so that origin-specific data does not own global Badge identity.
27. As a developer, I want an idempotent migration/backfill script for existing WhatsApp Badges, so that production data can be safely moved into the canonical model.
28. As a developer, I want OTPs stored safely, so that leaked database rows do not reveal usable login codes.
29. As a developer, I want Luma and Resend API keys to remain server-only, so that browser users cannot access integration credentials.
30. As a developer, I want polling-based generation status, so that long-running Trigger.dev work does not require a long-lived HTTP request.

## Implementation Decisions

- Use `/create` as the private web Badge creation route.
- Keep `/badges` visually unchanged while changing its data source to include all canonical generated Badges.
- Use the Luma event ID and the entered email as the Luma guest lookup inputs.
- Read Luma configuration from `LUMA_API_KEY` and `LUMA_EVENT_ID`.
- Accept only Luma guests whose `approval_status` is exactly `approved`.
- Normalize email addresses by trimming and lowercasing before lookup, storage, OTP creation, and uniqueness checks.
- Create or update the Web Participant record after Luma approval and before sending OTP.
- Use Resend for OTP email delivery.
- Send OTP emails from `Anthony de Crafter <hello@cueva.io>`.
- Use a 6-digit OTP that expires after 10 minutes.
- Store OTP hashes, not plaintext OTP values.
- Limit OTP verification attempts to 5 attempts per code.
- Mark OTPs consumed after successful verification.
- Create a signed `HttpOnly` session cookie after OTP verification.
- Use a 7-day web session duration.
- Allow expired sessions to re-authenticate with another OTP without granting another Badge.
- Use a canonical `badges` table for global Badge identity and Badge numbering.
- Record Badge origin as WhatsApp or web.
- Preserve WhatsApp-specific conversation and message state outside the canonical Badge record.
- Add web-specific participant and generation request tables instead of storing web identity in WhatsApp conversation rows.
- Link WhatsApp conversations and web Badge requests to the canonical Badge record.
- Use the canonical Badge registry to allocate globally unique Badge numbers across WhatsApp and web.
- Follow ADR `0001-global-badge-number-registry` for the Badge number registry decision.
- Add an idempotent backfill script that creates canonical Badge rows from existing WhatsApp conversations with completed Badge data.
- Continue using the existing generated Badge assets in Blob storage during backfill.
- Reuse the existing profile Badge generation pipeline for the web flow.
- Add a web-specific Trigger.dev task that wraps the shared generation task and writes web request status instead of sending WhatsApp messages.
- Use polling every few seconds from the `/create` UI to check web generation status.
- Treat image rejection before completion as recoverable and allow another upload.
- Treat completed Badge generation as final and prevent regeneration.
- Convert uploaded images in the browser to WebP before sending them to the server.
- Resize the browser-processed image so the longest side is around 1600px.
- Export browser-processed images as WebP at about 90% quality.
- Support HEIC pragmatically when the browser can decode it.
- Show a clear unsupported-image message when HEIC cannot be decoded by the browser.
- Server-side upload handling must still validate file type and size before writing to Blob storage.
- Store web inbound images under a web-specific Blob prefix.
- Do not expose Luma, Resend, OpenAI, Trigger.dev, database, or Blob credentials to the browser.

## Testing Decisions

- Tests should focus on external behavior and state transitions rather than internal implementation details.
- Validate the Luma authorization seam by covering approved guests, non-approved guests, missing guests, malformed emails, and Luma API failures.
- Validate the OTP seam by covering code creation, expiry, attempt limits, successful consumption, replay prevention, and session creation.
- Validate Badge allocation by covering concurrent WhatsApp and web allocation attempts and ensuring global number uniqueness.
- Validate web Badge request state transitions from authenticated upload to generating, generated, rejected, and failed states.
- Validate that rejected images before completion allow another upload while completed Badges do not allow regeneration.
- Validate that `/badges` returns the same visual data shape while reading from canonical Badges.
- Validate the backfill script against existing completed WhatsApp conversations and ensure it is safe to re-run.
- Validate client-side image handling manually for JPG, PNG, WebP, and HEIC-capable browsers because this repo does not currently have a browser test runner.
- Use `bun run lint` for lint/format checks.
- Use `bunx tsc --noEmit` for TypeScript verification.
- There is no configured test runner in the repo today, so automated behavior tests require either adding a test runner or using focused scripts/manual verification.

## Out of Scope

- Changing the visual design of the public Badge Wall.
- Adding participant names or Luma profile details to the public Badge Wall.
- Allowing public anonymous Badge generation.
- Allowing a Web Participant to regenerate after a Badge has completed.
- Deduplicating WhatsApp and web identities as the same real-world person.
- Requiring a custom account system beyond OTP email sessions.
- Magic-link authentication.
- Server-side HEIC conversion for browsers that cannot decode HEIC.
- Real-time streaming status over WebSockets or Server-Sent Events.
- Sending the web-generated Badge through WhatsApp.
- Publishing this PRD to an issue tracker.

## Further Notes

- The glossary defines the final image as a `Badge`; avoid using `Batch` for this feature.
- The canonical Web Participant identity is the Luma `user_email`.
- The current repo uses `drizzle-kit push` and has no existing Drizzle migrations folder. The recommended first implementation path is schema update plus an idempotent backfill script.
- The active WhatsApp flow currently stores Badge state on WhatsApp conversations and sends the completed Badge back through WhatsApp. The web flow should not fork image generation quality or prompt behavior; it should only differ in authorization, upload, status, and delivery surface.
