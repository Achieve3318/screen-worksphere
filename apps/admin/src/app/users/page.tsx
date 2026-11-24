'use client'

import { useEffect, useRef, useState } from 'react'
import { ListPagination, pageOf, useListPage } from '../../components/ListPagination'
import { PageFrame, Panel } from '../../components/PageFrame'
import { ReceiveControl, type ReceivePhase } from '../../components/ReceiveControl'
import { api, type SessionUser } from '../../lib/api'

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  disabledAt: string | null
  deviceCount: number
  teams: { id: string; name: string }[]
}

type Team = { id: string; name: string }

const roles = [
  { id: 'ADMIN', label: 'Admin' },
  { id: 'MANAGER', label: 'Manager' },
  { id: 'PAYMENT_MANAGER', label: 'Payment manager' },
  { id: 'MEMBER', label: 'Member' },
] as const

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MEMBER' })
  const [teamName, setTeamName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [viewerRole, setViewerRole] = useState<SessionUser['role'] | null>(null)
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receives, setReceives] = useState<
    Record<string, { phase: ReceivePhase; uploaded: number; total: number }>
  >({})
  const canReceive = viewerRole === 'OWNER' || viewerRole === 'ADMIN'

  function refreshReceives() {
    void api<{
      items: { userId: string; phase: ReceivePhase; uploaded: number; total: number }[]
    }>('/api/v1/screenshot-receives')
      .then((body) => {
        const next: Record<string, { phase: ReceivePhase; uploaded: number; total: number }> = {}
        for (const item of body.items) {
          next[item.userId] = {
            phase: item.phase,
            uploaded: item.uploaded,
            total: item.total,
          }
        }
        setReceives(next)
      })
      .catch(() => undefined)
  }

  function load() {
    void api<{ items: UserRow[] }>('/api/v1/users')
      .then((body) => setUsers(body.items))
      .catch((caught: Error) => setError(caught.message))
    void api<{ items: Team[] }>('/api/v1/teams')
      .then((body) => setTeams(body.items))
      .catch((caught: Error) => setError(caught.message))
  }

  function save(
    userId: string,
    body: { name?: string; email?: string; role?: string; teamIds?: string[] },
  ) {
    setError(null)
    void api(`/api/v1/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) })
      .then(load)
      .catch((caught: Error) => setError(caught.message))
  }
  useEffect(load, [])
  useEffect(() => {
    void api<SessionUser>('/api/v1/auth/me')
      .then((me) => setViewerRole(me.role))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!canReceive) return
    refreshReceives()
    const timer = window.setInterval(refreshReceives, 2000)
    return () => window.clearInterval(timer)
  }, [canReceive])

  function receiveScreenshots(user: UserRow) {
    setError(null)
    setReceivingId(user.id)
    setReceives((current) => ({
      ...current,
      [user.id]: { phase: 'pending', uploaded: 0, total: 0 },
    }))
    void api(`/api/v1/users/${user.id}/screenshot-receive`, { method: 'POST' })
      .then(() => refreshReceives())
      .catch((caught: Error) => {
        setError(caught.message)
        refreshReceives()
      })
      .finally(() => setReceivingId(null))
  }
  const [page, setPage] = useListPage('', users.length)
  const shown = pageOf(users, page)

  return (
    <PageFrame
      title="People"
      subtitle="Add people, assign roles, and group them into teams."
      icon={<PeopleIcon />}
    >
      {error ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
      <form
        className="grid gap-2 rounded-3xl border border-[#e6ece8] bg-white p-4 shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)] md:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            form.password.length < 10 ||
            !/[A-Za-z]/.test(form.password) ||
            !/[0-9]/.test(form.password)
          ) {
            setError('Password must be at least 10 characters and include a letter and a number.')
            return
          }
          void api('/api/v1/users', { method: 'POST', body: JSON.stringify(form) })
            .then(() => {
              setForm({ name: '', email: '', password: '', role: 'MEMBER' })
              load()
            })
            .catch((caught: Error) => setError(caught.message))
        }}
      >
        <input
          className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
          placeholder="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
        <input
          className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          required
        />
        <input
          className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
          placeholder="10+ characters, letter and number"
          type="password"
          minLength={10}
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          required
        />
        <select
          className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
        >
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="PAYMENT_MANAGER">Payment manager</option>
          <option value="MEMBER">Member</option>
        </select>
        <button className="rounded-xl bg-[#1f8a5b] px-3 py-2 text-sm font-semibold text-white">
          Add person
        </button>
      </form>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void api('/api/v1/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) })
            .then(() => setTeamName(''))
            .catch((caught: Error) => setError(caught.message))
        }}
      >
        <input
          className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
          placeholder="New team name"
          value={teamName}
          onChange={(event) => setTeamName(event.target.value)}
          required
        />
        <button className="rounded-xl border border-[#e6ece8] bg-white px-3 py-2 text-sm">
          Create team
        </button>
      </form>
      <Panel className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wide text-[var(--sv-muted)] uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Teams</th>
              <th className="px-4 py-3">Devices</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.items.map((user) => (
              <tr key={user.id} className="border-t border-[#eef2ef] align-middle">
                <td className="px-4 py-3">
                  <PersonFields
                    name={user.name}
                    email={user.email}
                    onSave={(body) => save(user.id, body)}
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-lg border border-[#e6ece8] bg-[#f7faf8] px-2 py-1"
                    aria-label={`Role for ${user.name}`}
                    value={user.role}
                    disabled={user.role === 'OWNER'}
                    onChange={(event) => save(user.id, { role: event.target.value })}
                  >
                    {user.role === 'OWNER' ? <option value="OWNER">Owner</option> : null}
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <TeamPicker
                    name={user.name}
                    teams={teams}
                    selected={user.teams}
                    onChange={(teamIds) => save(user.id, { teamIds })}
                  />
                </td>
                <td className="px-4 py-3">{user.deviceCount}</td>
                <td className="px-4 py-3">
                  <Status label={user.disabledAt ? 'Disabled' : 'Active'} on={!user.disabledAt} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-end justify-end gap-2">
                    {canReceive ? (
                      <ReceiveControl
                        phase={receives[user.id]?.phase ?? null}
                        uploaded={receives[user.id]?.uploaded ?? 0}
                        total={receives[user.id]?.total ?? 0}
                        busy={receivingId === user.id}
                        onReceive={() => receiveScreenshots(user)}
                      />
                    ) : null}
                    {user.role === 'OWNER' ? null : pendingDelete === user.id ? (
                      <button
                        type="button"
                        className="rounded-xl bg-[var(--sv-danger)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                        onClick={() => {
                          setError(null)
                          setPendingDelete(null)
                          void api(`/api/v1/users/${user.id}`, { method: 'DELETE' })
                            .then(load)
                            .catch((caught: Error) => setError(caught.message))
                        }}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-[var(--sv-danger)]"
                        onClick={() => setPendingDelete(user.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <ListPagination page={shown.current} total={users.length} onChange={setPage} />
    </PageFrame>
  )
}

function PersonFields({
  name,
  email,
  onSave,
}: {
  name: string
  email: string
  onSave: (body: { name?: string; email?: string }) => void
}) {
  const [nextName, setNextName] = useState(name)
  const [nextEmail, setNextEmail] = useState(email)
  const nameFocused = useRef(false)
  const emailFocused = useRef(false)
  const dirty = nextName.trim() !== name || nextEmail.trim().toLowerCase() !== email.toLowerCase()

  useEffect(() => {
    if (!nameFocused.current) setNextName(name)
    if (!emailFocused.current) setNextEmail(email)
  }, [name, email])

  function commit(nameValue = nextName, emailValue = nextEmail) {
    const trimmedName = nameValue.trim()
    const trimmedEmail = emailValue.trim()
    if (!trimmedName || !trimmedEmail.includes('@')) {
      setNextName(name)
      setNextEmail(email)
      return
    }
    const body: { name?: string; email?: string } = {}
    if (trimmedName !== name) body.name = trimmedName
    if (trimmedEmail.toLowerCase() !== email.toLowerCase()) body.email = trimmedEmail
    if (body.name || body.email) onSave(body)
  }

  function commitFields(event: { currentTarget: HTMLInputElement }) {
    const inputs = event.currentTarget.parentElement?.querySelectorAll('input')
    commit(inputs?.[0]?.value ?? nextName, inputs?.[1]?.value ?? nextEmail)
  }

  return (
    <div className="grid min-w-52 gap-1">
      <input
        className="rounded-lg border border-[#e6ece8] bg-[#f7faf8] px-2 py-1 font-medium"
        aria-label={`Name for ${email}`}
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
        onFocus={() => {
          nameFocused.current = true
        }}
        onBlur={(event) => {
          nameFocused.current = false
          commitFields(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <input
        className="rounded-lg border border-[#e6ece8] bg-[#f7faf8] px-2 py-1 text-[var(--sv-muted)]"
        aria-label={`Email for ${name}`}
        type="email"
        value={nextEmail}
        onChange={(event) => setNextEmail(event.target.value)}
        onFocus={() => {
          emailFocused.current = true
        }}
        onBlur={(event) => {
          emailFocused.current = false
          commitFields(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {dirty ? (
        <button
          type="button"
          className="justify-self-start rounded-lg bg-[#1f8a5b] px-2.5 py-1 text-xs font-semibold text-white"
          onClick={() => commit()}
        >
          Save
        </button>
      ) : null}
    </div>
  )
}

function TeamPicker({
  name,
  teams,
  selected,
  onChange,
}: {
  name: string
  teams: Team[]
  selected: { id: string; name: string }[]
  onChange: (teamIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selectedIds = new Set(selected.map((team) => team.id))
  const label = selected.map((team) => team.name).join(', ') || 'None'

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="rounded-lg border border-[#e6ece8] bg-[#f7faf8] px-2 py-1 text-left"
        aria-label={`Teams for ${name}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 min-w-44 rounded-xl border border-[#e6ece8] bg-white p-2 shadow-lg">
          {teams.length === 0 ? (
            <p className="px-1 text-xs text-[var(--sv-muted)]">Create a team first.</p>
          ) : null}
          {teams.map((team) => {
            const checked = selectedIds.has(team.id)
            return (
              <label key={team.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const teamIds = checked
                      ? selected.filter((item) => item.id !== team.id).map((item) => item.id)
                      : [...selected.map((item) => item.id), team.id]
                    onChange(teamIds)
                  }}
                />
                {team.name}
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function Status({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        on ? 'bg-emerald-50 text-[#1f8a5b]' : 'bg-stone-100 text-[var(--sv-muted)]'
      }`}
    >
      {label}
    </span>
  )
}

function PeopleIcon() {
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
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" strokeLinecap="round" />
    </svg>
  )
}
