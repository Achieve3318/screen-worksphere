# WorkSphere

WorkSphere is a screenshot and time-tracking platform for organizations that have told people their computers are monitored. It has three parts:

- a desktop app that enrolls a device, shows when monitoring is running, and stores screenshots encrypted on disk
- an API that authenticates users, enforces roles, and keeps screenshot bytes private
- an admin console for people, devices, screenshots, policy, and the audit log. The screenshot view is a local-day calendar and hourly timeline, and each capture records the active window title.

The product name lives in `packages/shared/src/brand.ts`. Change that module, the CSS tokens in `packages/ui/src/tokens.css`, and the user-facing copy when you rename it.

This repository does not use Docker. Local setup is Node.js, npm, and MongoDB.

## Privacy rules built into the product

- The desktop app does not capture before the person signs in and starts monitoring, unless they explicitly enable “start monitoring after launch”.
- The window, tray, and tooltip always show whether monitoring is running.
- The desktop app has no screenshot gallery and does not open image files.
- Screenshots are compressed, then encrypted with AES-256-GCM, then written to disk. The device key is protected by the operating system credential store (Windows DPAPI, macOS Keychain, or libsecret through Electron `safeStorage`).
- Encryption protects files at rest from other local accounts. It does not protect them from an administrator of that same computer.
- The app does not try to hide the operating system’s screen-recording indicator or bypass its permission prompt.
- Idle time is recorded. It is not turned into a productivity score.

## Repository layout

```text
apps/api       Fastify, Mongoose, MongoDB
apps/admin     Next.js console
apps/desktop   Electron client
packages/shared  branding, crypto format, permissions, limits
packages/types   Zod API contracts
packages/ui      shared mark and tokens
packages/config  shared TypeScript defaults
```

## Prerequisites

- Node.js 22 or newer (includes npm)
- MongoDB 7+ (local `mongod` or Atlas)

### Install MongoDB without containers

- Windows: [MongoDB Community installer](https://www.mongodb.com/try/download/community)
- macOS: `brew install mongodb-community` and `brew services start mongodb-community`
- Linux: your distribution package, for example `sudo apt install mongodb-org`, then `sudo systemctl start mongod`

The default URI is `mongodb://127.0.0.1:27017/screenvault`. The API creates collections and indexes on startup.

## Setup

Put the project in a path **without spaces** (for example `C:\screen-worksphere`). Native modules can fail under paths like `C:\screen-worksphere-main (1)\...`.

```bash
npm install
copy .env.example .env
```

If Electron prints `Electron uninstall`, download its binary once:

```bash
node node_modules/electron/install.js
```

On macOS or Linux, use `cp .env.example .env`.

Edit `.env`:

- Set `JWT_SECRET` and `MEDIA_SIGNING_SECRET` to long random strings.
- Set `DATABASE_URL` to your MongoDB URI (default `mongodb://127.0.0.1:27017/screenvault`).

For the admin console, copy the example env so Next.js can proxy `/api/v1` to the API. The browser talks only to the console origin, which keeps the refresh cookie first-party:

```bash
copy apps\admin\.env.example apps\admin\.env.local
```

Seed demo data:

```bash
npm run db:seed
```

Demo accounts all use `SEED_PASSWORD` (the example value is `ChangeMe-Please-1`):

- `owner@example.com`
- `admin@example.com`
- `manager@example.com`
- `member@example.com`

Change that password before any shared deployment.

## Run

```bash
npm run dev
```

- API: http://127.0.0.1:4000
- Admin: http://localhost:3000
- Desktop: an Electron window

You can also run one app:

```bash
npm run dev:api
npm run dev:admin
npm run dev:desktop
```

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

The admin scripts use webpack. Next.js 16’s Turbopack builder hits a native crash on some Windows installs, and the console only needs the branding module from the shared package in the browser.

Integration tests use `mongodb-memory-server` and do not need a local MongoDB server.

## Desktop behavior

After enrollment, screenshots are written under the OS application-data directory for WorkSphere, in dated folders, with random `.svault` names. The settings window shows how much space they use. People cannot browse the images in the app.

Capture interval, quality, monitors, upload policy, and retention come from the organization. The desktop client also refuses intervals outside 30–3600 seconds, so a bad policy cannot capture continuously.

Uploads are idempotent: the same screenshot id is not stored twice. The queue survives restarts. Cancelling an upload returns in-flight files to pending. Automatic upload is optional and does not remove the manual **Upload Screenshots** button unless policy disables it.

If local storage reaches the configured limit, capture stops. Pending screenshots are not deleted to free space. Uploaded files are removed only when policy says to delete after upload or when local retention expires.

### Operating system permissions

- macOS asks for screen recording permission. Grant it in System Settings. The app will not work around a denial.
- Windows and Linux use the normal screen-capture APIs available to the signed-in user.
- Lock, sleep, and wake pause capture when policy says to pause while locked. The default is to pause.
- A global start/stop shortcut is off until someone turns it on. If the operating system rejects it, the app reports the conflict instead of replacing another app’s shortcut.

## Object storage

`STORAGE_DRIVER=local` writes originals and thumbnails under `STORAGE_LOCAL_DIR`. That directory is not served as a public website. Admins receive images only after the API checks their organization and role.

For production, set `STORAGE_DRIVER=s3` and the `S3_*` variables. Any S3-compatible service works. The API can issue short-lived signed read URLs after authorization. The admin grid does not use permanent public URLs; it downloads thumbnails with the admin’s access token.

Server retention (30, 60, 90, 180, 365 days, or unlimited) deletes the database row, thumbnail, and original, and writes an audit event.

## Roles

| Role    | Access                                                    |
| ------- | --------------------------------------------------------- |
| OWNER   | Organization, people, devices, screenshots, policy, audit |
| ADMIN   | People, devices, screenshots, policy, audit               |
| MANAGER | Assigned teams only                                       |
| MEMBER  | Desktop app only                                          |

The API enforces this. Hiding a button is not the authorization check.

## Further reading

- [Architecture](docs/ARCHITECTURE.md)
- [API contracts](docs/API.md)
- [Security notes](docs/SECURITY.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
