# API contracts

Base path: `/api/v1`. Errors use `{ error: { code, message, details, requestId } }`.

Authentication is a bearer access token. Browsers also store a rotating refresh token in the httpOnly cookie `sv_refresh`. Desktop clients send `X-Screenvault-Client: desktop` and receive the refresh token in JSON so it can be stored in the OS credential store.

## Auth and devices

| Method | Path                 | Notes                                                                                                                       |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`        | Email and password. Rate limited.                                                                                           |
| POST   | `/auth/refresh`      | Rotates the refresh token. Reuse of an old token revokes the family.                                                        |
| POST   | `/auth/logout`       | Revokes the presented refresh token.                                                                                        |
| GET    | `/auth/me`           | Current user, organization, and device.                                                                                     |
| POST   | `/devices/enroll`    | Email, password, and device descriptor. Optional `deviceId` reuses an enrollment. Revoked devices receive `DEVICE_REVOKED`. |
| POST   | `/devices/heartbeat` | Device session updates `lastSeenAt`.                                                                                        |

## Administration

| Method     | Path                               | Roles                                             |
| ---------- | ---------------------------------- | ------------------------------------------------- |
| GET        | `/dashboard`                       | Owner, admin, manager (team scope)                |
| GET, POST  | `/users`                           | Read: owner, admin, manager. Write: owner, admin. |
| GET, PATCH | `/users/:id`                       | Same write rules. Owners cannot be demoted here.  |
| POST       | `/users/:id/disable` and `/enable` | Owner, admin. Not yourself. Not the owner.        |
| GET, POST  | `/teams`                           | Create: owner, admin.                             |
| GET        | `/devices` and `/devices/:id`      | Owner, admin, manager scope, member sees self.    |
| POST       | `/devices/:id/revoke`              | Owner, admin. Revokes device refresh tokens.      |
| GET, PUT   | `/policy`                          | Read: any signed-in member. Write: owner, admin.  |
| PATCH      | `/organization`                    | Owner.                                            |
| GET        | `/audit-logs`                      | Owner, admin.                                     |

Policy writes reject capture intervals outside 30–3600 seconds, quality outside 40–100, and screenshot access lists that omit `OWNER`.

## Screenshots

| Method | Path                                               | Notes                                                                                                                                                                   |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/upload-sessions`                                 | Device session. Up to 50 items. Idempotent on screenshot id.                                                                                                            |
| PUT    | `/screenshots/:id/content`                         | Raw `image/webp` or `image/jpeg` with `X-Checksum-Sha256`.                                                                                                              |
| POST   | `/screenshots/:id/complete`                        | Verifies stored bytes, writes a thumbnail, marks `STORED`.                                                                                                              |
| GET    | `/capture-events`                                  | Cursor pagination. Filters: `from`, `to`, `userId`, `deviceId`, `teamId`, `display`. Each event includes `activeApp` and `activeWindow` when the desktop recorded them. |
| GET    | `/capture-activity`                                | Day totals for a range of at most 62 days. Requires `from`, `to`, and an IANA `timeZone`.                                                                               |
| GET    | `/screenshots/:id/content?variant=thumbnail\|full` | Authorized bytes. `download=1` audits a download. Full views are audited.                                                                                               |
| DELETE | `/screenshots/:id`                                 | Owner, admin. Deletes objects and the row.                                                                                                                              |
| GET    | `/media/:token`                                    | Short-lived signed read issued only after an authorization check.                                                                                                       |

Every screenshot query includes the caller’s organization. Managers only see people on their teams. A cross-organization id returns 404.

## Health

`GET /health` and `GET /api/v1/health`.

## Rate limits

Login and enrollment are tighter than screenshot batch uploads. Upload initialization is limited per minute, while content upload allows a backlog of multi-monitor captures to drain. Set `RATE_LIMIT_DISABLED=true` only in tests.
