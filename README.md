# Invoice & Warranty Vault

A React Native (Expo) Android/iOS app backed by NestJS, PostgreSQL and Prisma.

## Implemented (development MVP)
- Register/login with password hashing and JWT
- Authenticated invoice uploads (PDF/JPEG/PNG, max 10MB)
- Gemini invoice extraction when `GEMINI_API_KEY` is configured
- Manual review and confirmation of invoice and line items
- Product and warranty records; expiring-warranty query
- Customer support contact storage (manual entry API; no unverified automatic lookup)
- Mobile product list, invoice list, upload and extraction review screens
- Authorized API endpoint to retrieve original invoice files

## Setup
1. Install Node 20+ and Docker.
2. `docker compose up -d`
3. `npm install`
4. Copy `apps/api/.env.example` to `apps/api/.env`.
5. Set a strong unique `JWT_SECRET`; optionally set `GEMINI_API_KEY`.
6. `npm run db:generate && npm run db:push`
7. `npm run dev:api`
8. In a separate terminal: `npm run dev:mobile`
9. For a physical phone, set `EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3000` before starting Expo.

## API
`POST /auth/register`, `POST /auth/login` return JWTs.
Pass `Authorization: Bearer <token>` to all other endpoints except `/health`.
- `POST /invoices/upload`: multipart form with `file`.
- `POST /invoices/:id/extract`: AI-generated preview; requires configured Gemini key.
- `POST /invoices/:id/confirm`: reviewed JSON fields and nonempty `items`.
- `GET /invoices`, `GET /invoices/:id/file`
- `GET /products`, `POST /products/:id/support`
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
- Automatic verified manufacturer support lookup is **not** implemented. Store support details manually with official source URLs and independently verify them before displaying as verified.
- S3 storage, signed downloads, and encryption-at-rest integration are **not** implemented; invoice files are stored on the API server's disk.
- Reminder delivery is best-effort; a successful Expo ticket is not proof the device received the message. Add receipt processing, retry/backoff, and proper job locking for production.
- The mobile app does not yet persist sign-in across restarts or expose a native PDF viewer.
- The source has not been built or run on physical devices in this environment. Validate dependencies, run Prisma migrations, and execute end-to-end tests before real use.
