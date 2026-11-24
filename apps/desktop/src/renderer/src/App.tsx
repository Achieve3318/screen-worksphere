import { brand } from '@screenvault/shared/brand'
import logo from './logo.png'
import { useEffect, useState } from 'react'
import type { DesktopState } from '../../core/desktopState'

function readableError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : 'Something went wrong.'
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

export function App() {
  const [state, setState] = useState<DesktopState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.screenvault.getState().then(setState)
    const stopState = window.screenvault.onState(setState)
    const stopError = window.screenvault.onError(setError)
    return () => {
      stopState()
      stopError()
    }
  }, [])

  if (!state) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-slate-400">
        Opening {brand.productName}…
      </main>
    )
  }

  if (state.signedIn) {
    const online = state.activity !== 'offline'
    return (
      <main className="relative grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{state.userName}</h1>
          <p className="mt-8 text-[12px] font-medium uppercase tracking-[0.16em] text-[#8ea0b5]">
            Network Status
          </p>
          <p className="mt-3 flex items-center justify-center gap-2 text-[20px] font-medium text-[#d5deea]">
            <span
              className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-[var(--green)]' : 'bg-amber-400'}`}
            />
            {online ? 'Online' : 'Offline'}
          </p>
        </div>
      </main>
    )
  }

  async function run(action: () => Promise<DesktopState>) {
    setError(null)
    try {
      setState(await action())
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col px-3.5 pb-2.5 pt-3">
      <header className="flex items-center gap-3">
        <AppMark />
        <div>
          <p className="text-[17px] font-semibold leading-tight tracking-tight">
            {brand.productName}
          </p>
          <p className="text-[12px] text-[#7f93a8]">Visible screens, not monitoring</p>
        </div>
      </header>
      <Login
        onSubmit={(email, password) => run(() => window.screenvault.login(email, password))}
        onRegister={(input) => run(() => window.screenvault.register(input))}
        error={error}
      />
    </main>
  )
}

function Login({
  onSubmit,
  onRegister,
  error,
}: {
  onSubmit: (email: string, password: string) => void
  onRegister: (input: { name: string; email: string; password: string; teamId: string }) => void
  error: string | null
}) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in')
  const [name, setName] = useState('')
  const [teams, setTeams] = useState<{ id: string; name: string; organizationName: string }[]>([])
  const [teamsReady, setTeamsReady] = useState(false)
  const [teamId, setTeamId] = useState('')
  const [email, setEmail] = useState('member@example.com')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => {
    if (mode !== 'register') return
    let cancelled = false
    setTeamsReady(false)
    void window.screenvault
      .listTeams()
      .then((items) => {
        if (cancelled) return
        setTeams(items)
        setTeamId((current) => current || items[0]?.id || '')
        setTeamsReady(true)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setTeamsReady(true)
          setLocalError(caught instanceof Error ? caught.message : 'Teams could not be loaded.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [mode])
  const inputClass = 'w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5'
  return (
    <form
      className="mt-8 space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        setLocalError(null)
        if (mode === 'sign-in') {
          onSubmit(email, password)
          return
        }
        if (!teamId) {
          setLocalError('Select a team.')
          return
        }
        if (password !== confirm) {
          setLocalError('Passwords do not match.')
          return
        }
        if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          setLocalError(
            'Password must be at least 10 characters and include a letter and a number.',
          )
          return
        }
        onRegister({ name, email, password, teamId })
      }}
    >
      <h1 className="text-xl font-semibold">
        {mode === 'sign-in' ? 'Sign in to enroll this computer' : 'Create an account'}
      </h1>
      <p className="text-sm text-slate-400">
        This computer stays signed in after you enroll it. Screenshot images are not shown here.
      </p>
      {mode === 'register' ? (
        <>
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            autoComplete="name"
            required
          />
          <select
            className={inputClass}
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            required
          >
            <option value="">Select a team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} — {team.organizationName}
              </option>
            ))}
          </select>
          {teamsReady && teams.length === 0 ? (
            <p className="text-sm text-slate-400">
              Ask an admin to create a team, then open this form again.
            </p>
          ) : null}
        </>
      ) : null}
      <input
        className={inputClass}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        placeholder="Email"
        autoComplete="email"
        required
      />
      <input
        className={inputClass}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        placeholder="Password"
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        required
      />
      {mode === 'register' ? (
        <input
          className={inputClass}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          type="password"
          placeholder="Confirm password"
          autoComplete="new-password"
          required
        />
      ) : null}
      {localError || error ? (
        <p className="rounded-2xl border border-rose-400/30 bg-rose-950/50 px-3 py-2 text-[13px] text-rose-100">
          {localError || error}
        </p>
      ) : null}
      <button className="w-full rounded-xl bg-teal-600 py-3 font-semibold">
        {mode === 'sign-in' ? 'Enroll device' : 'Create account'}
      </button>
      <button
        type="button"
        className="w-full text-sm text-slate-300"
        onClick={() => {
          setLocalError(null)
          setMode((current) => (current === 'sign-in' ? 'register' : 'sign-in'))
          setEmail(mode === 'sign-in' ? '' : 'member@example.com')
        }}
      >
        {mode === 'sign-in' ? 'Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  )
}

function AppMark() {
  return <img src={logo} alt="" className="h-10 w-10 rounded-[14px]" />
}
