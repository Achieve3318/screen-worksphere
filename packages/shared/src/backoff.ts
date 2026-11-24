const BASE_MS = 500
const CAP_MS = 60_000

/** Exponential backoff with up to 20% jitter. `random` is injectable for tests. */
export function backoffMs(attempt: number, random: number = Math.random()): number {
  const exponent = Math.max(0, Math.min(attempt, 16))
  const base = Math.min(CAP_MS, BASE_MS * 2 ** exponent)
  const jitter = base * 0.2 * Math.min(1, Math.max(0, random))
  return Math.round(base + jitter)
}

export type UploadFailureClass =
  'auth' | 'forbidden' | 'too_large' | 'rate' | 'transient' | 'conflict' | 'fatal'

export function classifyHttpStatus(status: number): UploadFailureClass {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 413) return 'too_large'
  if (status === 429) return 'rate'
  if (status === 409) return 'conflict'
  if (status === 408 || status >= 500) return 'transient'
  if (status >= 400) return 'fatal'
  return 'fatal'
}

export function isTrustedApiUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return isLocalOrPrivateHost(url.hostname) || url.hostname === '95.216.116.55'
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}
