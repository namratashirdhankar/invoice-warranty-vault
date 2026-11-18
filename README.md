# Invoice & Warranty Vault

A React Native (Expo) Android/iOS app backed by NestJS, PostgreSQL and Prisma.

## Implemented (development MVP)
- Register/login with password hashing and JWT
- Authenticated invoice uploads (PDF/JPEG/PNG, max 10MB)
- Gemini invoice extraction when `API_KEY` is configured; the AI provider adapter can be extended for other providers (OpenAI is not yet implemented)
- Manual review and confirmation of invoice and line items
- Product and warranty records; expiring-warranty query
- Customer-care contact details entered manually per product; contacts are not auto-verified
- Single AI warranty chat for product/issue descriptions and up to five photos; it searches official manufacturer warranty/support information, asks follow-up questions, cites sources, and helps draft a claim without submitting it
- Local warranty-expiry alerts plus chat follow-up reminders; say “remind me to follow up in 3 days” or “remind me to call support on YYYY-MM-DD at HH:MM”, then confirm before scheduling
- Mobile product list, invoice list, upload and extraction review screens
- Authorized API endpoint to retrieve original invoice files

## Setup
1. Install Node 20+ and Docker.
2. `docker compose up -d`
3. `npm install`
4. Copy `apps/api/.env.example` to `apps/api/.env`.
5. Set a strong unique `JWT_SECRET`; optionally set `AI_PROVIDER=gemini` and `API_KEY` to your Gemini API key; `AI_MODEL` optionally overrides the default model.
6. `npm run db:generate && npm run db:push`
7. `npm run dev:api`
8. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `API_URL` to the API server's address and port. For a physical phone, use an address reachable from the phone (not `localhost`); both devices should be on the same network.
9. To enable Google login, create OAuth Web, Android, and iOS client IDs in Google Cloud Console. Use Android package `com.invoicevault.mobile` and iOS bundle ID `com.invoicevault.mobile`; set the three `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` values in `apps/mobile/.env` and put all allowed IDs, comma-separated, in API `GOOGLE_CLIENT_IDS`. Set up the OAuth consent screen and test-user access if the app is in Testing mode. Never put a client secret in the mobile app.
10. In a separate terminal, run `npm run dev:mobile`. Restart Expo and reload the app after changing config. The API URL is embedded in the app and must not contain secrets. Use HTTPS outside local development. Google OAuth uses the `invoicevault` app scheme and needs a development build with matching Android SHA-1/iOS bundle settings; Expo Go cannot use this app's native Google client IDs.

## API
`POST /auth/register`, `POST /auth/login`, and `POST /auth/google` return JWTs. Google sign-in requires a verified Google ID token whose audience is listed in `GOOGLE_CLIENT_IDS`.
Pass `Authorization: Bearer <token>` to all other endpoints except `/health`.
- `POST /invoices/upload`: multipart form with `file`.
- `POST /invoices/:id/extract`: AI-generated preview; requires configured Gemini key.
- `POST /invoices/:id/confirm`: reviewed JSON fields and nonempty `items`.
- `GET /invoices`, `GET /invoices/:id/file`
- `GET /products`, `POST /products/:id/support`
- `POST /assistant/chat`: authenticated multipart chat with `message`, optional `productId`, `history`, and up to five JPEG/PNG/WebP photos (4 MiB each); uses Gemini Google Search grounding and the user's saved product/purchase data
- `GET /warranties/expiring?days=30`

## Not yet production-ready
The code has been committed but not compiled or device-tested in this session. The MVP stores files on local disk, not durable private S3. It does not yet include scheduled push notifications, automatic verified customer-care discovery, AI chat, secure on-device token persistence, or a file-download viewer in the mobile app.

Before hosting or using real personal invoices, add durable encrypted object storage, malware scanning, MIME-content verification, server-side request limits, robust validation, token refresh/revocation, per-user data export/deletion, rate limiting, monitoring, HTTPS and automated tests. Restrict CORS and avoid placing credentials in Git.

## New experimental features
- `POST /assistant/ask` accepts `{"question":"Which products are under warranty?"}` and uses confirmed purchase records as grounding. Gemini API key required for natural-language answers.
- `POST /notifications/token` registers an Expo device push token. `DELETE /notifications/token` unregisters it.
- `ENABLE_REMINDERS=true` enables an hourly backend scan for expiry at 30, 15, 7 and 1 days. Only run one scheduler instance; for multiple replicas, use a dedicated worker/queue and distributed locking.
- Configure an EAS project ID in Expo config and build a development/production app on a physical device for remote push notifications. Expo Go is not sufficient for production testing.
- The mobile app includes an AI assistant tab and an opt-in notification registration button.

## Known limitations and required follow-up
- Automatic verified manufacturer support lookup and manufacturer-specific web-form autofill are **not** implemented. Enter customer-care details manually with official source URLs and verify them independently. Claim drafts must be reviewed and sent by the user.
- S3 storage, signed downloads, and encryption-at-rest integration are **not** implemented; invoice files are stored on the API server's disk.
- Reminder delivery is best-effort; a successful Expo ticket is not proof the device received the message. Add receipt processing, retry/backoff, and proper job locking for production.
- The mobile app does not yet persist sign-in across restarts or expose a native PDF viewer.
- The source has not been built or run on physical devices in this environment. Validate dependencies, run Prisma migrations, and execute end-to-end tests before real use.

## Secure storage and mobile sign-in (new)
- When `S3_BUCKET` is configured, invoice uploads are stored in private S3 objects under a user-specific prefix with SSE-S3 encryption. Use an IAM role scoped to the configured bucket; never ship AWS credentials in the mobile app. Without `S3_BUCKET`, local files remain a **development-only** fallback.
- `GET /invoices/:id/download-link` returns a 60-second presigned S3 download URL after authenticating and checking invoice ownership. The mobile invoice viewer uses this endpoint; it requires S3 configuration. Signed URLs can be forwarded, so treat them as secrets.
- `GET /invoices/:id/file` remains an authenticated download endpoint (redirects to S3 when configured).
- Mobile login tokens are persisted using Expo SecureStore; signing out clears the local token. Server-side token revocation and refresh remain pending.
- GitHub Actions now runs Prisma client generation, API build, and mobile TypeScript checks. Check the workflow result in GitHub; no successful run is claimed here.
- For Expo push, add the `expo-notifications` and `expo-secure-store` native plugins and configure EAS credentials before testing on a physical device.

## Release blockers
Do not launch publicly until the CI checks pass and you have tested: uploads, authenticated downloads, data isolation, duplicate confirmations, notification delivery, device registration, account deletion, storage lifecycle, and recovery. Also add antivirus scanning, file signature verification, rate limiting, a proper password reset flow, and privacy policy. Gmail import, official customer-care lookup, subscriptions, iOS release and store submission are still pending.
