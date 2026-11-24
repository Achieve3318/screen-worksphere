'use client'

import { useEffect, useState } from 'react'
import { PageFrame, Panel } from '../../components/PageFrame'
import { api } from '../../lib/api'

type DayStat = {
  date: string
  label: string
  totalMs: number
  activeMs: number
  screenshots: number
}

type GroupStat = {
  id: string
  name: string
  members?: number
  totalMs: number
  activeMs: number
  screenshots: number
  series: number[]
}

type Breakdown = {
  labels: string[]
  users: GroupStat[]
  teams: GroupStat[]
}

type Summary = {
  activeUsers: number
  registeredDevices: number
  screenshotsToday: number
  pendingOrFailedUploads: number
  storageUsedBytes: number
  onlineDevices: number
  offlineDevices: number
  days?: DayStat[]
  hours?: number[]
  apps?: { name: string; count: number }[]
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [group, setGroup] = useState<'user' | 'team'>('user')
  const [method, setMethod] = useState<'card' | 'graph'>('card')
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('7d')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    void api<Summary>(`/api/v1/dashboard?timeZone=${encodeURIComponent(timeZone)}`)
      .then(setSummary)
      .catch((caught: Error) => setError(caught.message))
  }, [])
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const params = new URLSearchParams({ timeZone, period })
    let cancelled = false
    void api<Breakdown>(`/api/v1/dashboard/breakdown?${params.toString()}`)
      .then((body) => {
        if (!cancelled) setBreakdown(body)
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message)
      })
    return () => {
      cancelled = true
    }
  }, [period])
  if (error) {
    return (
      <PageFrame
        title="Overview"
        subtitle="Organization activity from the last five minutes."
        icon={<PulseIcon />}
      >
        <p className="text-sm text-[var(--sv-danger)]">{error}</p>
      </PageFrame>
    )
  }
  if (!summary) {
    return (
      <PageFrame
        title="Overview"
        subtitle="Organization activity from the last five minutes."
        icon={<PulseIcon />}
      >
        <p className="text-sm text-[var(--sv-muted)]">Loading overview…</p>
      </PageFrame>
    )
  }
  const cards = [
    ['Active users', String(summary.activeUsers), 'people'],
    ['Registered devices', String(summary.registeredDevices), 'monitor'],
    ['Screenshots today', String(summary.screenshotsToday), 'image'],
    ['Pending or failed uploads', String(summary.pendingOrFailedUploads), 'upload'],
    ['Storage used', formatBytes(summary.storageUsedBytes), 'box'],
    ['Devices online / offline', `${summary.onlineDevices} / ${summary.offlineDevices}`, 'pulse'],
  ]
  return (
    <PageFrame
      title="Overview"
      subtitle="A device is online when it has checked in during the last five minutes. Idle time is recorded, not scored."
      icon={<PulseIcon />}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value, icon]) => (
          <article
            key={label}
            className="rounded-2xl border border-[#e6ece8] bg-white px-4 py-4 shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)]"
          >
            <div className="flex items-center gap-2 text-sm text-[#1f8a5b]">
              <DashIcon name={icon} />
              {label}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          </article>
        ))}
      </div>

      <Panel className="mt-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {group === 'user' ? 'People' : 'Teams'}
            </h2>
            <p className="text-sm text-[var(--sv-muted)]">
              {method === 'card'
                ? 'One card for each person or team in the period.'
                : 'The highest line is the top active time.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Choice
              value={group}
              onChange={setGroup}
              options={[
                ['user', 'User'],
                ['team', 'Team'],
              ]}
            />
            <Choice
              value={method}
              onChange={setMethod}
              options={[
                ['card', 'Cards'],
                ['graph', 'Graph'],
              ]}
            />
            <Choice
              value={period}
              onChange={setPeriod}
              options={[
                ['today', 'Today'],
                ['7d', '7 days'],
                ['30d', '30 days'],
              ]}
            />
          </div>
        </div>
        {breakdown ? (
          method === 'card' ? (
            <StatCards items={group === 'user' ? breakdown.users : breakdown.teams} grouped={group} />
          ) : (
            <RankChart
              labels={breakdown.labels}
              items={group === 'user' ? breakdown.users : breakdown.teams}
            />
          )
        ) : (
          <p className="mt-4 text-sm text-[var(--sv-muted)]">Loading statistics…</p>
        )}
      </Panel>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.9fr)]">
        <Panel className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Last 7 days</h2>
              <p className="text-sm text-[var(--sv-muted)]">
                Green is active time. Gray is the rest of monitored time.
              </p>
            </div>
            <Legend />
          </div>
          <WeekChart days={summary.days ?? []} />
        </Panel>
        <Panel className="px-5 py-4">
          <h2 className="text-base font-semibold">Today by hour</h2>
          <p className="text-sm text-[var(--sv-muted)]">Screenshots captured in each hour.</p>
          <HourChart hours={summary.hours ?? []} />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Panel className="px-5 py-4">
          <h2 className="text-base font-semibold">Today’s time</h2>
          <TimeSplit days={summary.days ?? []} />
        </Panel>
        <Panel className="px-5 py-4">
          <h2 className="text-base font-semibold">Active programs</h2>
          <p className="text-sm text-[var(--sv-muted)]">Most common program in today’s captures.</p>
          <AppBars apps={summary.apps ?? []} />
        </Panel>
      </div>
    </PageFrame>
  )
}

