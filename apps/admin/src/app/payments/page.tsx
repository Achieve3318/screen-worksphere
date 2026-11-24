'use client'

import { Button, DatePicker, Input, Select } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState, type ReactNode } from 'react'
import { ListPagination, pageOf, useListPage } from '../../components/ListPagination'
import { PageFrame } from '../../components/PageFrame'
import { MoneyIcon } from '../../components/MoneyIcon'
import { api, authorizedBlob } from '../../lib/api'

type Summary = {
  week: { earned: string; used: string }
  month: { earned: string; used: string }
  orgWeek: { earned: string; used: string } | null
  orgMonth: { earned: string; used: string } | null
  remaining: string | null
  bossRemaining: string | null
  totalIncome: string | null
  totalUsed: string | null
  managers:
    { userId: string; name: string; income: string; paid: string; remaining: string }[] | null
}

type Payment = {
  id: string
  address: string
  asset: string
  network: string
  amount: string
  notes: string
  status: 'PENDING' | 'APPROVED' | 'PAID'
  txUrl: string | null
  fileName: string | null
  createdAt: string
  createdBy: { id: string; name: string }
  assignee: { id: string; name: string }
}

type Income = {
  id: string
  source: 'USER' | 'BOSS'
  recipientKind: 'BOSS' | 'USER'
  asset: string
  network: string
  amount: string
  notes: string
  txUrl: string | null
  fileName: string | null
  status: 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED'
  createdAt: string
  createdBy: { name: string }
  recipient: { name: string } | null
}

