'use client'

import { Button, DatePicker, Select } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ListPagination, pageOf, useListPage } from '../../components/ListPagination'
import { PageFrame } from '../../components/PageFrame'
import { api, authorizedBlob } from '../../lib/api'
import { reportAnswerHtml } from '../../lib/reportHtml'

type Person = { id: string; name: string; email: string }
type Answer = { fieldId?: string; label?: string; text?: string }
type Report = {
  id: string
  userId: string
  userName: string
  userEmail: string
  kind: 'DAILY' | 'WEEKLY'
  periodKey: string
  answers: Answer[]
  submittedAt: string
  confirmedAt?: string | null
}

const statuses = [
  ['today', 'Submitted today'],
  ['missing-today', 'Missing today'],
  ['week', 'Submitted this week'],
  ['missing-week', 'Missing this week'],
] as const

type ReportStatus = '' | (typeof statuses)[number][0]

export default function ReportsPage() {
  const [people, setPeople] = useState<Person[]>([])
  const [items, setItems] = useState<Report[]>([])
  const [personId, setPersonId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<ReportStatus>('')
  const [kind, setKind] = useState<'' | 'DAILY' | 'WEEKLY'>('')
  const [error, setError] = useState<string | null>(null)
  const [canConfirm, setCanConfirm] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const today = localDateKey()
  const week = weekStartKey()

  useEffect(() => {
    void api<{ items: Person[] }>('/api/v1/users')
      .then((body) => setPeople(body.items))
      .catch((caught: Error) => setError(caught.message))
    void api<{ items: Report[] }>('/api/v1/reports')
      .then((body) => setItems(body.items))
      .catch((caught: Error) => setError(caught.message))
    void api<{ role: string }>('/api/v1/auth/me')
      .then((body) => setCanConfirm(body.role === 'OWNER' || body.role === 'ADMIN'))
      .catch(() => setCanConfirm(false))
  }, [])

  async function confirm(id: string) {
    setConfirming(id)
    setError(null)
    try {
      const body = await api<{ id: string; confirmedAt: string }>(`/api/v1/reports/${id}/confirm`, {
        method: 'POST',
      })
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, confirmedAt: body.confirmedAt } : item)),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The report could not be confirmed.')
    } finally {
      setConfirming(null)
    }
  }

  const missing = status === 'missing-today' || status === 'missing-week' ? status : ''
  const missingPeople = useMemo(() => {
    if (!missing) return []
    const reportKind = missing === 'missing-today' ? 'DAILY' : 'WEEKLY'
    const period = missing === 'missing-today' ? today : week
    return people
      .filter(
        (person) =>
          (!personId || person.id === personId) && !hasReport(person.id, items, reportKind, period),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [missing, people, personId, items, today, week])
  const visible = useMemo(() => {
    if (missing) return []
    return items
      .filter((report) => {
        if (personId && report.userId !== personId) return false
        if (kind && report.kind !== kind) return false
        if (!reportInRange(report, from, to)) return false
        if (status === 'today' && !hasReport(report.userId, items, 'DAILY', today)) return false
        if (status === 'week' && !hasReport(report.userId, items, 'WEEKLY', week)) return false
        return true
      })
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  }, [missing, items, personId, kind, from, to, status, today, week])
  const listTotal = missing ? missingPeople.length : visible.length
  const [page, setPage] = useListPage(`${personId}|${from}|${to}|${status}|${kind}`, listTotal)
  const reportPage = pageOf(visible, page)
  const missingPage = pageOf(missingPeople, page)
  const submittedToday = people.filter((person) =>
    hasReport(person.id, items, 'DAILY', today),
  ).length

  return (
    <PageFrame
      title="Reports"
      subtitle={`${submittedToday} of ${people.length || 0} submitted a daily report today.`}
      icon={<NoteIcon />}
      actions={
        <div className="flex rounded-full bg-[#f3f6f4] p-1">
          {(
            [
              ['', 'All'],
              ['DAILY', 'Daily'],
              ['WEEKLY', 'Weekly'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={label}
              type="button"
              className={`rounded-full px-3 py-1 text-sm ${
                kind === id
                  ? 'bg-white font-medium text-[#1f8a5b] shadow-sm'
                  : 'text-[var(--sv-muted)]'
              }`}
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
      <ReportFilters
        personId={personId}
        people={people}
        from={from}
        to={to}
        status={status}
        onPerson={setPersonId}
        onFrom={setFrom}
        onTo={setTo}
        onStatus={setStatus}
        onClear={() => {
          setPersonId('')
          setFrom('')
          setTo('')
          setStatus('')
        }}
      />
      {missing ? (
        missingPeople.length === 0 ? (
          <EmptyReports
            text={people.length === 0 ? 'No people yet.' : 'Nothing matches these filters.'}
          />
        ) : (
          <div className="grid gap-3">
            {missingPage.items.map((person) => (
              <article
                key={person.id}
                className="rounded-3xl border border-[#e6ece8] bg-white px-5 py-4 shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)]"
              >
                <h2 className="text-lg font-semibold">{person.name}</h2>
                <p className="text-sm text-[var(--sv-muted)]">{person.email}</p>
                <p className="mt-2 text-sm text-amber-700">
                  {missing === 'missing-today' ? 'No report today.' : 'No report this week.'}
                </p>
              </article>
            ))}
            <ListPagination
              page={missingPage.current}
              total={missingPeople.length}
              onChange={setPage}
            />
          </div>
        )
      ) : (
        <div className="grid gap-3">
          {visible.length === 0 ? (
            <EmptyReports
              text={items.length === 0 ? kindEmpty(kind) : 'Nothing matches these filters.'}
            />
          ) : (
            reportPage.items.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                today={today}
                week={week}
                canConfirm={canConfirm}
                confirming={confirming === report.id}
                onConfirm={() => void confirm(report.id)}
              />
            ))
          )}
          <ListPagination page={reportPage.current} total={visible.length} onChange={setPage} />
        </div>
      )}
    </PageFrame>
  )
}

function ReportFilters(props: {
  personId: string
  people: Person[]
  from: string
  to: string
  status: ReportStatus
  onPerson: (value: string) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onStatus: (value: ReportStatus) => void
  onClear: () => void
}) {
  const active = Boolean(props.personId || props.from || props.to || props.status)
  return (
    <div className="mb-4 grid items-end gap-3 rounded-3xl border border-[#e6ece8] bg-white p-3 sm:grid-cols-2 xl:grid-cols-3">
      <FilterField label="Person">
        <Select
          allowClear
          placeholder="Anyone"
          style={{ width: '100%' }}
          value={props.personId || undefined}
          options={[...props.people]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((person) => ({ value: person.id, label: `${person.name} · ${person.email}` }))}
          onChange={(value) => props.onPerson(value ?? '')}
        />
      </FilterField>
      <FilterField label="Date">
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          placeholder={['From', 'To']}
          style={{ width: '100%' }}
          value={[props.from ? dayjs(props.from) : null, props.to ? dayjs(props.to) : null]}
          onChange={(dates) => {
            props.onFrom(dates?.[0] ? dates[0].format('YYYY-MM-DD') : '')
            props.onTo(dates?.[1] ? dates[1].format('YYYY-MM-DD') : '')
          }}
        />
      </FilterField>
      <FilterField label="Status">
        <Select
          allowClear
          placeholder="Any status"
          style={{ width: '100%' }}
          value={props.status || undefined}
          options={statuses.map(([value, label]) => ({ value, label }))}
          onChange={(value) => props.onStatus(value ?? '')}
        />
      </FilterField>
      {active ? (
        <Button
          type="link"
          className="justify-start px-0 sm:col-span-2 xl:col-span-3"
          onClick={props.onClear}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-[var(--sv-muted)]">{label}</span>
      {children}
    </label>
  )
}

function ReportAnswer({ text }: { text: string }) {
  const html = reportAnswerHtml(text)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let cancelled = false
    const urls: string[] = []
    for (const image of root.querySelectorAll('img')) {
      const path = image.getAttribute('src') || ''
      if (!path.startsWith('/api/v1/reports/images/')) continue
      void authorizedBlob(path)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
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
  }, [html])
  return (
    <div
      ref={ref}
      className="report-answer mt-1.5 text-[15px] leading-6 text-[#16382f]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ReportCard({
  report,
  today,
  week,
  canConfirm,
  confirming,
  onConfirm,
}: {
  report: Report
  today: string
  week: string
  canConfirm: boolean
  confirming: boolean
  onConfirm: () => void
}) {
  const current = report.kind === 'DAILY' ? report.periodKey === today : report.periodKey === week
  const answers = Array.isArray(report.answers) ? report.answers : []
  const confirmed = Boolean(report.confirmedAt)
  return (
    <article className="rounded-3xl border border-[#e6ece8] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#16382f]">{report.userName}</span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              report.kind === 'DAILY'
                ? 'bg-emerald-50 text-[#1f8a5b]'
                : 'bg-violet-50 text-violet-700'
            }`}
          >
            {report.kind === 'DAILY' ? 'Daily' : 'Weekly'}
          </span>
          {current ? (
            <span className="rounded-full bg-[#f3f6f4] px-2.5 py-1 text-xs font-medium text-[#16382f]">
              Current
            </span>
          ) : null}
          {confirmed ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#1f8a5b]">
              Confirmed
            </span>
          ) : null}
        </div>
        <p className="text-sm text-[var(--sv-muted)]">
          {formatPeriod(report.kind, report.periodKey)} · {formatWhen(report.submittedAt)}
        </p>
      </div>
      <div className="mt-4 grid gap-4">
        {answers.map((answer, index) => (
          <div key={answer.fieldId ?? index} className="rounded-2xl bg-[#f7faf8] px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-[#1f8a5b] uppercase">
              {answer.label || 'Prompt'}
            </p>
            <ReportAnswer text={answer.text || ''} />
          </div>
        ))}
      </div>
      {canConfirm && !confirmed ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-xl bg-[#1f8a5b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      ) : null}
    </article>
  )
}

function EmptyReports({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-[#e6ece8] bg-white p-5 text-sm text-[var(--sv-muted)] shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)]">
      {text}
    </div>
  )
}

function kindEmpty(kind: '' | 'DAILY' | 'WEEKLY'): string {
  if (kind === 'DAILY') return 'No daily reports yet.'
  if (kind === 'WEEKLY') return 'No weekly reports yet.'
  return 'No reports yet.'
}

function reportInRange(report: Report, from: string, to: string): boolean {
  if (!from && !to) return true
  const start = report.periodKey
  const end = report.kind === 'WEEKLY' ? addDays(start, 6) : start
  if (from && end < from) return false
  if (to && start > to) return false
  return true
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function hasReport(
  userId: string,
  items: Report[],
  kind: Report['kind'],
  periodKey: string,
): boolean {
  return items.some(
    (item) => item.userId === userId && item.kind === kind && item.periodKey === periodKey,
  )
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

function formatPeriod(kind: Report['kind'], key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  if (kind === 'WEEKLY') {
    return `Week of ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}`
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

function NoteIcon() {
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
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M8 13h8M8 17h6" strokeLinecap="round" />
    </svg>
  )
}