const SERIES_COLORS = ['#1f8a5b', '#2563eb', '#d97706', '#7c3aed', '#0f766e', '#db2777', '#16382f', '#64748b']

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: [T, string][]
}) {
  return (
    <div className="flex rounded-full bg-[#f3f6f4] p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`rounded-full px-3 py-1 text-sm ${
            value === id ? 'bg-white font-medium text-[#1f8a5b] shadow-sm' : 'text-[var(--sv-muted)]'
          }`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function StatCards({ items, grouped }: { items: GroupStat[]; grouped: 'user' | 'team' }) {
  if (items.length === 0) {
    return <p className="mt-4 text-sm text-[var(--sv-muted)]">No {grouped === 'user' ? 'people' : 'teams'} to show.</p>
  }
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => {
        const share = item.totalMs > 0 ? Math.round((item.activeMs / item.totalMs) * 100) : 0
        return (
          <article key={item.id} className="rounded-2xl border border-[#e6ece8] bg-[#f7faf8] px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#16382f] text-xs font-semibold text-white">
                {initials(item.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  <span className="mr-2 text-xs text-[var(--sv-muted)]">#{index + 1}</span>
                  {item.name}
                </p>
                <p className="truncate text-xs text-[var(--sv-muted)]">
                  {grouped === 'team' ? `${item.members ?? 0} people · ` : ''}
                  {item.screenshots} screenshots
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tracking-tight">{formatDuration(item.activeMs)}</p>
                <p className="text-xs text-[var(--sv-muted)]">Active</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{formatDuration(item.totalMs)}</p>
                <p className="text-xs text-[var(--sv-muted)]">Total · {share}%</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e6eeea]">
              <div className="h-full bg-[#1f8a5b]" style={{ width: `${share}%` }} />
            </div>
          </article>
        )
      })}
    </div>
  )
}

function RankChart({ labels, items }: { labels: string[]; items: GroupStat[] }) {
  const ranked = items.filter((item) => item.activeMs > 0).slice(0, SERIES_COLORS.length)
  const max = Math.max(...ranked.flatMap((item) => item.series), 1)
  const width = 640
  const height = 220
  const left = 44
  const right = 12
  const top = 12
  const bottom = 28
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom
  const xAt = (index: number) =>
    labels.length <= 1 ? left + innerWidth / 2 : left + (index / (labels.length - 1)) * innerWidth
  const yAt = (value: number) => top + innerHeight - (value / max) * innerHeight
  if (ranked.length === 0) {
    return <p className="mt-4 text-sm text-[var(--sv-muted)]">No monitored time in this period.</p>
  }
  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="Active time comparison">
        {[0, 0.5, 1].map((step) => {
          const value = max * step
          const y = yAt(value)
          return (
            <g key={step}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="#e6ece8" />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7c74">
                {formatDuration(value)}
              </text>
            </g>
          )
        })}
        {ranked.map((item, seriesIndex) => {
          const color = SERIES_COLORS[seriesIndex] ?? '#1f8a5b'
          const points = item.series
            .map((value, index) => `${xAt(index)},${yAt(value)}`)
            .join(' ')
          return (
            <g key={item.id}>
              <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" points={points} />
              {item.series.map((value, index) =>
                labels.length > 24 ? null : (
                  <circle key={`${item.id}-${index}`} cx={xAt(index)} cy={yAt(value)} r="2.5" fill={color}>
                    <title>{`${item.name} · ${labels[index]} · ${formatDuration(value)}`}</title>
                  </circle>
                ),
              )}
            </g>
          )
        })}
        {labels.map((label, index) =>
          labels.length > 8 && index % Math.ceil(labels.length / 8) !== 0 ? null : (
            <text key={label + index} x={xAt(index)} y={height - 8} textAnchor="middle" fontSize="10" fill="#6b7c74">
              {label}
            </text>
          ),
        )}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {ranked.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1.5 text-xs text-[var(--sv-muted)]">
            <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[index] }} />
            <span className="font-medium text-[var(--sv-ink)]">{item.name}</span>
            {formatDuration(item.activeMs)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'SV'
}

function WeekChart({ days }: { days: DayStat[] }) {
  const max = Math.max(...days.map((day) => day.totalMs), 1)
  return (
    <div className="mt-5 flex h-52 items-end gap-2">
      {days.map((day) => {
        const height = day.totalMs > 0 ? Math.max(8, (day.totalMs / max) * 100) : 4
        const active = day.totalMs > 0 ? (day.activeMs / day.totalMs) * 100 : 0
        return (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-40 w-full items-end justify-center">
              <div
                className="relative w-full max-w-10 overflow-hidden rounded-lg bg-[#e6eeea]"
                style={{ height: `${height}%` }}
                title={`${day.label}: ${formatDuration(day.totalMs)} total, ${formatDuration(day.activeMs)} active, ${day.screenshots} screenshots`}
              >
                <div
                  className="absolute inset-x-0 bottom-0 bg-[#1f8a5b]"
                  style={{ height: `${active}%` }}
                />
              </div>
            </div>
            <span className="text-[11px] text-[var(--sv-muted)]">{day.label}</span>
            <span className="text-[11px] font-medium">{day.screenshots}</span>
          </div>
        )
      })}
    </div>
  )
}

function HourChart({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1)
  return (
    <div className="mt-4">
      <div className="flex h-36 items-end gap-1">
        {hours.map((count, hour) => (
          <div
            key={hour}
            className="flex h-full flex-1 items-end"
            title={`${hourLabel(hour)}: ${count} screenshot${count === 1 ? '' : 's'}`}
          >
            <div
              className="w-full rounded-sm bg-[#1f8a5b]"
              style={{
                height: count === 0 ? '2px' : `${Math.max(8, (count / max) * 100)}%`,
                opacity: count === 0 ? 0.25 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-8 text-[10px] text-[var(--sv-muted)]">
        {['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

function TimeSplit({ days }: { days: DayStat[] }) {
  const today = days.at(-1)
  const total = today?.totalMs ?? 0
  const active = today?.activeMs ?? 0
  const inactive = Math.max(0, total - active)
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0
  return (
    <div className="mt-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-3xl font-semibold tracking-tight">{formatDuration(total)}</p>
          <p className="text-sm text-[var(--sv-muted)]">Total monitored</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tracking-tight text-[#1f8a5b]">
            {formatDuration(active)}
          </p>
          <p className="text-sm text-[var(--sv-muted)]">Active · {activePct}%</p>
        </div>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#e6eeea]">
        <div className="h-full bg-[#1f8a5b]" style={{ width: `${activePct}%` }} />
      </div>
      <p className="mt-3 text-sm text-[var(--sv-muted)]">
        {formatDuration(inactive)} without mouse or keyboard input for a full minute.
      </p>
    </div>
  )
}

function AppBars({ apps }: { apps: { name: string; count: number }[] }) {
  const max = Math.max(...apps.map((app) => app.count), 1)
  if (apps.length === 0) {
    return <p className="mt-4 text-sm text-[var(--sv-muted)]">No program recorded today.</p>
  }
  return (
    <ul className="mt-4 space-y-3">
      {apps.map((app) => (
        <li key={app.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium">{app.name}</span>
            <span className="shrink-0 text-[var(--sv-muted)]">{app.count}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e6eeea]">
            <div
              className="h-full rounded-full bg-[#1f8a5b]"
              style={{ width: `${(app.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Legend() {
  return (
    <div className="flex gap-3 text-[11px] text-[var(--sv-muted)]">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-[#1f8a5b]" /> Active
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-[#d7e0db]" /> Inactive
      </span>
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${clock}${suffix}`
}

function PulseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M3 12h4l2-5 4 10 2-5h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DashIcon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'people') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 19a6 6 0 0 1 12 0" />
      </svg>
    )
  }
  if (name === 'monitor') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    )
  }
  if (name === 'image') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m21 15-5-5-9 9" />
      </svg>
    )
  }
  if (name === 'upload') {
    return (
      <svg {...common}>
        <path d="M12 16V6" />
        <path d="m8 10 4-4 4 4" />
        <path d="M5 19h14" />
      </svg>
    )
  }
  if (name === 'box') {
    return (
      <svg {...common}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
        <path d="M12 12 4 7.5" />
        <path d="m12 12 8-4.5" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
