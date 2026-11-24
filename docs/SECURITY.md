# Security notes

## Local screenshots

Files are authenticated encryption (AES-256-GCM), not hidden filenames. The 32-byte device key is created on the machine and wrapped with Electron `safeStorage`. There is no hard-coded key.

The format starts with the ASCII magic `SVAULT1` and a NUL byte, then version, algorithm, nonce length, nonce, tag length, tag, and ciphertext. A new nonce is used for every file. The screenshot id is bound as additional authenticated data.

This stops another user account from opening the files. A person with administrator rights on that computer, or malware running as the enrolled user, can use the same credential store. Say that plainly to customers.

Deletion removes the file. Solid-state disks may retain old blocks. WorkSphere does not claim a forensic wipe.

## Server screenshots

Storage directories are not public static files. Image responses require an organization-scoped authorization check, except for short-lived signed URLs that are minted only after that check. Signed local URLs expire quickly and are bound to one object key.

Thumbnails are what the grid requests. Full images load when someone opens the viewer, and that view is audited.

## Authentication

Passwords are hashed with Argon2id. Access tokens are short-lived HS256 JWTs. Refresh tokens are random, stored as SHA-256 hashes, and rotated. Presenting a replaced refresh token revokes the user’s remaining refresh tokens.

Audit records go through an allow-list sanitizer. Passwords, tokens, cookies, and image bytes are dropped.

## API

- Zod validates inputs.
- Mongoose queries use parameterized drivers (no string-built Mongo filters from raw user input).
- Helmet sets secure headers. CORS allows the configured admin origins only, with credentials.
- Upload size is capped (default 20 MB).
- Logs redact authorization headers, cookies, passwords, and tokens.
- Rate limits cover login, refresh, upload setup, content upload, and screenshot reads.

## Desktop process model

`contextIsolation` is on, `nodeIntegration` is off, and the renderer is sandboxed. The preload bridge exposes the typed methods the window needs. Capture, encryption, SQLite, and uploads stay in the main process.

The client refuses a non-local `http://` server URL.

## What this product will not do

It will not capture before enrollment, hide the monitoring state, or bypass an operating-system screen-recording prompt.
