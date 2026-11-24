'use client'

import { ConfigProvider } from 'antd'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { api, logout, refreshSession, type SessionUser } from '../lib/api'
import { Shell } from './Shell'

const theme = {
  token: {
    colorPrimary: '#1f8a5b',
    borderRadius: 12,
    fontFamily: "'Segoe UI Variable', 'Segoe UI', ui-sans-serif, system-ui, sans-serif",
  },
}

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [offline, setOffline] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setOffline(null)
    void refreshSession()
      .then(async (ok) => {
        if (!ok || cancelled) return
        setUser(
          await api<SessionUser>('/api/v1/auth/me', { signal: AbortSignal.timeout(8000) }),
        )
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setOffline(
            caught instanceof Error ? caught.message : 'The console could not reach the server.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (!ready || offline) return
    if (!user && pathname !== '/login') router.replace('/login')
    if (user && pathname === '/login') router.replace('/dashboard')
  }, [ready, offline, user, pathname, router])

  let content: ReactNode
  if (!ready) {
    content = (
      <div className="grid min-h-screen place-items-center text-sm text-[var(--sv-muted)]">
        Loading console…
      </div>
    )
  } else if (offline) {
    content = (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div>
          <p className="text-sm text-[var(--sv-danger)]">{offline}</p>
          <button
            className="mt-4 rounded-xl bg-[#1f8a5b] px-4 py-2 text-sm font-semibold text-white"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    )
  } else if (pathname === '/login') {
    content = children
  } else if (!user) {
    content = null
  } else {
    content = (
      <Shell
        user={user}
        onLogout={() => {
          void logout().finally(() => {
            setUser(null)
            router.replace('/login')
          })
        }}
      >
        {children}
      </Shell>
    )
  }
  return <ConfigProvider theme={theme}>{content}</ConfigProvider>
}
