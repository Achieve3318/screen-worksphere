import { brand } from '../../shared/dist/brand.js'
import type { ReactNode } from 'react'

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f766e" />
      <path
        d="M8 14.5V12a8 8 0 0 1 16 0v2.5"
        fill="none"
        stroke="#d8fff0"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="7" y="14" width="18" height="12" rx="3" fill="#f4fbf8" />
      <circle cx="16" cy="20" r="1.7" fill="#0f766e" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 650 }}>
      <Mark />
      <span>{brand.productName}</span>
    </span>
  )
}

export function StatusDot({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'idle'
  children: ReactNode
}) {
  const color =
    tone === 'ok'
      ? '#0f766e'
      : tone === 'warn'
        ? '#b45309'
        : tone === 'danger'
          ? '#b42318'
          : '#667085'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: color,
          boxShadow: tone === 'ok' ? '0 0 0 4px rgba(15,118,110,0.15)' : undefined,
        }}
      />
      {children}
    </span>
  )
}
