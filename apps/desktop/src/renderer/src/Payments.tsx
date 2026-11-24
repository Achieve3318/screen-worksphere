import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseButton } from './iconButtons'
import { MoneyIcon } from './MoneyIcon'

type Payee = { id: string; name: string; role: string }
type Summary = {
  week: { earned: string; used: string }
  month: { earned: string; used: string }
  remaining: string | null
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
  createdBy: { name: string }
  assignee: { name: string }
}
type Income = {
  id: string
  amount: string
  asset: string
  network: string
  notes: string
  source: 'USER' | 'BOSS'
  txUrl: string | null
  recipientKind: 'BOSS' | 'USER'
  recipient: { name: string } | null
  createdBy: { name: string }
  status: 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED'
  createdAt: string
  fileName: string | null
}
type Tab = 'request' | 'income' | 'activity' | 'manage'

const paymentAssets = [
  { id: 'USDT', label: 'USDT' },
  { id: 'USDC', label: 'USDC' },
] as const

const paymentNetworks = [
  { id: 'BNB', label: 'BNB' },
  { id: 'TRC', label: 'TRC' },
  { id: 'ERC', label: 'ERC' },
  { id: 'BASE', label: 'BASE' },
] as const

const networksForAsset: Record<string, readonly string[]> = {
  USDT: ['BNB', 'TRC', 'ERC'],
  USDC: ['BASE'],
}

const fieldClass = 'w-full rounded-xl border border-white/10 bg-[#0c121c] px-3 py-2 text-sm'

