import { describe, expect, it } from 'vitest'
import {
  ScreenshotCryptoError,
  backoffMs,
  canReadScreenshots,
  classifyHttpStatus,
  decryptScreenshot,
  effectiveIntervalSeconds,
  encryptScreenshot,
  isTrustedApiUrl,
  readNonce,
  roleAllows,
  sanitizeAuditMetadata,
  screenshotAad,
  sha256Hex,
} from './index.js'
import { randomBytes } from 'node:crypto'

describe('policy safety bounds', () => {
  it('clamps intervals so capture cannot run continuously', () => {
    expect(effectiveIntervalSeconds(1)).toBe(30)
    expect(effectiveIntervalSeconds(0)).toBe(30)
    expect(effectiveIntervalSeconds(45)).toBe(45)
    expect(effectiveIntervalSeconds(10_000)).toBe(3600)
    expect(effectiveIntervalSeconds(Number.NaN)).toBe(60)
  })
})

describe('permissions', () => {
  it('keeps members off administration and owners on every action', () => {
    expect(roleAllows('MEMBER', 'screenshots:delete')).toBe(false)
    expect(roleAllows('MEMBER', 'desktop:use')).toBe(true)
    expect(roleAllows('MANAGER', 'users:write')).toBe(false)
    expect(roleAllows('MANAGER', 'users:read')).toBe(true)
    expect(roleAllows('ADMIN', 'org:manage')).toBe(false)
    expect(roleAllows('OWNER', 'org:manage')).toBe(true)
    expect(roleAllows('PAYMENT_MANAGER', 'desktop:use')).toBe(true)
    expect(roleAllows('PAYMENT_MANAGER', 'users:write')).toBe(false)
  })

  it('requires both the role grant and the organization allow-list', () => {
    expect(canReadScreenshots('ADMIN', ['OWNER'])).toBe(false)
    expect(canReadScreenshots('ADMIN', ['OWNER', 'ADMIN'])).toBe(true)
    expect(canReadScreenshots('MEMBER', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'])).toBe(false)
  })
})

describe('upload backoff', () => {
  it('grows with the attempt and stays capped', () => {
    expect(backoffMs(0, 0)).toBe(500)
    expect(backoffMs(1, 0)).toBe(1000)
    expect(backoffMs(2, 1)).toBe(2400)
    expect(backoffMs(20, 0)).toBe(60_000)
  })

  it('classifies http failures', () => {
    expect(classifyHttpStatus(401)).toBe('auth')
    expect(classifyHttpStatus(403)).toBe('forbidden')
    expect(classifyHttpStatus(413)).toBe('too_large')
    expect(classifyHttpStatus(429)).toBe('rate')
    expect(classifyHttpStatus(503)).toBe('transient')
    expect(classifyHttpStatus(409)).toBe('conflict')
  })
})

describe('api url trust', () => {
  it('allows https, localhost, and private-network http', () => {
    expect(isTrustedApiUrl('https://vault.example.com')).toBe(true)
    expect(isTrustedApiUrl('http://127.0.0.1:4000')).toBe(true)
    expect(isTrustedApiUrl('http://localhost:4000/api')).toBe(true)
    expect(isTrustedApiUrl('http://10.0.0.8:4000')).toBe(true)
    expect(isTrustedApiUrl('http://192.168.132.46:4000')).toBe(true)
    expect(isTrustedApiUrl('http://95.216.116.55:4000')).toBe(true)
    expect(isTrustedApiUrl('http://8.8.8.8:4000')).toBe(false)
    expect(isTrustedApiUrl('http://example.com')).toBe(false)
    expect(isTrustedApiUrl('not a url')).toBe(false)
  })
})

describe('audit sanitizer', () => {
  it('removes secrets and image payloads', () => {
    expect(
      sanitizeAuditMetadata({
        password: 'hunter2',
        refreshToken: 'abc',
        bytes: 'image',
        interval: 60,
        roles: ['OWNER'],
        nested: { password: 'nope' },
      }),
    ).toEqual({ interval: 60, roles: ['OWNER'] })
  })
})

describe('screenshot encryption', () => {
  const key = randomBytes(32)
  const aad = screenshotAad('6d9f1c3e-1b2a-4c55-9a10-0c2d3e4f5a6b')

  it('round-trips and uses a unique nonce', () => {
    const plaintext = Buffer.from('screenshot-bytes')
    const nonces = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const file = encryptScreenshot(plaintext, key, aad)
      expect(file.subarray(0, 7).toString('utf8')).toBe('SVAULT1')
      expect(decryptScreenshot(file, key, aad).equals(plaintext)).toBe(true)
      nonces.add(readNonce(file).toString('hex'))
    }
    expect(nonces.size).toBe(20)
    expect(sha256Hex(plaintext)).toHaveLength(64)
  })

  it('fails authentication when ciphertext, aad, or key changes', () => {
    const file = encryptScreenshot(Buffer.from('hello'), key, aad)
    file[file.length - 1] = file[file.length - 1]! ^ 0xff
    expect(() => decryptScreenshot(file, key, aad)).toThrow(ScreenshotCryptoError)
    const intact = encryptScreenshot(Buffer.from('hello'), key, aad)
    expect(() => decryptScreenshot(intact, key, screenshotAad('other-id'))).toThrow(
      ScreenshotCryptoError,
    )
    expect(() => decryptScreenshot(intact, randomBytes(32), aad)).toThrow(ScreenshotCryptoError)
  })
})
