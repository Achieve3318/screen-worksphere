# Architecture

WorkSphere is a TypeScript npm workspace.

```text
Desktop (Electron main process)
  capture -> compress -> optional redaction hook -> encrypt -> SQLite queue
  upload queue -> HTTPS -> API

API (Fastify)
  auth, RBAC, policy, audit
  ScreenshotStorage
    LocalFilesystemStorage
    S3CompatibleStorage

MongoDB (Mongoose)
  organizations, users, teams, devices, capture events, screenshots, policy, sessions, audit

Admin (Next.js)
  calls the API with an access token and an httpOnly refresh cookie
```

The renderer process cannot read the filesystem, the database, encryption keys, or a shell. IPC methods are explicit and validated with Zod.

Local screenshot files use a versioned container: magic, version, algorithm, nonce, authentication tag, ciphertext. AES-256-GCM uses a new random nonce per file. The screenshot id is authenticated as additional data.

Each capture of every monitor shares one `captureEventId` and stores one object per display.

Uploads:

1. `POST /api/v1/upload-sessions` records metadata idempotently.
2. `PUT /api/v1/screenshots/:id/content` stores bytes after checksum and image checks.
3. `POST /api/v1/screenshots/:id/complete` writes a thumbnail and marks the row stored.

Sending the same screenshot id and checksum again does not create a second row.

Document `_id` values are UUID strings so JWTs and existing clients stay compatible. Integration tests use `mongodb-memory-server`; production uses `DATABASE_URL` against a normal MongoDB server.
