'use client'

import { Progress } from 'antd'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ListPagination, pageOf, useListPage } from '../../components/ListPagination'
import { api, authorizedBlob } from '../../lib/api'

type Shot = {
  id: string
  displayId: string
  displayIndex: number
  displayName: string | null
  width: number
  height: number
  capturedAt: string
  contentPath: string
  thumbnailPath: string
}

type EventItem = {
  id: string
  capturedAt: string
  timezone: string
  workNote: string | null
  activeApp: string | null
  activeWindow: string | null
  idle: boolean
  activeMs: number | null
  intervalMs: number | null
  user: { id: string; name: string }
  device: { id: string; name: string; platform: string }
  screenshots: Shot[]
}

type Option = { id: string; name: string }

type DayActivity = {
  date: string
  count: number
  trackedMs: number
  totalMs?: number
  activeMs?: number
  hours: number[]
}

export default function ScreenshotsPage() {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const today = localDateInput()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [day, setDay] = useState(today)
  const [userId, setUserId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [items, setItems] = useState<EventItem[]>([])
  const [days, setDays] = useState<DayActivity[]>([])
  const [users, setUsers] = useState<Option[]>([])
  const [devices, setDevices] = useState<Option[]>([])
  const [teams, setTeams] = useState<Option[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<{ eventIndex: number; shotIndex: number } | null>(null)
  const [search, setSearch] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [newestFirst, setNewestFirst] = useState(true)
  const [me, setMe] = useState<{ name: string } | null>(null)

  useEffect(() => {
    void api<{ name: string }>('/api/v1/auth/me')
      .then(setMe)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.getElementById('screenshot-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void api<{ items: Option[] }>('/api/v1/users')
      .then((body) => setUsers(body.items))
      .catch(() => undefined)
    void api<{ items: Option[] }>('/api/v1/devices')
      .then((body) => setDevices(body.items))
      .catch(() => undefined)
    void api<{ items: Option[] }>('/api/v1/teams')
      .then((body) => setTeams(body.items))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const range = activityRange(month)
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      timeZone,
    })
    if (userId) params.set('userId', userId)
    if (deviceId) params.set('deviceId', deviceId)
    if (teamId) params.set('teamId', teamId)
    let cancelled = false
    void api<{ days: DayActivity[] }>(`/api/v1/capture-activity?${params.toString()}`)
      .then((body) => {
        if (!cancelled) setDays(body.days)
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message)
      })
    return () => {
      cancelled = true
    }
  }, [month, userId, deviceId, teamId, timeZone])

  useEffect(() => {
    const params = new URLSearchParams({
      limit: '50',
      from: new Date(`${day}T00:00:00`).toISOString(),
      to: new Date(`${day}T23:59:59.999`).toISOString(),
    })
    if (userId) params.set('userId', userId)
    if (deviceId) params.set('deviceId', deviceId)
    if (teamId) params.set('teamId', teamId)
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    setItems([])
    void (async () => {
      const collected: EventItem[] = []
      let cursor: string | null = null
      for (let page = 0; page < 40; page += 1) {
        if (cancelled) return
        if (cursor) params.set('cursor', cursor)
        const body = await api<{ items: EventItem[]; nextCursor: string | null }>(
          `/api/v1/capture-events?${params.toString()}`,
          { signal: controller.signal },
        )
        collected.push(...body.items)
        if (!body.nextCursor) break
        cursor = body.nextCursor
      }
      if (cancelled) return
      setItems([...collected].reverse())
      setLoading(false)
    })().catch((caught: unknown) => {
      if (cancelled || isAbort(caught)) return
      setLoading(false)
      setError(caught instanceof Error ? caught.message : 'Screenshots could not be loaded.')
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [day, userId, deviceId, teamId])

  const activity = useMemo(() => new Map(days.map((entry) => [entry.date, entry])), [days])
  const selected = activity.get(day)
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
  const monthTotal = days
    .filter((entry) => entry.date.startsWith(monthKey))
    .reduce((sum, entry) => sum + dayTotal(entry), 0)
  const monthActive = days
    .filter((entry) => entry.date.startsWith(monthKey))
    .reduce((sum, entry) => sum + dayActive(entry), 0)
  const week = weekBounds(day)
  const weekTotal = days
    .filter((entry) => entry.date >= week.start && entry.date <= week.end)
    .reduce((sum, entry) => sum + dayTotal(entry), 0)
  const weekActive = days
    .filter((entry) => entry.date >= week.start && entry.date <= week.end)
    .reduce((sum, entry) => sum + dayActive(entry), 0)
  const selectedDate = parseLocalDate(day)
  const query = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!query) return items
    return items.filter((event) =>
      [event.user.name, event.device.name, event.workNote, event.activeApp, event.activeWindow]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [items, query])
  const note = [...visible].reverse().find((event) => event.workNote)?.workNote ?? null
  const program = topProgram(visible)
  const flat = useMemo(
    () =>
      visible.flatMap((event, eventIndex) =>
        event.screenshots.map((shot, shotIndex) => ({ event, eventIndex, shot, shotIndex })),
      ),
    [visible],
  )
  const orderedShots = useMemo(() => {
    const rows = visible.map((event, eventIndex) => ({ event, eventIndex }))
    return rows.sort((left, right) => {
      const delta = +new Date(left.event.capturedAt) - +new Date(right.event.capturedAt)
      return newestFirst ? -delta : delta
    })
  }, [visible, newestFirst])
  const [shotPageNumber, setShotPage] = useListPage(
    `${day}|${userId}|${deviceId}|${teamId}|${search}|${newestFirst}`,
    orderedShots.length,
    8,
  )
  const shotPage = pageOf(orderedShots, shotPageNumber, 8)
  const groups = useMemo(
    () => groupEvents(shotPage.items, newestFirst),
    [shotPage.items, newestFirst],
  )
  const previousCount = activity.get(shiftDay(day, -1))?.count ?? 0
  const shotCount = selected?.count ?? visible.length
  const shotDelta =
    previousCount === 0 ? null : Math.round(((shotCount - previousCount) / previousCount) * 100)
  const peopleToday = new Set(visible.map((event) => event.user.id)).size
  const devicesToday = new Set(visible.map((event) => event.device.id)).size
  return (
    <section className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6ece8] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-[#1f8a5b]">
            <CameraIcon />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Screenshots</h1>
            <p className="text-sm text-[var(--sv-muted)]">
              Browse and review captured screenshots from your team.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#8aa094]">
              <SearchIcon />
            </span>
            <input
              id="screenshot-search"
              className="w-80 rounded-xl border border-[#e6ece8] bg-[#f7faf8] py-2 pr-16 pl-9 text-sm"
              placeholder="Search by user, device, or note..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md border border-[#e6ece8] bg-white px-1.5 py-0.5 text-[10px] text-[var(--sv-muted)]">
              Ctrl K
            </span>
          </label>
          <span className="grid h-10 w-10 place-items-center rounded-full border border-[#e6ece8] text-[var(--sv-muted)]">
            <BellIcon />
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-full border border-[#e6ece8] text-[var(--sv-muted)]">
            <SunIcon />
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#1f8a5b] text-xs font-semibold text-white">
            {me ? initials(me.name) : 'SV'}
          </span>
        </div>
      </header>

      <div className="px-6 py-4">
        <div className="mb-3 flex justify-end">
          <div className="grid gap-2 sm:grid-cols-3">
            <Filter
              value={userId}
              onChange={setUserId}
              empty="All people"
              options={users}
              icon="people"
            />
            <Filter
              value={deviceId}
              onChange={setDeviceId}
              empty="All devices"
              options={devices}
              icon="monitor"
            />
            <Filter
              value={teamId}
              onChange={setTeamId}
              empty="All teams"
              options={teams}
              icon="team"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-[#e6ece8] bg-white shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)]">
          <MonthStrip
            month={month}
            day={day}
            today={today}
            activity={activity}
            onMonth={(next) => setMonth(next)}
            onDay={setDay}
            onToday={() => {
              setMonth(startOfMonth(new Date()))
              setDay(localDateInput())
            }}
          />
          <div className="grid items-center gap-4 border-t border-[#eef2ef] px-5 py-5 xl:grid-cols-[minmax(12rem,0.9fr)_minmax(18rem,1.2fr)_minmax(14rem,0.8fr)]">
            <div>
              <select
                className="border-0 bg-transparent p-0 text-sm font-medium"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                aria-label="Person"
              >
                <option value="">Everyone</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-[var(--sv-muted)]">
                {selectedDate.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <Duration ms={selected ? dayTotal(selected) : 0} />
              <p className="mt-2 text-sm text-[var(--sv-muted)]">Total</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-[var(--sv-ink)]">
                {formatDuration(selected ? dayActive(selected) : 0)}
                <span className="ml-2 text-base font-medium text-[var(--sv-muted)]">active</span>
              </p>
              <p className="mt-2 text-sm text-[var(--sv-muted)]">
                Week {formatDuration(weekTotal)} · {formatDuration(weekActive)} active
              </p>
              <p className="text-sm text-[var(--sv-muted)]">
                Month {formatDuration(monthTotal)} · {formatDuration(monthActive)} active
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat
                icon={<CameraIcon />}
                value={String(shotCount)}
                label="Screenshots"
                delta={shotDelta}
              />
              <Stat icon={<PeopleIcon />} value={String(peopleToday)} label="Active users" />
              <Stat icon={<MonitorIcon />} value={String(devicesToday)} label="Devices" />
            </div>
            <div className="rounded-2xl bg-[#f6faf7] px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-[var(--sv-muted)] uppercase">
                Note
              </p>
              <p className="mt-1 truncate text-sm">{note ?? 'No note'}</p>
              <p className="mt-3 text-[11px] font-medium tracking-wide text-[var(--sv-muted)] uppercase">
                Active program
              </p>
              <p className="mt-1 flex items-center gap-2 truncate text-sm">
                <AppMark name={program ?? 'App'} />
                {program ?? 'No program recorded'}
              </p>
            </div>
          </div>
          <div className="px-5 pb-5">
            <HourBar events={items} />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
        {loading ? (
          <p className="mt-6 text-sm text-[var(--sv-muted)]">Loading screenshots…</p>
        ) : null}
        {!loading && visible.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--sv-muted)]">No screenshots on this day.</p>
        ) : null}

        <div className="mt-5 space-y-6">
          {groups.map((group, index) => (
            <section key={group.key}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">{group.label}</h2>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-[#1f8a5b]">
                    {group.shots} screenshot{group.shots === 1 ? '' : 's'}
                  </span>
                </div>
                {index === 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-xl border border-[#e6ece8] bg-white p-1">
                      <button
                        className={`grid h-8 w-8 place-items-center rounded-lg ${layout === 'grid' ? 'bg-[#16382f] text-white' : 'text-[var(--sv-muted)]'}`}
                        aria-label="Grid"
                        onClick={() => setLayout('grid')}
                      >
                        <GridIcon />
                      </button>
                      <button
                        className={`grid h-8 w-8 place-items-center rounded-lg ${layout === 'list' ? 'bg-[#16382f] text-white' : 'text-[var(--sv-muted)]'}`}
                        aria-label="List"
                        onClick={() => setLayout('list')}
                      >
                        <ListIcon />
                      </button>
                    </div>
                    <select
                      className="rounded-xl border border-[#e6ece8] bg-white px-3 py-2 text-sm"
                      value={newestFirst ? 'newest' : 'oldest'}
                      onChange={(event) => setNewestFirst(event.target.value === 'newest')}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </div>
                ) : null}
              </div>
              <div className={layout === 'grid' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
                {group.items.map((item) => (
                  <ShotCard
                    key={item.event.id}
                    item={item}
                    layout={layout}
                    onOpen={(shotIndex) => setOpen({ eventIndex: item.eventIndex, shotIndex })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <ListPagination
          page={shotPage.current}
          total={orderedShots.length}
          pageSize={8}
          onChange={setShotPage}
        />
      </div>
      {open ? (
        <Viewer
          items={flat}
          start={flat.findIndex(
            (item) => item.eventIndex === open.eventIndex && item.shotIndex === open.shotIndex,
          )}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  )
}

function Stat({
  icon,
  value,
  label,
  delta,
}: {
  icon: ReactNode
  value: string
  label: string
  delta?: number | null
}) {
  return (
    <article className="rounded-2xl border border-[#e6ece8] bg-[#fbfefc] px-3 py-3">
      <div className="flex items-center justify-between text-[#1f8a5b]">
        {icon}
        {delta != null ? (
          <span
            className={`text-[11px] font-medium ${delta >= 0 ? 'text-[#1f8a5b]' : 'text-[var(--sv-danger)]'}`}
          >
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-[var(--sv-muted)]">{label}</p>
    </article>
  )
}

function ShotCard({
  item,
  layout,
  onOpen,
}: {
  item: { event: EventItem; eventIndex: number }
  layout: 'grid' | 'list'
  onOpen: (shotIndex: number) => void
}) {
  const shots = [...item.event.screenshots].sort(
    (left, right) => left.displayIndex - right.displayIndex,
  )
  return (
    <article
      className={`rounded-2xl border border-[#e6ece8] bg-white p-2.5 shadow-[0_8px_24px_-20px_rgba(22,56,47,0.6)] ${
        layout === 'list' ? 'flex gap-3' : ''
      }`}
    >
      <div
        className={`grid gap-1.5 ${
          layout === 'list' ? 'w-72 shrink-0' : ''
        } ${shots.length > 1 ? 'grid-cols-2' : ''}`}
      >
        {shots.map((shot, shotIndex) => (
          <button key={shot.id} className="relative text-left" onClick={() => onOpen(shotIndex)}>
            <Thumb
              path={shot.thumbnailPath}
              fallback={shot.contentPath}
              alt={`${item.event.user.name} at ${formatTime(item.event.capturedAt)}`}
            />
            <span className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-lg bg-black/45 text-white">
              <ExpandIcon />
            </span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3 px-1 pt-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{formatTime(item.event.capturedAt)}</p>
          <p className="mt-2 flex items-center gap-2 truncate text-xs text-[var(--sv-muted)]">
            <AppMark name={programLabel(item.event)} />
            {programLabel(item.event)}
          </p>
          <p className="truncate text-xs text-[var(--sv-muted)]">
            {item.event.user.name} · {item.event.device.name}
            {item.event.idle ? ' · Idle' : ''}
          </p>
        </div>
        <ActiveTimeRing event={item.event} />
      </div>
    </article>
  )
}

function activeTimePercent(event: EventItem): number {
  const intervalMs = event.intervalMs && event.intervalMs > 0 ? event.intervalMs : null
  if (intervalMs != null && event.activeMs != null) {
    return Math.max(0, Math.min(100, Math.round((event.activeMs / intervalMs) * 100)))
  }
  return event.idle ? 0 : 100
}

function ActiveTimeRing({ event }: { event: EventItem }) {
  const percent = activeTimePercent(event)
  return (
    <Progress
      type="circle"
      percent={percent}
      size={22}
      strokeWidth={12}
      strokeColor="#1f8a5b"
      trailColor="#e6ece8"
      format={() => null}
      aria-label={`${percent}% active in capture interval`}
    />
  )
}

function groupEvents(items: { event: EventItem; eventIndex: number }[], newestFirst: boolean) {
  const sorted = [...items].sort((left, right) => {
    const delta = +new Date(left.event.capturedAt) - +new Date(right.event.capturedAt)
    return newestFirst ? -delta : delta
  })
  const groups: {
    key: string
    label: string
    items: typeof sorted
    shots: number
  }[] = []
  for (const item of sorted) {
    const date = new Date(item.event.capturedAt)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`
    const current = groups.at(-1)
    if (!current || current.key !== key) groups.push({ key, label: '', items: [item], shots: 0 })
    else current.items.push(item)
  }
  return groups.map((group) => {
    const ordered = [...group.items].sort(
      (left, right) => +new Date(left.event.capturedAt) - +new Date(right.event.capturedAt),
    )
    const first = ordered[0]!
    const last = ordered[ordered.length - 1]!
    const itemsInOrder = newestFirst ? ordered.reverse() : ordered
    return {
      key: group.key,
      label: `${formatTime(first.event.capturedAt)} – ${formatTime(last.event.capturedAt)}`,
      items: itemsInOrder,
      shots: itemsInOrder.reduce((sum, item) => sum + item.event.screenshots.length, 0),
    }
  })
}

function shiftDay(day: string, amount: number): string {
  const date = parseLocalDate(day)
  date.setDate(date.getDate() + amount)
  return localDateInput(date)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'SV'
}

function AppMark({ name }: { name: string }) {
  const colors = ['#1f8a5b', '#2563eb', '#7c3aed', '#d97706', '#0f766e']
  const color = colors[name.length % colors.length] ?? colors[0]
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: color }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function iconProps() {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

function CameraIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 8h3l2-2h6l2 2h3v11H4V8Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2" />
      <path d="M16 19a5 5 0 0 1 5-4" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

function TeamIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 7h16v12H4Z" />
      <path d="M8 7V5h8v2" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M8 7h12M8 12h12M8 17h12" />
      <path d="M4 7h.01M4 12h.01M4 17h.01" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg {...iconProps()} width={14} height={14}>
      <path d="M9 5h6v6" />
      <path d="M15 5 9 11" />
      <path d="M15 13v6h-6" />
      <path d="m15 19-6-6" />
    </svg>
  )
}

function Filter({
  value,
  onChange,
  empty,
  options,
  icon,
}: {
  value: string
  onChange: (value: string) => void
  empty: string
  options: Option[]
  icon: 'people' | 'monitor' | 'team'
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#7d8f86]">
        {icon === 'people' ? <PeopleIcon /> : icon === 'monitor' ? <MonitorIcon /> : <TeamIcon />}
      </span>
      <select
        className="w-full rounded-xl border border-[#e6ece8] bg-white py-2 pr-3 pl-9 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={empty}
      >
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function MonthStrip({
  month,
  day,
  today,
  activity,
  onMonth,
  onDay,
  onToday,
}: {
  month: Date
  day: string
  today: string
  activity: Map<string, DayActivity>
  onMonth: (month: Date) => void
  onDay: (day: string) => void
  onToday: () => void
}) {
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const dates = Array.from(
    { length: count },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
  )
  return (
    <div className="px-4 pt-4 md:px-6">
      <div className="flex items-center gap-2">
        <button
          className="grid h-8 w-8 place-items-center rounded-full text-lg text-[var(--sv-muted)] hover:bg-[var(--sv-paper)]"
          onClick={() => onMonth(addMonths(month, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <p className="min-w-36 text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <button
          className="grid h-8 w-8 place-items-center rounded-full text-lg text-[var(--sv-muted)] hover:bg-[var(--sv-paper)]"
          onClick={() => onMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          ›
        </button>
        <button
          className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-[#1f8a5b]"
          onClick={onToday}
        >
          Today
        </button>
      </div>
      <div className="mt-3 overflow-x-auto pb-3">
        <div className="grid min-w-[52rem] grid-flow-col auto-cols-fr">
          {dates.map((date) => {
            const key = localDateInput(date)
            const active = (activity.get(key)?.count ?? 0) > 0
            const selected = key === day
            const weekend = date.getDay() === 0 || date.getDay() === 6
            return (
              <button key={key} className="px-0.5 pb-2 text-center" onClick={() => onDay(key)}>
                <span className="block text-[10px] text-[var(--sv-muted)]">
                  {date.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span
                  className={`mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-sm ${
                    selected
                      ? 'bg-[#1f8a5b] font-semibold text-white'
                      : weekend
                        ? 'text-[var(--sv-danger)]'
                        : key === today
                          ? 'font-semibold text-[#1f8a5b]'
                          : ''
                  }`}
                >
                  {date.getDate()}
                </span>
                <span
                  className={`mx-auto mt-1 block h-1 w-4 rounded-full ${
                    active && !selected ? 'bg-[#3ddc97]' : 'bg-transparent'
                  }`}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function dayTotal(day: DayActivity): number {
  return day.totalMs ?? day.trackedMs
}

function dayActive(day: DayActivity): number {
  return day.activeMs ?? day.trackedMs
}

function Duration({ ms }: { ms: number }) {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return (
    <p className="mt-2 text-6xl leading-none font-semibold tracking-tight text-[var(--sv-ink)]">
      {hours}
      <span className="ml-1 text-3xl font-medium text-[var(--sv-muted)]">h</span>{' '}
      {String(rest).padStart(2, '0')}
      <span className="ml-1 text-3xl font-medium text-[var(--sv-muted)]">m</span>
    </p>
  )
}

function HourBar({ events }: { events: EventItem[] }) {
  const blocks = trackedBlocks(events)
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
        <div className="relative h-2 rounded-full bg-[#e6eeea]">
          {blocks.map((block) => (
            <div
              key={`${block.start}-${block.end}`}
              title={`${formatClock(block.start)} – ${formatClock(block.end)}`}
              className="absolute top-0 h-full rounded-full bg-gradient-to-r from-[var(--sv-teal)] to-[var(--sv-mint)]"
              style={{
                left: `${(block.start / 1440) * 100}%`,
                width: `${Math.max((block.end - block.start) / 1440, 0.004) * 100}%`,
              }}
            />
          ))}
        </div>
        <div className="mt-1 flex items-start gap-4">
          <div className="grid min-w-0 flex-1 grid-cols-[repeat(24,minmax(0,1fr))] text-[10px] text-[var(--sv-muted)]">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="text-center">
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-3 pt-0.5 text-[11px] text-[var(--sv-muted)]">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#1f8a5b]" /> Active
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#d7e0db]" /> Inactive
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function topProgram(events: EventItem[]): string | null {
  const counts = new Map<string, number>()
  for (const event of events) {
    const name = event.activeApp || event.activeWindow
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

function programLabel(event: EventItem): string {
  return event.activeApp || event.activeWindow || 'Active program was not recorded'
}

function localDateInput(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function activityRange(month: Date): { from: Date; to: Date } {
  const first = startOfMonth(month)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const from = new Date(first)
  from.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  from.setHours(0, 0, 0, 0)
  const to = new Date(last)
  to.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)))
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

function weekBounds(day: string): { start: string; end: string } {
  const date = parseLocalDate(day)
  const start = new Date(date)
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: localDateInput(start), end: localDateInput(end) }
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const TRACKED_GAP_MS = 15 * 60 * 1000

function trackedBlocks(events: EventItem[]): { start: number; end: number }[] {
  const sorted = [...events].sort(
    (left, right) => +new Date(left.capturedAt) - +new Date(right.capturedAt),
  )
  const blocks: { start: number; end: number }[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    const gap = +new Date(current.capturedAt) - +new Date(previous.capturedAt)
    if (previous.idle || current.idle || gap <= 0 || gap > TRACKED_GAP_MS) continue
    const start = minutesOfDay(previous.capturedAt)
    const end = minutesOfDay(current.capturedAt)
    const last = blocks.at(-1)
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end)
    else blocks.push({ start, end })
  }
  return blocks
}

function minutesOfDay(value: string): number {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24
  const minute = Math.floor(minutes % 60)
  const suffix = hour < 12 ? 'am' : 'pm'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${clock}:${String(minute).padStart(2, '0')}${suffix}`
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${clock}${suffix}`
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function Thumb({ path, fallback, alt }: { path: string; fallback?: string; alt: string }) {
  const [src, setSrc] = useState(path)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setSrc(path)
  }, [path])
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    let active = true
    setFailed(false)
    setUrl(null)
    void authorizedBlob(src, controller.signal)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setFailed(false)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted || isAbort(error)) return
        if (fallback && src !== fallback) {
          setSrc(fallback)
          return
        }
        setFailed(true)
      })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, fallback])
  if (failed) {
    return (
      <div className="grid aspect-video place-items-center rounded-xl bg-stone-200 text-xs text-[var(--sv-muted)]">
        Image unavailable
      </div>
    )
  }
  if (!url) return <div className="aspect-video animate-pulse rounded-xl bg-stone-200" />
  return (
    <img
      src={url}
      alt={alt}
      className="aspect-video w-full rounded-xl object-cover"
      onError={() => {
        if (fallback && src !== fallback) setSrc(fallback)
        else setFailed(true)
      }}
    />
  )
}

function Viewer({
  items,
  start,
  onClose,
}: {
  items: { event: EventItem; shot: Shot }[]
  start: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.max(0, start))
  const [zoom, setZoom] = useState(1)
  const [url, setUrl] = useState<string | null>(null)
  const current = items[index]
  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    let objectUrl = ''
    let active = true
    setUrl(null)
    void authorizedBlob(
      `${current.shot.contentPath}${current.shot.contentPath.includes('?') ? '&' : '?'}download=0`,
      controller.signal,
    )
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [current])
  if (!current) return null
  const monitors = current.event.screenshots
  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-stone-950/95 text-stone-100">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-semibold">{programLabel(current.event)}</p>
          <p className="text-sm text-stone-400">
            {current.event.user.name} · {formatTime(current.event.capturedAt)} ·{' '}
            {current.event.device.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {monitors.map((shot) => (
            <button
              key={shot.id}
              className="rounded-full border border-white/20 px-3 py-1 text-xs"
              onClick={() => {
                const next = items.findIndex((item) => item.shot.id === shot.id)
                if (next >= 0) setIndex(next)
              }}
            >
              {shot.displayName || `Display ${shot.displayIndex + 1}`}
            </button>
          ))}
          <button
            className="rounded-full border border-white/20 px-3 py-1 text-xs"
            onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
          >
            Zoom out
          </button>
          <button
            className="rounded-full border border-white/20 px-3 py-1 text-xs"
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            Zoom in
          </button>
          <button
            className="rounded-full border border-white/20 px-3 py-1 text-xs"
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
          >
            Previous
          </button>
          <button
            className="rounded-full border border-white/20 px-3 py-1 text-xs"
            disabled={index === items.length - 1}
            onClick={() => setIndex((value) => value + 1)}
          >
            Next
          </button>
          <a
            className="rounded-full border border-white/20 px-3 py-1 text-xs"
            href={url ?? undefined}
            download
          >
            Download
          </a>
          <button
            className="rounded-full bg-white px-3 py-1 text-xs text-stone-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>
      <div className="grid flex-1 place-items-center overflow-auto p-4">
        {url ? (
          <img
            src={url}
            alt={programLabel(current.event)}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-[80vh] max-w-full object-contain"
          />
        ) : (
          <p>Loading full screenshot…</p>
        )}
      </div>
    </div>
  )
}
