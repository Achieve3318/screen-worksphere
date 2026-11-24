import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { MAX_SCREENSHOT_BYTES } from '@screenvault/shared'

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('mongodb://127.0.0.1:27017/screenvault'),
    JWT_SECRET: z.string().min(32),
    MEDIA_SIGNING_SECRET: z.string().min(32),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./data/storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(MAX_SCREENSHOT_BYTES),
    RETENTION_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
    LOG_LEVEL: z.string().default('info'),
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    RATE_LIMIT_DISABLED: z.enum(['true', 'false']).default('false'),
    PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:4000'),
    SEED_ORG_NAME: z.string().min(1).default('Northwind Studio'),
    SEED_PASSWORD: z.string().min(10).default('ChangeMe-Please-1'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 365 * 24 * 60 * 60),
  })
  .superRefine((value, ctx) => {
    if (!value.DATABASE_URL.startsWith('mongodb://') && !value.DATABASE_URL.startsWith('mongodb+srv://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be a mongodb:// or mongodb+srv:// URI.',
      })
    }
    if (
      value.STORAGE_DRIVER === 's3' &&
      (!value.S3_BUCKET || !value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required.',
      })
    }
  })

export type Env = z.infer<typeof schema> & {
  corsOrigins: string[]
  trustProxy: boolean
  rateLimitDisabled: boolean
  s3ForcePathStyle: boolean
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.parse(source)
  return {
    ...parsed,
    corsOrigins: parsed.CORS_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    trustProxy: parsed.TRUST_PROXY === 'true',
    rateLimitDisabled: parsed.RATE_LIMIT_DISABLED === 'true',
    s3ForcePathStyle: parsed.S3_FORCE_PATH_STYLE === 'true',
  }
}
