// Same-origin so the httpOnly refresh cookie is first-party. Next rewrites /api/v1 to the API.
export const apiBase = ''

export type SessionUser = {
  id: string
  email: string
  name: string
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'PAYMENT_MANAGER' | 'MEMBER'
  organization: { id: string; name: string }
}

type ErrorBody = { error?: { message?: string; code?: string } }

let accessToken: string | null = null

export function currentToken(): string | null {
  return accessToken
}

export function clearSession(): void {
  accessToken = null
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text()
  const body = text ? (JSON.parse(text) as T & ErrorBody) : ({} as T & ErrorBody)
  if (!response.ok) {
    throw new Error(body.error?.message || `Request failed (${response.status}).`)
  }
  return body
}

let refreshInFlight: Promise<boolean> | null = null

async function refreshSessionOnce(): Promise<boolean> {
  let response: Response
  try {
    response = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error('The console could not reach the server.')
  }
  if (!response.ok) {
    accessToken = null
    return false
  }
  const body = (await response.json()) as { accessToken: string }
  accessToken = body.accessToken
  return true
}

export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSessionOnce().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && retry && !path.startsWith('/api/v1/auth/login')) {
    const refreshed = await refreshSession()
    if (refreshed) return api<T>(path, init, false)
  }
  return parse<T>(response)
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await api<{ accessToken: string; user: SessionUser }>(
    '/api/v1/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  )
  accessToken = body.accessToken
  return body.user
}

export async function logout(): Promise<void> {
  await api('/api/v1/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined)
  accessToken = null
}

const blobWaiters: Array<() => void> = []
let blobActive = 0

function pumpBlobs(): void {
  while (blobActive < 3 && blobWaiters.length > 0) {
    const next = blobWaiters.shift()
    if (!next) return
    blobActive += 1
    next()
  }
}

function enqueueBlob<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    let started = false
    const run = () => {
      started = true
      job()
        .then(resolve, reject)
        .finally(() => {
          blobActive -= 1
          pumpBlobs()
        })
    }
    const onAbort = () => {
      if (started) return
      const index = blobWaiters.indexOf(run)
      if (index >= 0) blobWaiters.splice(index, 1)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    blobWaiters.push(run)
    pumpBlobs()
  })
}

const blobCache = new Map<string, Promise<Blob>>()
const BLOB_CACHE_LIMIT = 240

export function authorizedBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const existing = blobCache.get(path)
  const pending = existing ?? rememberBlob(path, enqueueBlob(() => fetchBlob(path)))
  return withSignal(pending, signal)
}

function rememberBlob(path: string, promise: Promise<Blob>): Promise<Blob> {
  const stored = promise.then(
    (blob) => {
      if (!usableImage(blob)) {
        blobCache.delete(path)
        throw new Error('Screenshot could not be loaded.')
      }
      return blob
    },
    (error: unknown) => {
      blobCache.delete(path)
      throw error
    },
  )
  blobCache.set(path, stored)
  while (blobCache.size > BLOB_CACHE_LIMIT) {
    const oldest = blobCache.keys().next().value
    if (oldest === undefined || oldest === path) break
    blobCache.delete(oldest)
  }
  return stored
}

function usableImage(blob: Blob): boolean {
  if (blob.size === 0) return false
  if (blob.type.startsWith('text/') || blob.type.includes('json')) return false
  return true
}

async function fetchBlob(path: string): Promise<Blob> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const headers = new Headers()
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
    const response = await fetch(`${apiBase}${path}`, { headers, credentials: 'include' })
    if (response.status === 401 && attempt === 0) {
      const refreshed = await refreshSession()
      if (refreshed) continue
    }
    if (response.status === 429 && attempt < 5) {
      await delay(retryWait(response, attempt))
      continue
    }
    if (response.status >= 500 && attempt < 5) {
      await delay(500 * (attempt + 1))
      continue
    }
    if (!response.ok) throw new Error('Screenshot could not be loaded.')
    return response.blob()
  }
  throw new Error('Screenshot could not be loaded.')
}

function retryWait(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return Math.min(header, 15) * 1000
  return 700 * (attempt + 1)
}

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(abortError())
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(signal.aborted ? abortError() : error)
      },
    )
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })
}

function abortError(): Error {
  const error = new Error('The screenshot request was cancelled.')
  error.name = 'AbortError'
  return error
}
