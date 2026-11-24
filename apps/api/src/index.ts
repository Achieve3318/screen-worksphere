import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { buildApp } from './app.js'
import { createDb } from './db.js'
import { parseEnv } from './env.js'
import { runRetention } from './services/screenshots.js'
import { LocalFilesystemStorage, S3CompatibleStorage, type ScreenshotStorage } from './storage.js'

const env = parseEnv()

function createStorage(): ScreenshotStorage {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3CompatibleStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET ?? '',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      forcePathStyle: env.s3ForcePathStyle,
    })
  }
  return new LocalFilesystemStorage(
    path.resolve(env.STORAGE_LOCAL_DIR),
    env.PUBLIC_BASE_URL,
    env.MEDIA_SIGNING_SECRET,
  )
}

const database = await createDb(env)
await database.db.RefreshToken.updateMany(
  { revokedAt: null },
  { $set: { expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) } },
)
const storage = createStorage()
if (env.STORAGE_DRIVER === 'local') {
  await mkdir(path.resolve(env.STORAGE_LOCAL_DIR), { recursive: true })
}
const app = await buildApp({ db: database.db, storage, env })

const retentionTimer = setInterval(
  () => {
    void runRetention(database.db, storage).catch((error: unknown) => {
      app.log.error({ err: error }, 'retention run failed')
    })
  },
  env.RETENTION_INTERVAL_MINUTES * 60 * 1000,
)
retentionTimer.unref()

const close = async () => {
  clearInterval(retentionTimer)
  await app.close()
  await database.close()
}

process.on('SIGINT', () => {
  void close().then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void close().then(() => process.exit(0))
})

await app.listen({ host: env.HOST, port: env.PORT })