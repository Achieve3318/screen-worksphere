'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PageFrame, Panel } from '../../../components/PageFrame'
import { ReceiveControl, type ReceivePhase } from '../../../components/ReceiveControl'
import { api, type SessionUser } from '../../../lib/api'

type UserDetail = {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'MANAGER' | 'PAYMENT_MANAGER' | 'MEMBER' | 'OWNER'
  disabledAt: string | null
  teams: { id: string; name: string }[]
}

type Team = { id: string; name: string }

export default function UserDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [user, setUser] = useState<UserDetail | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [viewerRole, setViewerRole] = useState<SessionUser['role'] | null>(null)
  const [receive, setReceive] = useState<{
    phase: ReceivePhase
    uploaded: number
    total: number
  } | null>(null)
  const canReceive = viewerRole === 'OWNER' || viewerRole === 'ADMIN'

  function refreshReceive() {
    void api<{
      items: { userId: string; phase: ReceivePhase; uploaded: number; total: number }[]
    }>('/api/v1/screenshot-receives')
      .then((body) => {
        setReceive(body.items.find((item) => item.userId === params.id) ?? null)
      })
      .catch(() => undefined)
  }

  function load() {
    void api<UserDetail>(`/api/v1/users/${params.id}`)
      .then((person) => {
        setUser(person)
        setName(person.name)
        setEmail(person.email)
      })
      .catch((caught: Error) => setError(caught.message))
    void api<{ items: Team[] }>('/api/v1/teams')
      .then((body) => setTeams(body.items))
      .catch(() => undefined)
  }
  useEffect(load, [params.id])
  useEffect(() => {
    void api<SessionUser>('/api/v1/auth/me')
      .then((me) => setViewerRole(me.role))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!canReceive) return
    refreshReceive()
    const timer = window.setInterval(refreshReceive, 2000)
    return () => window.clearInterval(timer)
  }, [canReceive, params.id])
  if (error) {
    return (
      <PageFrame title="Person" subtitle="Role, teams, and account access." icon={<PeopleIcon />}>
        <p className="text-sm text-[var(--sv-danger)]">{error}</p>
      </PageFrame>
    )
  }
  if (!user) {
    return (
      <PageFrame title="Person" subtitle="Role, teams, and account access." icon={<PeopleIcon />}>
        <p className="text-sm text-[var(--sv-muted)]">Loading person…</p>
      </PageFrame>
    )
  }

  return (
    <PageFrame title={user.name} subtitle={user.email} icon={<PeopleIcon />}>
      {actionError ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{actionError}</p> : null}
      <Panel className="max-w-xl p-5">
        {canReceive ? (
          <div className="mb-5">
            <ReceiveControl
              align="start"
              phase={receive?.phase ?? null}
              uploaded={receive?.uploaded ?? 0}
              total={receive?.total ?? 0}
              busy={receiving}
              onReceive={() => {
                setActionError(null)
                setReceiving(true)
                setReceive({ phase: 'pending', uploaded: 0, total: 0 })
                void api(`/api/v1/users/${user.id}/screenshot-receive`, { method: 'POST' })
                  .then(() => refreshReceive())
                  .catch((caught: Error) => {
                    setActionError(caught.message)
                    refreshReceive()
                  })
                  .finally(() => setReceiving(false))
              }}
            />
          </div>
        ) : null}
        <label className="block text-sm">
          Name
          <input
            className="mt-1 w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim()
              if (!next || next === user.name) {
                setName(user.name)
                return
              }
              void api(`/api/v1/users/${user.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: next }),
              })
                .then(load)
                .catch((caught: Error) => setError(caught.message))
            }}
          />
        </label>
        <label className="mt-4 block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => {
              const next = email.trim()
              if (!next.includes('@') || next.toLowerCase() === user.email.toLowerCase()) {
                setEmail(user.email)
                return
              }
              void api(`/api/v1/users/${user.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ email: next }),
              })
                .then(load)
                .catch((caught: Error) => setError(caught.message))
            }}
          />
        </label>
        <label className="mt-4 block text-sm">
          Role
          <select
            className="mt-1 w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
            value={user.role}
            disabled={user.role === 'OWNER'}
            onChange={(event) => {
              void api(`/api/v1/users/${user.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ role: event.target.value }),
              }).then(load)
            }}
          >
            {user.role === 'OWNER' ? <option value="OWNER">Owner</option> : null}
            <option value="ADMIN">Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="PAYMENT_MANAGER">Payment manager</option>
            <option value="MEMBER">Member</option>
          </select>
        </label>
        <fieldset className="mt-4">
          <legend className="text-sm">Teams</legend>
          {teams.map((team) => {
            const checked = user.teams.some((item) => item.id === team.id)
            return (
              <label key={team.id} className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const teamIds = checked
                      ? user.teams.filter((item) => item.id !== team.id).map((item) => item.id)
                      : [...user.teams.map((item) => item.id), team.id]
                    void api(`/api/v1/users/${user.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ teamIds }),
                    }).then(load)
                  }}
                />
                {team.name}
              </label>
            )
          })}
        </fieldset>
        {user.role !== 'OWNER' ? (
          <div className="mt-6 flex gap-2">
            <button
              className="rounded-xl border border-[var(--sv-danger)] bg-white px-4 py-2 text-sm text-[var(--sv-danger)]"
              onClick={() =>
                void api(`/api/v1/users/${user.id}/${user.disabledAt ? 'enable' : 'disable'}`, {
                  method: 'POST',
                }).then(load)
              }
            >
              {user.disabledAt ? 'Enable account' : 'Disable account'}
            </button>
            <button
              className="rounded-xl bg-[var(--sv-danger)] px-4 py-2 text-sm text-white"
              onClick={() => {
                const ok = window.confirm(
                  `Delete ${user.name}? This removes the account, devices, screenshots, and payment records tied to this person.`,
                )
                if (!ok) return
                void api(`/api/v1/users/${user.id}`, { method: 'DELETE' })
                  .then(() => router.push('/users'))
                  .catch((caught: Error) => setError(caught.message))
              }}
            >
              Delete person
            </button>
          </div>
        ) : null}
      </Panel>
    </PageFrame>
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
