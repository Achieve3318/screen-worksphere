import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { brand } from '../brand.js'

export const FORMAT_VERSION = 1
export const ALGORITHM_AES_256_GCM = 1
const NONCE_LENGTH = 12
const TAG_LENGTH = 16
const MAX_NONCE_LENGTH = 32
const MAX_TAG_LENGTH = 32

const MAGIC = Buffer.from(`${brand.magic}\0`, 'utf8')

export class ScreenshotCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScreenshotCryptoError'
  }
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function screenshotAad(screenshotId: string): Buffer {
  return Buffer.concat([
    Buffer.from(`${brand.productSlug}\0`, 'utf8'),
    Buffer.from([FORMAT_VERSION]),
    Buffer.from(screenshotId, 'utf8'),
  ])
}

export function assertDeviceKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new ScreenshotCryptoError('Device key must be 32 bytes.')
  }
}

/**
 * Versioned container:
 * magic (8) | version u8 | algorithm u8 | nonceLen u8 | nonce | tagLen u8 | tag | ciphertext
 * A fresh random nonce is generated for every file. The auth tag covers the ciphertext and AAD.
 */
export function encryptScreenshot(plaintext: Buffer, key: Buffer, aad: Buffer): Buffer {
  assertDeviceKey(key)
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, ALGORITHM_AES_256_GCM, NONCE_LENGTH]),
    nonce,
    Buffer.from([TAG_LENGTH]),
    tag,
    ciphertext,
  ])
}

export function decryptScreenshot(file: Buffer, key: Buffer, aad: Buffer): Buffer {
  assertDeviceKey(key)
  if (file.length < MAGIC.length + 4) {
    throw new ScreenshotCryptoError('Encrypted file is truncated.')
  }
  const magic = file.subarray(0, MAGIC.length)
  if (!magic.equals(MAGIC)) {
    throw new ScreenshotCryptoError('Encrypted file magic does not match.')
  }
  let offset = MAGIC.length
  const version = file[offset]
  const algorithm = file[offset + 1]
  const nonceLength = file[offset + 2]
  offset += 3
  if (version !== FORMAT_VERSION) {
    throw new ScreenshotCryptoError(`Unsupported encryption version ${String(version)}.`)
  }
  if (algorithm !== ALGORITHM_AES_256_GCM) {
    throw new ScreenshotCryptoError('Unsupported encryption algorithm.')
  }
  if (nonceLength === undefined || nonceLength < 12 || nonceLength > MAX_NONCE_LENGTH) {
    throw new ScreenshotCryptoError('Invalid nonce length.')
  }
  if (file.length < offset + nonceLength + 1) {
    throw new ScreenshotCryptoError('Encrypted file is truncated.')
  }
  const nonce = file.subarray(offset, offset + nonceLength)
  offset += nonceLength
  const tagLength = file[offset]
  offset += 1
  if (tagLength === undefined || tagLength < 16 || tagLength > MAX_TAG_LENGTH) {
    throw new ScreenshotCryptoError('Invalid auth tag length.')
  }
  if (file.length < offset + tagLength) {
    throw new ScreenshotCryptoError('Encrypted file is truncated.')
  }
  const tag = file.subarray(offset, offset + tagLength)
  offset += tagLength
  const ciphertext = file.subarray(offset)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new ScreenshotCryptoError(
      'Authentication failed. The file was modified or the key is wrong.',
    )
  }
}

export function readNonce(file: Buffer): Buffer {
  const nonceLength = file[MAGIC.length + 2]
  if (nonceLength === undefined) throw new ScreenshotCryptoError('Missing nonce.')
  const start = MAGIC.length + 3
  return file.subarray(start, start + nonceLength)
}
