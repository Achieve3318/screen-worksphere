import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BackButton, CloseButton } from './iconButtons'

type Person = {
  id: string
  name: string
  email: string
  lastBody: string | null
  lastAt: string | null
  unread: number
}

type Line = {
  id: string
  senderId: string
  body: string
  createdAt: string
}

function readableError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : 'Something went wrong.'
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

async function chat<T>(method: 'GET' | 'POST', path: string, json?: unknown): Promise<T> {
  const call = window.screenvault.chat
  if (typeof call !== 'function') {
    throw new Error('Quit WorkSphere completely, open it again, then open chat.')
  }
  return (await call(method, path, json)) as T
}

export function Chat({
  selfName,
  onClose,
  onUnread,
}: {
  selfName: string
  onClose: () => void
  onUnread: (count: number) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [peerId, setPeerId] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const seen = useRef('')
  const peer = people.find((person) => person.id === peerId) ?? null

  useEffect(() => {
    let stop = false
    async function loadPeople() {
      try {
        const body = await chat<{ items: Person[] }>('GET', '/api/v1/chat/inbox')
        if (stop) return
        setPeople(body.items)
        onUnread(body.items.reduce((sum, person) => sum + person.unread, 0))
      } catch (caught) {
        if (!stop) setError(readableError(caught))
      }
    }
    void loadPeople()
    const timer = window.setInterval(() => void loadPeople(), 3000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [onUnread])

  useEffect(() => {
    if (!peerId) return
    seen.current = ''
    let stop = false
    async function loadMessages() {
      try {
        const body = await chat<{ items: Line[] }>(
          'GET',
          `/api/v1/chat/messages?with=${peerId}`,
        )
        if (stop) return
        setLines(body.items)
        setError(null)
        const latest = body.items.at(-1)?.id
        if (latest && latest !== seen.current) {
          seen.current = latest
          void chat('POST', '/api/v1/chat/read', { peerId }).catch(() => undefined)
        }
      } catch (caught) {
        if (!stop) setError(readableError(caught))
      }
    }
    void loadMessages()
    const timer = window.setInterval(() => void loadMessages(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [peerId])

  useEffect(() => {
    const node = scroller.current
    if (!node || !stick.current) return
    node.scrollTop = node.scrollHeight
  }, [lines, peerId])

  async function send() {
    const body = draft.trim()
    if (!peerId || !body || sending) return
    setSending(true)
    setError(null)
    try {
      const line = await chat<Line>('POST', '/api/v1/chat/messages', {
        recipientId: peerId,
        body,
      })
      setDraft('')
      stick.current = true
      setLines((current) => (current.some((item) => item.id === line.id) ? current : [...current, line]))
      setPeople((current) =>
        current.map((person) =>
          person.id === peerId
            ? { ...person, lastBody: line.body, lastAt: line.createdAt, unread: 0 }
            : person,
        ),
      )
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-[#070b10] px-3.5 py-3">
      <div className="mx-auto flex w-full max-w-[440px] items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {peer ? (
            <BackButton
              onClick={() => {
                setPeerId(null)
                setLines([])
                setDraft('')
              }}
            />
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{peer ? peer.name : 'Chat'}</h2>
            {peer ? <p className="truncate text-[12px] text-[#8ea0b5]">{peer.email}</p> : null}
          </div>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {error ? (
        <p className="mx-auto mt-3 w-full max-w-[440px] rounded-2xl border border-rose-400/30 bg-rose-950/50 px-3 py-2 text-[13px] text-rose-100">
          {error}
        </p>
      ) : null}

      {peer ? (
        <div className="mx-auto mt-3 flex min-h-0 w-full max-w-[440px] flex-1 flex-col">
          <div
            ref={scroller}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
            onScroll={(event) => {
              const node = event.currentTarget
              stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
            }}
          >
            {lines.length === 0 ? (
              <p className="px-1 pt-6 text-center text-sm text-[#8ea0b5]">
                Say hello to {peer.name}.
              </p>
            ) : (
              lines.map((line) => {
                const mine = line.senderId !== peer.id
                return (
                  <div key={line.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-[14px] leading-5 ${
                        mine ? 'bg-[#1f8a5b] text-white' : 'bg-[#151d2c] text-[#f4f7fb]'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{line.body}</p>
                      <p className={`mt-1 text-[11px] ${mine ? 'text-white/70' : 'text-[#8ea0b5]'}`}>
                        {mine ? selfName : peer.name} · {formatWhen(line.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <textarea
              className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/10 bg-[#0c121c] px-3 py-2 text-sm text-[#f4f7fb] outline-none placeholder:text-[#8ea0b5]"
              rows={1}
              value={draft}
              maxLength={2000}
              placeholder={`Message ${peer.name}`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--green)] text-white disabled:opacity-40"
              aria-label="Send"
              disabled={sending || draft.trim().length === 0}
              onClick={() => void send()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-3 w-full max-w-[440px] flex-1 space-y-2 overflow-y-auto">
          {people.length === 0 ? (
            <p className="px-1 pt-6 text-center text-sm text-[#8ea0b5]">
              No one else is in this organization yet.
            </p>
          ) : (
            people.map((person) => (
              <button
                key={person.id}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-[var(--card)] px-3 py-2.5 text-left"
                onClick={() => {
                  stick.current = true
                  setPeerId(person.id)
                  setPeople((current) =>
                    current.map((item) => (item.id === person.id ? { ...item, unread: 0 } : item)),
                  )
                }}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#12352c] text-sm font-semibold text-[#8dffc6]">
                  {initials(person.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold">{person.name}</span>
                    {person.lastAt ? (
                      <span className="shrink-0 text-[11px] text-[#8ea0b5]">
                        {formatWhen(person.lastAt)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#8ea0b5]">
                    {person.email}
                    {person.lastBody ? ` · ${person.lastBody}` : ''}
                  </span>
                </span>
                {person.unread > 0 ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--green)] px-1 text-[11px] font-semibold text-white">
                    {person.unread > 9 ? '9+' : person.unread}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function SendIcon() {
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
      <path d="M4 12h16" strokeLinecap="round" />
      <path d="m14 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