export default function PaymentsPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [requests, setRequests] = useState<Payment[]>([])
  const [incomes, setIncomes] = useState<Income[]>([])
  const [tab, setTab] = useState<'requests' | 'income'>('requests')
  const [error, setError] = useState<string | null>(null)
  const [person, setPerson] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [asset, setAsset] = useState('')
  const [network, setNetwork] = useState('')

  function load() {
    const { week, month } = periods()
    const summaryQuery = new URLSearchParams({
      weekFrom: week.from,
      weekTo: week.to,
      monthFrom: month.from,
      monthTo: month.to,
    })
    void api<Summary>(`/api/v1/payments/summary?${summaryQuery}`)
      .then(setSummary)
      .catch((caught: Error) => setError(caught.message))
    void api<{ items: Payment[] }>('/api/v1/payments/requests?scope=all')
      .then((body) => setRequests(body.items))
      .catch((caught: Error) => setError(caught.message))
    void api<{ items: Income[] }>('/api/v1/payments/income?scope=all')
      .then((body) => setIncomes(body.items))
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [])

  const visibleRequests = requests.filter((item) =>
    matchesFilters(item, {
      person,
      people: [item.createdBy.name, item.assignee.name],
      from,
      to,
      status,
      asset,
      network,
    }),
  )
  const visibleIncomes = incomes.filter((item) =>
    matchesFilters(item, {
      person,
      people: [
        item.createdBy.name,
        item.recipientKind === 'BOSS' ? 'Boss' : (item.recipient?.name ?? 'Payment manager'),
      ],
      from,
      to,
      status,
      asset,
      network,
    }),
  )
  const list = tab === 'requests' ? visibleRequests : visibleIncomes
  const [page, setPage] = useListPage(
    `${tab}|${person}|${from}|${to}|${status}|${asset}|${network}`,
    list.length,
  )
  const requestPage = pageOf(visibleRequests, page)
  const incomePage = pageOf(visibleIncomes, page)

  return (
    <PageFrame
      title="Payments"
      subtitle="Income in, payments out. Remaining is income minus what has been marked paid."
      icon={<WalletIcon />}
      actions={
        <div className="flex rounded-full bg-[#f3f6f4] p-1">
          {(
            [
              ['requests', 'Requests'],
              ['income', 'Income'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-full px-3 py-1 text-sm ${
                tab === id
                  ? 'bg-white font-medium text-[#1f8a5b] shadow-sm'
                  : 'text-[var(--sv-muted)]'
              }`}
              onClick={() => {
                setStatus('')
                setTab(id)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total income" value={summary?.totalIncome} />
        <Stat label="Total used" value={summary?.totalUsed} />
        <Stat label="Remaining" value={summary?.remaining} emphasize />
        <Stat label="Boss remaining" value={summary?.bossRemaining} />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Period label="This week" earned={summary?.orgWeek?.earned} used={summary?.orgWeek?.used} />
        <Period
          label="This month"
          earned={summary?.orgMonth?.earned}
          used={summary?.orgMonth?.used}
        />
      </div>
      {summary?.managers && summary.managers.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.managers.map((manager) => (
            <article
              key={manager.userId}
              className="rounded-2xl border border-[#e6ece8] bg-white px-4 py-3"
            >
              <p className="text-sm font-medium">{manager.name}</p>
              <p className="mt-1 text-xs text-[var(--sv-muted)]">
                Income {manager.income} · Paid {manager.paid}
              </p>
              <p
                className={`mt-2 text-xl font-semibold ${negative(manager.remaining) ? 'text-amber-700' : ''}`}
              >
                {manager.remaining}
              </p>
              <p className="text-xs text-[var(--sv-muted)]">Remaining</p>
            </article>
          ))}
        </div>
      ) : null}
      <PaymentFilters
        person={person}
        people={peopleFor(tab, requests, incomes)}
        from={from}
        to={to}
        status={status}
        statuses={tab === 'requests' ? requestStatuses : incomeStatuses}
        asset={asset}
        assets={uniqueValues(
          tab === 'requests' ? requests : incomes,
          (item: { asset: string }) => item.asset,
        )}
        network={network}
        networks={uniqueValues(
          tab === 'requests' ? requests : incomes,
          (item: { network: string }) => item.network,
        )}
        onPerson={setPerson}
        onFrom={setFrom}
        onTo={setTo}
        onStatus={setStatus}
        onAsset={setAsset}
        onNetwork={setNetwork}
        onClear={() => {
          setPerson('')
          setFrom('')
          setTo('')
          setStatus('')
          setAsset('')
          setNetwork('')
        }}
      />
      {tab === 'requests' ? (
        <div className="grid gap-3">
          {requests.length === 0 ? <Empty text="No payment requests yet." /> : null}
          {requests.length > 0 && visibleRequests.length === 0 ? (
            <Empty text="Nothing matches these filters." />
          ) : null}
          {requestPage.items.map((item) => (
            <article key={item.id} className="rounded-3xl border border-[#e6ece8] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MoneyIcon id={item.asset} />
                    <MoneyIcon id={item.network} />
                    <p className="text-lg font-semibold">{item.amount}</p>
                    <p className="text-sm text-[var(--sv-muted)]">
                      {item.asset} · {item.network}
                    </p>
                  </div>
                  <p className="mt-2 text-sm">
                    {item.createdBy.name} → {item.assignee.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--sv-muted)]">
                    {formatPaymentDate(item.createdAt)}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-[var(--sv-muted)]">
                    {item.address}
                  </p>
                  {item.notes ? (
                    <p className="mt-2 text-sm whitespace-pre-wrap">{item.notes}</p>
                  ) : null}
                  {item.txUrl ? (
                    <div className="mt-2">
                      <p className="text-xs text-[var(--sv-muted)]">Transaction link</p>
                      <div className="mt-1 flex items-start gap-2">
                        <p className="min-w-0 flex-1 break-all font-mono text-xs">{item.txUrl}</p>
                        <CopyText value={item.txUrl} />
                      </div>
                    </div>
                  ) : null}
                  {item.fileName ? (
                    <button
                      className="mt-2 text-sm text-[#1f8a5b]"
                      onClick={() =>
                        void download(
                          `/api/v1/payments/requests/${item.id}/file`,
                          item.fileName ?? 'referral',
                        )
                      }
                    >
                      {item.fileName}
                    </button>
                  ) : null}
                </div>
                <RequestActions
                  item={item}
                  onSaved={load}
                  onError={(message) => setError(message)}
                />
              </div>
            </article>
          ))}
          <ListPagination page={requestPage.current} total={visibleRequests.length} onChange={setPage} />
        </div>
      ) : (
        <div className="grid gap-3">
          {incomes.length === 0 ? <Empty text="No income recorded yet." /> : null}
          {incomes.length > 0 && visibleIncomes.length === 0 ? (
            <Empty text="Nothing matches these filters." />
          ) : null}
          {incomePage.items.map((item) => {
            const sentToManager = item.source === 'USER' && item.recipientKind === 'USER'
            const sentToBoss = item.source === 'USER' && item.recipientKind === 'BOSS'
            return (
              <article key={item.id} className="rounded-3xl border border-[#e6ece8] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MoneyIcon id={item.asset} />
                      <MoneyIcon id={item.network} />
                      <p className="text-lg font-semibold">{item.amount}</p>
                      <p className="text-sm text-[var(--sv-muted)]">
                        {item.asset} · {item.network}
                      </p>
                    </div>
                    <p className="mt-2 text-sm">
                      {item.createdBy.name} →{' '}
                      {item.recipientKind === 'BOSS'
                        ? 'Boss'
                        : (item.recipient?.name ?? 'Payment manager')}
                      {item.source === 'BOSS' ? ' · from Boss' : ''}
                    </p>
                    <p className="mt-1 text-xs text-[var(--sv-muted)]">
                      {formatPaymentDate(item.createdAt)}
                    </p>
                    {item.notes ? (
                      <p className="mt-2 text-sm whitespace-pre-wrap">{item.notes}</p>
                    ) : null}
                    {item.txUrl ? (
                      <div className="mt-2">
                        <p className="text-xs text-[var(--sv-muted)]">Transaction link</p>
                        <div className="mt-1 flex items-start gap-2">
                          <p className="min-w-0 flex-1 break-all font-mono text-xs">{item.txUrl}</p>
                          <CopyText value={item.txUrl} />
                        </div>
                      </div>
                    ) : null}
                    {item.fileName ? (
                      <button
                        className="mt-2 text-sm text-[#1f8a5b]"
                        onClick={() =>
                          void download(
                            `/api/v1/payments/income/${item.id}/file`,
                            item.fileName ?? 'referral',
                          )
                        }
                      >
                        {item.fileName}
                      </button>
                    ) : null}
                  </div>
                  {sentToManager || sentToBoss ? (
                    <Select
                      style={{ minWidth: 220 }}
                      value={
                        sentToBoss
                          ? item.status === 'CONFIRMED'
                            ? 'CONFIRMED'
                            : 'PENDING'
                          : item.status
                      }
                      options={
                        sentToBoss
                          ? [
                              { value: 'PENDING', label: 'Pending' },
                              { value: 'CONFIRMED', label: 'Confirmed' },
                            ]
                          : incomeStatuses.map(([value, label]) => ({ value, label }))
                      }
                      onChange={(status) => {
                        void api(`/api/v1/payments/income/${item.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status }),
                        })
                          .then(load)
                          .catch((caught: Error) => setError(caught.message))
                      }}
                    />
                  ) : (
                    <p className="text-sm font-medium text-[#1f8a5b]">Confirmed</p>
                  )}
                </div>
              </article>
            )
          })}
          <ListPagination page={incomePage.current} total={visibleIncomes.length} onChange={setPage} />
        </div>
      )}
    </PageFrame>
  )
}

function formatPaymentDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function RequestActions({
  item,
  onSaved,
  onError,
}: {
  item: Payment
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [draftPaid, setDraftPaid] = useState(false)
  const [link, setLink] = useState(item.txUrl ?? '')
  const asking = draftPaid || (item.status === 'PAID' && !item.txUrl)

  async function save(status: Payment['status'], txUrl?: string) {
    await api(`/api/v1/payments/requests/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify(status === 'PAID' ? { status, txUrl } : { status }),
    })
    setDraftPaid(false)
    onSaved()
  }

  return (
    <div className="grid min-w-56 gap-2">
      <Select
        style={{ width: '100%' }}
        value={draftPaid ? 'PAID' : item.status}
        options={requestStatuses.map(([value, label]) => ({ value, label }))}
        onChange={(status: Payment['status']) => {
          if (status === 'PAID') {
            setDraftPaid(true)
            setLink(item.txUrl ?? '')
            return
          }
          setDraftPaid(false)
          void save(status).catch((caught: Error) => onError(caught.message))
        }}
      />
      {asking ? (
        <>
          <Input
            value={link}
            placeholder="https://"
            onChange={(event) => setLink(event.target.value)}
          />
          <Button
            type="primary"
            block
            onClick={() => {
              const txUrl = link.trim()
              let url: URL | null = null
              try {
                url = txUrl ? new URL(txUrl) : null
              } catch {
                url = null
              }
              if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
                onError('Enter a transaction link starting with https://.')
                return
              }
              void save('PAID', txUrl).catch((caught: Error) => onError(caught.message))
            }}
          >
            Save paid
          </Button>
        </>
      ) : null}
      {item.txUrl && !draftPaid ? (
        <Button
          type="link"
          size="small"
          className="justify-start px-0"
          onClick={() => {
            setLink(item.txUrl ?? '')
            setDraftPaid(true)
          }}
        >
          Change link
        </Button>
      ) : null}
    </div>
  )
}

const requestStatuses = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Approved'],
  ['PAID', 'Paid'],
] as const

const incomeStatuses = [
  ['PENDING', 'Pending'],
  ['PM_CONFIRMED', 'Payment Manager confirmed'],
  ['SENT_TO_BOSS', 'Pending for Admin'],
  ['CONFIRMED', 'Confirmed'],
] as const

function peopleFor(tab: 'requests' | 'income', requests: Payment[], incomes: Income[]): string[] {
  const names = new Set<string>()
  if (tab === 'requests') {
    for (const item of requests) {
      names.add(item.createdBy.name)
      names.add(item.assignee.name)
    }
  } else {
    for (const item of incomes) {
      names.add(item.createdBy.name)
      names.add(
        item.recipientKind === 'BOSS' ? 'Boss' : (item.recipient?.name ?? 'Payment manager'),
      )
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right))
}

function uniqueValues<T>(items: T[], read: (item: T) => string): string[] {
  return [...new Set(items.map(read))].sort((left, right) => left.localeCompare(right))
}

function matchesFilters(
  item: { createdAt: string; status: string; asset: string; network: string },
  filters: {
    person: string
    people: string[]
    from: string
    to: string
    status: string
    asset: string
    network: string
  },
): boolean {
  if (filters.person && !filters.people.includes(filters.person)) return false
  if (filters.status && item.status !== filters.status) return false
  if (filters.asset && item.asset !== filters.asset) return false
  if (filters.network && item.network !== filters.network) return false
  const day = localDay(item.createdAt)
  if (filters.from && day < filters.from) return false
  if (filters.to && day > filters.to) return false
  return true
}

function localDay(value: string): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function PaymentFilters(props: {
  person: string
  people: string[]
  from: string
  to: string
  status: string
  statuses: readonly (readonly string[])[]
  asset: string
  assets: string[]
  network: string
  networks: string[]
  onPerson: (value: string) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onStatus: (value: string) => void
  onAsset: (value: string) => void
  onNetwork: (value: string) => void
  onClear: () => void
}) {
  const active = Boolean(
    props.person || props.from || props.to || props.status || props.asset || props.network,
  )
  return (
    <div className="mb-4 grid items-end gap-3 rounded-3xl border border-[#e6ece8] bg-white p-3 sm:grid-cols-2 xl:grid-cols-5">
      <FilterField label="Person">
        <Select
          allowClear
          placeholder="Anyone"
          style={{ width: '100%' }}
          value={props.person || undefined}
          options={props.people.map((name) => ({ value: name, label: name }))}
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
          options={props.statuses.map(([value, label]) => ({ value, label }))}
          onChange={(value) => props.onStatus(value ?? '')}
        />
      </FilterField>
      <FilterField label="Type">
        <Select
          allowClear
          placeholder="Any type"
          style={{ width: '100%' }}
          value={props.asset || undefined}
          options={props.assets.map((id) => ({ value: id, label: id }))}
          onChange={(value) => props.onAsset(value ?? '')}
        />
      </FilterField>
      <FilterField label="Network">
        <Select
          allowClear
          placeholder="Any network"
          style={{ width: '100%' }}
          value={props.network || undefined}
          options={props.networks.map((id) => ({ value: id, label: id }))}
          onChange={(value) => props.onNetwork(value ?? '')}
        />
      </FilterField>
      {active ? (
        <Button
          type="link"
          className="justify-start px-0 sm:col-span-2 xl:col-span-5"
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

function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-[#e6ece8] px-2 py-0.5 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function Stat({
  label,
  value,
  emphasize = false,
}: {
  label: string
  value?: string | null
  emphasize?: boolean
}) {
  return (
    <article className="rounded-2xl border border-[#e6ece8] bg-white px-4 py-3">
      <p className="text-xs text-[var(--sv-muted)]">{label}</p>
      <p
        className={`mt-1 font-semibold ${emphasize ? 'text-2xl' : 'text-xl'} ${negative(value) ? 'text-amber-700' : ''}`}
      >
        {value ?? '—'}
      </p>
    </article>
  )
}

function Period({ label, earned, used }: { label: string; earned?: string; used?: string }) {
  return (
    <article className="rounded-2xl border border-[#e6ece8] bg-white px-4 py-3">
      <p className="text-xs text-[var(--sv-muted)]">{label}</p>
      <p className="mt-1 text-sm">
        Earned <span className="font-semibold">{earned ?? '—'}</span>
        <span className="mx-2 text-[var(--sv-muted)]">·</span>
        Used <span className="font-semibold">{used ?? '—'}</span>
      </p>
    </article>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-[#e6ece8] bg-white p-5 text-sm text-[var(--sv-muted)]">
      {text}
    </div>
  )
}

function negative(value?: string | null): boolean {
  return Boolean(value?.startsWith('-'))
}

function periods() {
  const now = new Date()
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const weekFrom = new Date(now)
  weekFrom.setHours(0, 0, 0, 0)
  const day = weekFrom.getDay()
  weekFrom.setDate(weekFrom.getDate() + (day === 0 ? -6 : 1 - day))
  const weekTo = new Date(weekFrom)
  weekTo.setDate(weekTo.getDate() + 7)
  return {
    week: { from: weekFrom.toISOString(), to: weekTo.toISOString() },
    month: { from: monthFrom.toISOString(), to: monthTo.toISOString() },
  }
}

async function download(path: string, name: string) {
  const blob = await authorizedBlob(path)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function WalletIcon() {
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
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16" cy="15" r="1" fill="currentColor" />
    </svg>
  )
}
