import { createHash, randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { SignJWT, jwtVerify } from 'jose'
import type { Env } from './env.js'
import { unauthorized } from './errors.js'

const ARGON_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS)
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password)
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function signAccessToken(
  claims: { userId: string; organizationId: string; deviceId: string | null },
  env: Env,
): Promise<string> {
  return new SignJWT({
    org: claims.organizationId,
    deviceId: claims.deviceId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(env.JWT_SECRET))
}

export async function verifyAccessToken(
  token: string,
  env: Env,
): Promise<{ userId: string; organizationId: string; deviceId: string | null }> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
      algorithms: ['HS256'],
    })
    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') {
      throw unauthorized('Access token is invalid.')
    }
    return {
      userId: payload.sub,
      organizationId: payload.org,
      deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ApiError') throw error
    throw unauthorized('Access token is invalid.')
  }
}

let dummyPasswordHash: string | null = null

export async function dummyHash(): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hashPassword('dummy-password-not-a-login-9')
  }
  return dummyPasswordHash
}