export function Payments({ role, onClose }: { role: string | null; onClose: () => void }) {
  const manager = role === 'PAYMENT_MANAGER'
  const [tab, setTab] = useState<Tab>('request')
  const [payees, setPayees] = useState<Payee[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [mine, setMine] = useState<Payment[]>([])
  const [income, setIncome] = useState<Income[]>([])
  const [incoming, setIncoming] = useState<Income[]>([])
  const [assigned, setAssigned] = useState<Payment[]>([])
  const [bossFormKey, setBossFormKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function call<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    json?: unknown,
  ): Promise<T> {
    return (await window.screenvault.payments(method, path, json)) as T
  }

  async function load() {
    const { week, month } = periods()
    const query = new URLSearchParams({
      weekFrom: week.from,
      weekTo: week.to,
      monthFrom: month.from,
      monthTo: month.to,
    })
    const [people, totals, requests, incomes] = await Promise.all([
      call<{ items: Payee[] }>('GET', '/api/v1/payments/payees'),
      call<Summary>('GET', `/api/v1/payments/summary?${query}`),
      call<{ items: Payment[] }>('GET', '/api/v1/payments/requests?scope=mine'),
      call<{ items: Income[] }>('GET', '/api/v1/payments/income?scope=mine'),
    ])
    setPayees(people.items)
    setSummary(totals)
    setMine(requests.items)
    setIncome(incomes.items)
    if (manager) {
      const [queue, received] = await Promise.all([
        call<{ items: Payment[] }>('GET', '/api/v1/payments/requests?scope=assigned'),
        call<{ items: Income[] }>('GET', '/api/v1/payments/income?scope=received'),
      ])
      setAssigned(queue.items)
      setIncoming(received.items)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function start() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await load()
          if (!cancelled) setError(null)
          return
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Payments could not be loaded.'
          const offline = message.includes('fetch failed')
          if (!offline || attempt === 3) {
            if (!cancelled) {
              setError(
                offline ? 'The server is unavailable. Close Payments and open it again.' : message,
              )
            }
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 600))
        }
      }
    }
    void start()
    const timer = window.setInterval(() => {
      if (!cancelled) void load().catch(() => undefined)
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [manager])

  async function submit(path: string, body: unknown, done: string, next: Tab = 'activity') {
    setError(null)
    try {
      await call('POST', path, body)
      setNotice(done)
      await load()
      setTab(next)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payment could not be saved.')
      return false
    }
  }

  const managers = payees.filter((person) => person.role === 'PAYMENT_MANAGER')
  const payTargets = payees.filter(
    (person) =>
      person.role === 'OWNER' || person.role === 'ADMIN' || person.role === 'PAYMENT_MANAGER',
  )

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-[#070b10] px-3.5 py-3">
      <div className="mx-auto flex w-full max-w-[440px] items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="mx-auto mt-3 flex w-full max-w-[440px] gap-1 overflow-x-auto">
        <TabButton active={tab === 'request'} onClick={() => setTab('request')}>
          Request
        </TabButton>
        <TabButton active={tab === 'income'} onClick={() => setTab('income')}>
          Income
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </TabButton>
        {manager ? (
          <TabButton active={tab === 'manage'} onClick={() => setTab('manage')}>
            Manage
          </TabButton>
        ) : null}
      </div>
      <div className="mx-auto mt-3 w-full max-w-[440px] pb-6">
        {error ? <p className="mb-3 text-sm text-rose-200">{error}</p> : null}
        {notice ? <p className="mb-3 text-sm text-[#3ddc97]">{notice}</p> : null}
        {tab === 'request' ? (
          <MoneyForm
            kind="request"
            people={payTargets}
            onSubmit={(body) =>
              void submit('/api/v1/payments/requests', body, 'Payment request sent.')
            }
          />
        ) : null}
        {tab === 'income' ? (
          <MoneyForm
            kind="income"
            people={managers}
            onSubmit={(body) =>
              void submit(
                '/api/v1/payments/income',
                { ...body, source: 'USER' },
                'Income recorded.',
              )
            }
          />
        ) : null}
        {tab === 'activity' ? (
          <Activity
            summary={summary}
            requests={mine}
            incomes={income.filter((item) => item.source !== 'BOSS')}
          />
        ) : null}
        {tab === 'manage' && manager ? (
          <Manage
            remaining={summary?.remaining ?? null}
            items={assigned}
            incoming={incoming}
            fromBoss={income.filter((item) => item.source === 'BOSS')}
            bossFormKey={bossFormKey}
            onBoss={(body) =>
              void submit(
                '/api/v1/payments/income',
                { ...body, source: 'BOSS', recipientKind: 'USER', recipientUserId: undefined },
                'Boss income added.',
                'manage',
              ).then((saved) => {
                if (saved) setBossFormKey((value) => value + 1)
              })
            }
            onStatus={async (id, status, txUrl) => {
              setError(null)
              try {
                await call('PATCH', `/api/v1/payments/requests/${id}`, {
                  status,
                  ...(status === 'PAID' ? { txUrl } : {}),
                })
                await load()
                return true
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Status could not be changed.')
                return false
              }
            }}
            onIncomeStatus={async (id, status) => {
              setError(null)
              try {
                await call('PATCH', `/api/v1/payments/income/${id}`, { status })
                await load()
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : 'Income status could not be changed.',
                )
              }
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function MoneyForm({
  kind,
  people,
  boss = false,
  onSubmit,
}: {
  kind: 'request' | 'income'
  people: Payee[]
  boss?: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [asset, setAsset] = useState('USDT')
  const [network, setNetwork] = useState('BNB')
  const [whom, setWhom] = useState(kind === 'income' ? 'BOSS' : (people[0]?.id ?? ''))
  const [notes, setNotes] = useState('')
  const [txUrl, setTxUrl] = useState('')
  const [file, setFile] = useState<{
    name: string
    contentType: string
    dataBase64: string
  } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (kind === 'request' && !whom && people[0]) setWhom(people[0].id)
  }, [kind, people, whom])

  const networks = paymentNetworks.filter((item) => networksForAsset[asset]?.includes(item.id))
  useEffect(() => {
    const allowed = networksForAsset[asset] ?? []
    if (!allowed.includes(network)) setNetwork(allowed[0] ?? 'BNB')
  }, [asset, network])

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!amount.trim()) {
          setFormError('Enter the amount.')
          return
        }
        if (kind === 'request' && !address.trim()) {
          setFormError('Enter the payment address.')
          return
        }
        if (kind === 'request' && !whom) {
          setFormError('Choose an admin or payment manager.')
          return
        }
        if (kind === 'income' && !boss && whom !== 'BOSS' && !whom) {
          setFormError('Choose who receives this income.')
          return
        }
        const link = kind === 'income' && !boss ? readableTransactionLink(txUrl) : null
        if (kind === 'income' && !boss && !link) {
          setFormError('Enter a transaction link starting with https://.')
          return
        }
        setFormError(null)
        const body: Record<string, unknown> = {
          amount: amount.trim(),
          asset,
          network,
          notes: notes.trim(),
          ...(link ? { txUrl: link } : {}),
          ...(file ? { file } : {}),
        }
        if (kind === 'request') {
          body.address = address.trim()
          body.assigneeUserId = whom
        } else if (boss) {
          body.recipientKind = 'USER'
          body.source = 'BOSS'
        } else if (whom === 'BOSS') {
          body.recipientKind = 'BOSS'
        } else {
          body.recipientKind = 'USER'
          body.recipientUserId = whom
        }
        onSubmit(body)
        setAmount('')
        setAddress('')
        setNotes('')
        setTxUrl('')
        setFile(null)
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-[#8ea0b5]">Amount</span>
        <input
          className={fieldClass}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
        />
      </label>
      {kind === 'request' ? (
        <label className="block text-sm">
          <span className="mb-1 block text-[#8ea0b5]">Address</span>
          <span className="flex gap-2">
            <input
              className={fieldClass}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10"
              aria-label="Paste address"
              onClick={() => {
                void navigator.clipboard
                  .readText()
                  .then((text) => setAddress(text.trim()))
                  .catch(() => setFormError('Clipboard could not be read.'))
              }}
            >
              <PasteIcon />
            </button>
          </span>
        </label>
      ) : null}
      <Picker label="Type" value={asset} options={paymentAssets} onChange={setAsset} />
      <Picker label="Network" value={network} options={networks} onChange={setNetwork} />
      {boss ? null : (
        <label className="block text-sm">
          <span className="mb-1 block text-[#8ea0b5]">
            {kind === 'request' ? 'Send to' : 'To whom'}
          </span>
          <select
            className={fieldClass}
            value={whom}
            onChange={(event) => setWhom(event.target.value)}
          >
            {kind === 'income' ? <option value="BOSS">Boss</option> : null}
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.role === 'PAYMENT_MANAGER'
                  ? ' · Payment manager'
                  : person.role === 'OWNER'
                    ? ' · Boss'
                    : ' · Admin'}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'income' && !boss ? (
        <label className="block text-sm">
          <span className="mb-1 block text-[#8ea0b5]">Transaction link</span>
          <input
            className={fieldClass}
            value={txUrl}
            placeholder="https://"
            onChange={(event) => setTxUrl(event.target.value)}
          />
        </label>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block text-[#8ea0b5]">Notes</span>
        <textarea
          className={`${fieldClass} min-h-20`}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <FileField file={file} onChange={setFile} />
      {formError ? <p className="text-sm text-rose-200">{formError}</p> : null}
      <button
        className="rounded-xl bg-[var(--green)] py-2.5 text-sm font-semibold text-white"
        type="submit"
      >
        {kind === 'request' ? 'Send request' : 'Add income'}
      </button>
    </form>
  )
}

function Manage({
  remaining,
  items,
  incoming,
  fromBoss,
  bossFormKey,
  onBoss,
  onStatus,
  onIncomeStatus,
}: {
  remaining: string | null
  items: Payment[]
  incoming: Income[]
  fromBoss: Income[]
  bossFormKey: number
  onBoss: (body: Record<string, unknown>) => void
  onStatus: (id: string, status: Payment['status'], txUrl?: string) => Promise<boolean>
  onIncomeStatus: (id: string, status: Income['status']) => Promise<void>
}) {
  const [section, setSection] = useState<'incoming' | 'boss' | 'requests'>('incoming')
  const sections = [
    ['incoming', 'Income Sent to You'],
    ['boss', 'Income from Boss'],
    ['requests', 'User Payment Request'],
  ] as const
  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-white/10 bg-[#121a21] px-4 py-3">
        <p className="text-xs text-[#8ea0b5]">Remaining</p>
        <p className={`text-3xl font-bold ${remaining?.startsWith('-') ? 'text-amber-200' : ''}`}>
          {remaining ?? '—'}
        </p>
        <p className="text-xs text-[#8ea0b5]">Income minus payments marked paid.</p>
      </section>
      <div className="grid grid-cols-3 gap-1">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-xl px-1.5 py-2 text-center text-xs leading-tight ${
              section === id ? 'bg-[#1f8a5b] font-medium text-white' : 'border border-white/10'
            }`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'incoming' ? (
        <div className="grid gap-2">
          <p className="text-xs text-[#8ea0b5]">Confirmed adds that amount to your balance.</p>
          {incoming.length === 0 ? (
            <p className="text-sm text-[#8ea0b5]">No income has been sent to you.</p>
          ) : null}
          {incoming.map((item) => (
            <article key={item.id} className="rounded-2xl border border-white/10 bg-[#121a21] p-3">
              <AmountRow asset={item.asset} network={item.network} amount={item.amount} />
              <p className="mt-1 text-xs text-[#8ea0b5]">From {item.createdBy.name}</p>
              <p className="mt-1 text-xs text-[#8ea0b5]">{formatPaymentDate(item.createdAt)}</p>
              {item.notes ? <p className="mt-1 text-sm">{item.notes}</p> : null}
              {item.txUrl ? <TransactionLink value={item.txUrl} /> : null}
              {item.status === 'CONFIRMED' ? (
                <p className="mt-2 text-xs font-semibold text-[#3ddc97]">Boss Confirmed</p>
              ) : (
                <select
                  className={`${fieldClass} mt-2`}
                  value={item.status}
                  onChange={(event) =>
                    void onIncomeStatus(item.id, event.target.value as Income['status'])
                  }
                >
                  <option value="PENDING">Pending</option>
                  <option value="PM_CONFIRMED">Confirmed</option>
                  <option value="SENT_TO_BOSS">Sent to boss</option>
                </select>
              )}
            </article>
          ))}
        </div>
      ) : null}
      {section === 'boss' ? (
        <div className="grid gap-3">
          <MoneyForm
            key={bossFormKey}
            kind="income"
            people={[]}
            boss
            onSubmit={(body) => onBoss(body)}
          />
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Received</p>
            {fromBoss.length === 0 ? (
              <p className="text-sm text-[#8ea0b5]">No income received from the boss yet.</p>
            ) : null}
            {fromBoss.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-white/10 bg-[#121a21] p-3"
              >
                <AmountRow asset={item.asset} network={item.network} amount={item.amount} />
                <p className="mt-1 text-xs text-[#8ea0b5]">From Boss</p>
                <p className="mt-1 text-xs text-[#8ea0b5]">{formatPaymentDate(item.createdAt)}</p>
                {item.notes ? <p className="mt-1 text-sm">{item.notes}</p> : null}
                {item.fileName ? (
                  <p className="mt-1 text-xs text-[#8ea0b5]">{item.fileName}</p>
                ) : null}
                <p className="mt-2 text-xs font-semibold text-[#3ddc97]">Confirmed</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {section === 'requests' ? (
        <div className="grid gap-2">
          {items.length === 0 ? (
            <p className="text-sm text-[#8ea0b5]">No payments are assigned to you.</p>
          ) : null}
          {items.map((item) => (
            <AssignedRequest key={item.id} item={item} onStatus={onStatus} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AssignedRequest({
  item,
  onStatus,
}: {
  item: Payment
  onStatus: (id: string, status: Payment['status'], txUrl?: string) => Promise<boolean>
}) {
  const [draftPaid, setDraftPaid] = useState(false)
  const [link, setLink] = useState(item.txUrl ?? '')
  const [linkError, setLinkError] = useState<string | null>(null)
  const asking = draftPaid || (item.status === 'PAID' && !item.txUrl)

  return (
    <article className="rounded-2xl border border-white/10 bg-[#121a21] p-3">
      <AmountRow asset={item.asset} network={item.network} amount={item.amount} />
      <p className="mt-1 text-xs text-[#8ea0b5]">From {item.createdBy.name}</p>
      <CopyAddress value={item.address} />
      <p className="mt-1 text-xs text-[#8ea0b5]">{formatPaymentDate(item.createdAt)}</p>
      {item.notes ? <p className="mt-1 text-sm">{item.notes}</p> : null}
      {item.txUrl && !draftPaid ? <TransactionLink value={item.txUrl} /> : null}
      <select
        className={`${fieldClass} mt-2`}
        value={draftPaid ? 'PAID' : item.status}
        onChange={(event) => {
          const status = event.target.value as Payment['status']
          setLinkError(null)
          if (status === 'PAID') {
            setDraftPaid(true)
            setLink(item.txUrl ?? '')
            return
          }
          setDraftPaid(false)
          void onStatus(item.id, status)
        }}
      >
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="PAID">Paid</option>
      </select>
      {asking ? (
        <label className="mt-2 block text-sm">
          <span className="mb-1 block text-xs text-[#8ea0b5]">Transaction link</span>
          <input
            className={fieldClass}
            value={link}
            placeholder="https://"
            onChange={(event) => setLink(event.target.value)}
          />
          {linkError ? <p className="mt-1 text-xs text-rose-200">{linkError}</p> : null}
          <button
            type="button"
            className="mt-2 w-full rounded-xl bg-[#1f8a5b] py-2 text-sm font-medium text-white"
            onClick={() => {
              const txUrl = readableTransactionLink(link)
              if (!txUrl) {
                setLinkError('Enter a transaction link starting with https://.')
                return
              }
              void onStatus(item.id, 'PAID', txUrl).then((saved) => {
                if (!saved) return
                setDraftPaid(false)
                setLinkError(null)
              })
            }}
          >
            Save paid
          </button>
        </label>
      ) : null}
      {item.txUrl && !draftPaid ? (
        <button
          type="button"
          className="mt-2 text-xs text-[#8ea0b5]"
          onClick={() => {
            setLink(item.txUrl ?? '')
            setDraftPaid(true)
          }}
        >
          Change link
        </button>
      ) : null}
    </article>
  )
}

function Activity({
  summary,
  requests,
  incomes,
}: {
  summary: Summary | null
  requests: Payment[]
  incomes: Income[]
}) {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <PeriodCard title="This week" earned={summary?.week.earned} used={summary?.week.used} />
        <PeriodCard title="This month" earned={summary?.month.earned} used={summary?.month.used} />
      </div>
      <p className="text-sm font-semibold">Requests</p>
      {requests.length === 0 ? <p className="text-sm text-[#8ea0b5]">No requests yet.</p> : null}
      {requests.map((item) => (
        <article key={item.id} className="rounded-2xl border border-white/10 bg-[#121a21] p-3">
          <div className="flex items-start justify-between gap-2">
            <AmountRow asset={item.asset} network={item.network} amount={item.amount} />
            <Status status={item.status} />
          </div>
          <p className="mt-1 text-xs text-[#8ea0b5]">To {item.assignee.name}</p>
          <CopyAddress value={item.address} />
          <p className="mt-1 text-xs text-[#8ea0b5]">{formatPaymentDate(item.createdAt)}</p>
          {item.txUrl ? <TransactionLink value={item.txUrl} /> : null}
          {item.fileName ? <p className="mt-1 text-xs text-[#8ea0b5]">{item.fileName}</p> : null}
        </article>
      ))}
      <p className="text-sm font-semibold">Income</p>
      {incomes.length === 0 ? <p className="text-sm text-[#8ea0b5]">No income yet.</p> : null}
      {incomes.map((item) => (
        <article key={item.id} className="rounded-2xl border border-white/10 bg-[#121a21] p-3">
          <AmountRow asset={item.asset} network={item.network} amount={item.amount} />
          <p className="mt-1 text-xs text-[#8ea0b5]">
            To{' '}
            {item.recipientKind === 'BOSS' ? 'Boss' : (item.recipient?.name ?? 'Payment manager')}
            {item.source === 'BOSS' ? ' · from Boss' : ''}
          </p>
          <p className="mt-1 text-xs text-[#8ea0b5]">{formatPaymentDate(item.createdAt)}</p>
          {item.txUrl ? <TransactionLink value={item.txUrl} /> : null}
          <p
            className={`mt-1 text-xs font-semibold ${
              item.status === 'PENDING' ? 'text-amber-200' : 'text-[#3ddc97]'
            }`}
          >
            {incomeStatusLabel(item)}
          </p>
        </article>
      ))}
    </div>
  )
}

function AmountRow({ asset, network, amount }: { asset: string; network: string; amount: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex items-center gap-1">
        <MoneyIcon id={asset} />
        <span className="text-xs">{asset}</span>
      </span>
      <span className="flex items-center gap-1">
        <MoneyIcon id={network} />
        <span className="text-xs">{network}</span>
      </span>
      <span className="font-semibold">{amount}</span>
    </div>
  )
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-1 flex items-start gap-2">
      <p className="min-w-0 flex-1 break-all font-mono text-xs text-[#8ea0b5]">{value}</p>
      <button
        type="button"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-[#d5deea]"
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

function TransactionLink({ value }: { value: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-[#8ea0b5]">Transaction link</p>
      <CopyAddress value={value} />
    </div>
  )
}

function readableTransactionLink(value: string): string | null {
  const link = value.trim()
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return link
  } catch {
    return null
  }
}

function PeriodCard({ title, earned, used }: { title: string; earned?: string; used?: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#121a21] px-3 py-2">
      <p className="text-xs text-[#8ea0b5]">{title}</p>
      <p className="mt-1 text-sm">
        Earned <span className="font-semibold text-[#3ddc97]">{earned ?? '—'}</span>
      </p>
      <p className="text-sm">
        Used <span className="font-semibold">{used ?? '—'}</span>
      </p>
    </section>
  )
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly { id: string; label: string }[]
  onChange: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-1 text-sm text-[#8ea0b5]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
              value === option.id ? 'border-[#3ddc97] bg-[#12352c]' : 'border-white/10'
            }`}
            onClick={() => onChange(option.id)}
          >
            <MoneyIcon id={option.id} size={16} />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function FileField({
  file,
  onChange,
}: {
  file: { name: string; contentType: string; dataBase64: string } | null
  onChange: (file: { name: string; contentType: string; dataBase64: string } | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  useEffect(() => {
    const form = rootRef.current?.closest('form')
    if (!form) return
    function onPaste(event: Event) {
      const pasted = clipboardImage((event as ClipboardEvent).clipboardData)
      if (!pasted) return
      event.preventDefault()
      readReferralFile(pasted, onChange, setFileError)
    }
    form.addEventListener('paste', onPaste)
    return () => form.removeEventListener('paste', onPaste)
  }, [onChange])

  return (
    <div ref={rootRef} className="block text-sm">
      <span className="mb-1 block text-[#8ea0b5]">Referral file, optional</span>
      <div
        tabIndex={0}
        className="rounded-xl border border-dashed border-white/15 bg-[#0c121c] px-3 py-3 outline-none focus:border-[#2fce7c]"
      >
        <p className="text-xs text-[#8ea0b5]">Paste a screenshot here, or choose a file.</p>
        <button
          type="button"
          className="mt-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#d5deea]"
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            event.target.value = ''
            if (!selected) return
            readReferralFile(selected, onChange, setFileError)
          }}
        />
        {file ? (
          <div className="mt-2">
            {file.contentType.startsWith('image/') ? (
              <img
                className="max-h-28 rounded-lg"
                alt=""
                src={`data:${file.contentType};base64,${file.dataBase64}`}
              />
            ) : null}
            <span className="mt-1 flex items-center justify-between gap-2 text-xs text-[#8ea0b5]">
              <span className="min-w-0 truncate">{file.name}</span>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-[#d5deea]"
                aria-label="Remove"
                onClick={() => onChange(null)}
              >
                <TrashIcon />
              </button>
            </span>
          </div>
        ) : null}
      </div>
      {fileError ? <p className="mt-1 text-xs text-rose-200">{fileError}</p> : null}
    </div>
  )
}

function clipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  const file = data.files[0]
  return file?.type.startsWith('image/') ? file : null
}

function readReferralFile(
  selected: File,
  onChange: (file: { name: string; contentType: string; dataBase64: string } | null) => void,
  setFileError: (message: string | null) => void,
) {
  if (selected.size > 8 * 1024 * 1024) {
    setFileError('The referral file must be a PDF or image under 8 MB.')
    return
  }
  void referralContentType(selected)
    .then((contentType) => {
      if (!contentType) {
        setFileError('Use a PNG, JPEG, WebP, or PDF file.')
        return
      }
      const reader = new FileReader()
      reader.onerror = () => setFileError('The file could not be read.')
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const dataBase64 = result.split(',')[1] ?? ''
        if (!dataBase64) {
          setFileError('The file could not be read.')
          return
        }
        setFileError(null)
        const extension = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] ?? 'png')
        onChange({
          name: selected.name.trim() || `screenshot.${extension}`,
          contentType,
          dataBase64,
        })
      }
      reader.readAsDataURL(selected)
    })
    .catch(() => setFileError('The file could not be read.'))
}

async function referralContentType(file: File): Promise<string | null> {
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(type)) return type
  const name = file.name.toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.pdf')) return 'application/pdf'
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const ascii = String.fromCharCode(...head)
  if (head[0] === 0x89 && ascii.startsWith('PNG', 1)) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  if (ascii.startsWith('%PDF')) return 'application/pdf'
  return null
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

function incomeStatusLabel(item: Income): string {
  if (item.source === 'USER' && item.recipientKind === 'BOSS') {
    return item.status === 'CONFIRMED' ? 'Confirmed' : 'Pending'
  }
  if (item.status === 'PM_CONFIRMED') return 'Confirmed'
  if (item.status === 'SENT_TO_BOSS') return 'Sent to boss'
  if (item.status === 'CONFIRMED' && item.recipientKind === 'USER') return 'Boss Confirmed'
  return item.status === 'CONFIRMED' ? 'Confirmed' : 'Pending'
}

function Status({ status }: { status: Payment['status'] }) {
  const label = status === 'PAID' ? 'Paid' : status === 'APPROVED' ? 'Approved' : 'Pending'
  const tone =
    status === 'PAID' ? 'text-[#3ddc97]' : status === 'APPROVED' ? 'text-sky-200' : 'text-amber-200'
  return <span className={`text-xs font-semibold ${tone}`}>{label}</span>
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1 text-sm ${active ? 'bg-[#1f8a5b] text-white' : 'text-[#8ea0b5]'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M9 7V5h6v2M8 7l1 12h6l1-12" strokeLinejoin="round" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="8" y="4" width="12" height="16" rx="2" />
      <path d="M8 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
    </svg>
  )
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
