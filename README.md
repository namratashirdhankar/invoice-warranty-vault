# Invoice & Warranty Vault

Mobile-first purchase, invoice and warranty manager for Android and iOS.

## Stack
- Expo / React Native / TypeScript mobile app
- NestJS / TypeScript REST API
- PostgreSQL / Prisma
- Local development uploads (replace with private S3-compatible object storage in production)
- Pluggable AI extraction (manual review is mandatory)

## Features
- Save original invoice files and associated purchase metadata
- One invoice can contain many purchased items
- Track warranty start and end dates, including unknown coverage
- Record verified customer-care phone numbers and support URLs
- Mobile dashboard, product list and document upload
- Extraction API scaffold; no AI provider credentials are included

## Quick start
1. Install Node.js 20+ and Docker.
2. Run `docker compose up -d`.
3. Run `npm install`.
4. Copy `apps/api/.env.example` to `apps/api/.env`.
5. Run `npm run db:generate` and `npm run db:push`.
6. Run `npm run dev:api` (API on port 3000).
7. Run `npm run dev:mobile` and open Expo Go.
8. On a physical phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN IP, not localhost.

## API
- `GET /health`
- `GET /invoices`
- `POST /invoices/upload` (multipart file, optional metadata)
- `GET /products`
- `GET /warranties/expiring?days=30`

## Security and production readiness
This is an MVP scaffold, **not production ready**. Before uploading personal invoices to a hosted service, add authenticated per-user access, object-storage encryption, file malware scanning, rate limits, data deletion/export, audit logs and signed download URLs. Do not expose the API publicly without authorization. AI-generated extraction and support numbers must be verified before saving.
