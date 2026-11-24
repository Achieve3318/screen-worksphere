'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { brand } from '@screenvault/shared/brand'
import { api, type SessionUser } from '../lib/api'

const links = [
  ['/dashboard', 'Overview', 'grid'],
  ['/users', 'People', 'people'],
  ['/devices', 'Devices', 'monitor'],
  ['/screenshots', 'Screenshots', 'image'],
  ['/audit-log', 'Audit log', 'list'],
  ['/settings', 'Setting', 'sliders'],
] as const

export function Shell({
  user,
  onLogout,
  children,
}: {
  user: SessionUser
  onLogout: () => void
  children: ReactNode
}) {
  const pathname = usePathname()
  const manager = user.role === 'MANAGER'
  const visible = links.filter(([href]) => {
    if (user.role === 'MEMBER' || user.role === 'PAYMENT_MANAGER') return false
    if (manager && (href === '/settings' || href === '/audit-log')) return false
    return true
  })
  const [storage, setStorage] = useState<{ used: number; cap: number | null } | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const summary = await api<{ storageUsedBytes: number }>('/api/v1/dashboard').catch(() => null)
      const policy = await api<{ maxLocalStorageGB: number }>('/api/v1/policy').catch(() => null)
      if (cancelled || !summary) return
      setStorage({
        used: summary.storageUsedBytes,
        cap: policy ? policy.maxLocalStorageGB * 1024 * 1024 * 1024 : null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const usedLabel = storage ? formatBytes(storage.used) : '—'
  const capLabel = storage?.cap ? formatBytes(storage.cap) : null
  const percent =
    storage?.cap && storage.cap > 0
      ? Math.min(100, Math.round((storage.used / storage.cap) * 100))
      : 0
  return (
    <div className="min-h-screen bg-[#f3f6f4] md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 flex h-screen flex-col bg-[#16382f] px-3 py-4 text-white">
        <div className="flex items-center gap-3 px-2">
          <img src="/logo.png" alt="" className="h-10 w-10 rounded-2xl" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">{brand.productName}</p>
            <p className="truncate text-xs text-emerald-100/70">{user.organization.name}</p>
          </div>
        </div>
        <nav className="mt-6 grid gap-1">
          {visible.map(([href, label, icon]) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                  active ? 'bg-[#1f8a5b] text-white' : 'text-emerald-50/80 hover:bg-white/5'
                }`}
              >
                <Icon name={icon} />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto rounded-2xl bg-black/20 p-3">
          <p className="text-xs text-emerald-100/80">Storage usage</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#3ddc97]" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-50/80">
            <span>
              {usedLabel}
              {capLabel ? ` of ${capLabel}` : ''}
            </span>
            {capLabel ? <span>{percent}%</span> : null}
          </div>
        </div>
        <div className="relative mt-3">
          <button
            className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/5"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#1f8a5b] text-xs font-semibold">
              {initials(user.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-emerald-100/70">{user.email}</span>
            </span>
          </button>
          {accountOpen ? (
            <button
              className="absolute right-2 bottom-full mb-2 rounded-xl bg-white px-3 py-2 text-sm text-[#16382f] shadow-lg"
              onClick={onLogout}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </aside>
      <div className="min-h-screen bg-[#f3f6f4]">
        {user.role === 'MEMBER' || user.role === 'PAYMENT_MANAGER' ? (
          <p className="max-w-xl px-6 py-6 text-lg">
            {user.role === 'PAYMENT_MANAGER'
              ? 'Payment managers review payments in the desktop app.'
              : `${brand.productName} console access is for organization managers. Use the desktop app for your own monitoring.`}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
  return letters || 'SV'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function Icon({ name }: { name: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'grid') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  }
  if (name === 'people') {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="3" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 4.13a3 3 0 0 1 0 5.75" />
      </svg>
    )
  }
  if (name === 'monitor') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </svg>
    )
  }
  if (name === 'image') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="m21 15-4.5-4.5L7 19" />
      </svg>
    )
  }
  if (name === 'sliders') {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M4 17h16" />
        <circle cx="8" cy="7" r="2" />
        <circle cx="16" cy="17" r="2" />
      </svg>
    )
  }
  if (name === 'wallet') {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <circle cx="16" cy="15" r="1" fill="currentColor" />
      </svg>
    )
  }
  if (name === 'note') {
    return (
      <svg {...common}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
        <path d="M14 3v5h5" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </svg>
    )
  }
  if (name === 'list') {
    return (
      <svg {...common}>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M9 6H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4" />
      <path d="M14 16l4-4-4-4" />
      <path d="M18 12H9" />
    </svg>
  )
}
