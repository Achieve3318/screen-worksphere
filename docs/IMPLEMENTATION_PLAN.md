# WorkSphere implementation plan

WorkSphere is an enrolled, visible screenshot and time-tracking platform. Monitoring never starts before a person signs in and a device is enrolled, and the desktop app always shows whether capture is running. This is not stealth software.

Docker is intentionally excluded. Local setup uses Node.js, npm, and MongoDB (local `mongod` or Atlas). Integration tests use `mongodb-memory-server`.

## Decisions

- Monorepo: npm workspaces, strict TypeScript, ESLint, Prettier, Vitest.
- Branding lives in `packages/shared/src/brand.ts` plus CSS tokens. The product name is not scattered through feature logic.
- API: Fastify, Zod, Mongoose, Argon2id, rotating refresh tokens, server-side RBAC.
- Database: MongoDB with UUID string document ids. Production uses `DATABASE_URL` (`mongodb://` or `mongodb+srv://`).
- Object storage: `ScreenshotStorage` with a local filesystem driver and an S3-compatible driver selected by environment variables.
- Desktop: Electron with a sandboxed renderer. Capture, encryption, SQLite, and uploads stay in the main process. Screenshots are encrypted with AES-256-GCM before they touch disk. The device key is protected with Electron `safeStorage` (DPAPI, Keychain, or libsecret).
- Images are compressed before encryption. One file is stored per display, grouped by a shared capture event id.
- Uploads are idempotent on the client-generated screenshot id. Bounded concurrency, backoff, and cancellation preserve queue state.

## Milestones

1. Workspace, shared limits, Zod contracts, crypto file format, permission matrix.
2. Mongoose models, API modules, storage, retention, audit, integration tests.
3. Admin dashboard: auth, overview, users, devices, screenshot explorer, policy, audit log.
4. Desktop client: enrollment, visible status, capture pipeline, encrypted queue, manual and automatic upload, tray, shortcuts, settings.
5. Lint, typecheck, unit and integration tests, production builds. Fix failures before calling the milestone done.

## Out of scope for this version

- SSO / OIDC providers (the auth service has a seam for them, but only email and password ships).
- OCR redaction (a redaction hook exists and currently returns the image unchanged).
- Stealth capture, hidden windows, or bypassing operating-system screen-recording prompts.
