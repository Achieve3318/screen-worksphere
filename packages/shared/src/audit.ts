const BLOCKED_KEYS = new Set([
  'password',
  'passwordhash',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'cookie',
  'encryptionkey',
  'secret',
  'bytes',
  'screenshot',
  'image',
])

/** Drops secrets and image payloads before an audit record is stored. */
export function sanitizeAuditMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      output[key] = value
      continue
    }
    if (Array.isArray(value)) {
      output[key] = value.filter(
        (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      )
    }
  }
  return output
}
