import { useEffect, useRef, useState } from 'react'
import { BackButton, CloseButton } from './iconButtons'

type Kind = 'DAILY' | 'WEEKLY'

type Answer = { fieldId: string; label: string; text: string }

type ReportItem = {
  id: string
  kind: Kind
  periodKey: string
  answers: Answer[]
  submittedAt: string
  confirmedAt: string | null
}

function readableError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : 'Reports could not be loaded.'
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

async function history<T>(path: string): Promise<T> {
  const call = window.screenvault.reportHistory
  if (typeof call !== 'function') {
    throw new Error('Quit WorkSphere completely, open it again, then open report history.')
  }
  return (await call(path)) as T
}

export function Reports({
  onClose,
  onEdit,
}: {
  onClose: () => void
  onEdit: (kind: Kind) => void
}) {
  const [kind, setKind] = useState<Kind>('DAILY')
  const [items, setItems] = useState<ReportItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const visible = items.filter((item) => item.kind === kind)
  const selected = items.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const body = await history<{ items: ReportItem[] }>('/api/v1/reports/mine')
        if (stop) return
        setItems(Array.isArray(body.items) ? body.items : [])
        setError(null)
      } catch (caught) {
        if (!stop) setError(readableError(caught))
      } finally {
        if (!stop) setLoading(false)
      }
    }
    void load()
    return () => {
      stop = true
    }
  }, [])

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-[#070b10] px-3.5 py-3">
      <div className="mx-auto flex w-full max-w-[440px] items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {selected ? <BackButton onClick={() => setSelectedId(null)} /> : null}
          <h2 className="truncate text-lg font-semibold">
            {selected ? formatPeriod(selected.kind, selected.periodKey) : 'Reports'}
          </h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {error ? (
        <p className="mx-auto mt-3 w-full max-w-[440px] rounded-2xl border border-rose-400/30 bg-rose-950/50 px-3 py-2 text-[13px] text-rose-100">
          {error}
        </p>
      ) : null}

      {selected ? (
        <ReportDetail item={selected} onEdit={() => onEdit(selected.kind)} />
      ) : (
        <div className="mx-auto mt-3 w-full max-w-[440px] pb-6">
          <div className="flex gap-1">
            <TabButton active={kind === 'DAILY'} onClick={() => setKind('DAILY')}>
              Daily
            </TabButton>
            <TabButton active={kind === 'WEEKLY'} onClick={() => setKind('WEEKLY')}>
              Weekly
            </TabButton>
          </div>
          <div className="mt-3 grid gap-2">
            {loading ? <p className="px-1 text-sm text-[#8ea0b5]">Loading reports…</p> : null}
            {!loading && visible.length === 0 ? (
              <p className="rounded-2xl border border-white/5 bg-[var(--card)] px-3 py-4 text-sm text-[#8ea0b5]">
                {kind === 'DAILY' ? 'No daily reports yet.' : 'No weekly reports yet.'}
              </p>
            ) : null}
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                className="rounded-2xl border border-white/5 bg-[var(--card)] px-3 py-2.5 text-left"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold">
                    {formatPeriod(item.kind, item.periodKey)}
                  </span>
                  <Status confirmed={Boolean(item.confirmedAt)} current={isCurrent(item)} />
                </span>
                <span className="mt-0.5 block text-[12px] text-[#8ea0b5]">
                  Submitted {formatWhen(item.submittedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ReportDetail({ item, onEdit }: { item: ReportItem; onEdit: () => void }) {
  const current = isCurrent(item)
  const editable = current && !item.confirmedAt
  return (
    <div className="mx-auto mt-3 w-full max-w-[440px] pb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12px] text-[#8ea0b5]">Submitted {formatWhen(item.submittedAt)}</p>
        <Status confirmed={Boolean(item.confirmedAt)} current={current} />
      </div>
      <div className="grid gap-3">
        {item.answers.map((answer, index) => (
          <div key={answer.fieldId || index} className="rounded-2xl bg-[var(--card)] px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-wide text-[#3ddc97] uppercase">
              {answer.label || 'Prompt'}
            </p>
            <ReportBody text={answer.text} />
          </div>
        ))}
      </div>
      {item.confirmedAt ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-[#d5deea]">
          An admin confirmed this report, so it can no longer be edited.
        </p>
      ) : null}
      {editable ? (
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-[var(--green)] py-2.5 text-sm font-semibold text-white"
          onClick={onEdit}
        >
          Edit this report
        </button>
      ) : null}
    </div>
  )
}

function ReportBody({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = /<\/?[a-z][^>]*>/i.test(text)
  useEffect(() => {
    const root = ref.current
    if (!root || !html) return
    let cancelled = false
    const urls: string[] = []
    for (const image of root.querySelectorAll('img')) {
      const src = image.getAttribute('src') ?? ''
      if (!/^\/api\/v1\/reports\/images\/[0-9a-f-]{36}$/i.test(src)) {
        image.removeAttribute('src')
        continue
      }
      void window.screenvault
        .readReportImage(src)
        .then((file) => {
          if (cancelled) return
          const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }))
          urls.push(url)
          image.src = url
        })
        .catch(() => {
          if (!cancelled) image.alt = 'Image unavailable'
        })
    }
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [text, html])
  if (!html) return <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6">{text}</p>
  return <div ref={ref} className="report-history mt-1" dangerouslySetInnerHTML={{ __html: text }} />
}

function Status({ confirmed, current }: { confirmed: boolean; current: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {current ? (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-[#d5deea]">
          Current
        </span>
      ) : null}
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          confirmed ? 'bg-[#12352c] text-[#3ddc97]' : 'text-[#8ea0b5]'
        }`}
      >
        {confirmed ? 'Confirmed' : 'Submitted'}
      </span>
    </span>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1 text-sm ${
        active ? 'bg-[#1f8a5b] text-white' : 'text-[#8ea0b5]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function isCurrent(item: ReportItem): boolean {
  return item.kind === 'DAILY'
    ? item.periodKey === localDateKey()
    : item.periodKey === weekStartKey()
}

function localDateKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function weekStartKey(date = new Date()): string {
  const copy = new Date(date)
  copy.setHours(12, 0, 0, 0)
  const day = copy.getDay()
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day))
  return localDateKey(copy)
}

function formatPeriod(kind: Kind, key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  if (kind === 'WEEKLY') {
    const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
    return `Week of ${label}`
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
