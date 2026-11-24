'use client'

import { brand } from '@screenvault/shared/brand'
import { useState } from 'react'
import { login } from '../../lib/api'

export default function LoginPage() {
  const [email, setEmail] = useState('owner@example.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-md rounded-3xl border border-[var(--sv-line)] bg-[var(--sv-paper-2)] p-8 shadow-[var(--sv-shadow)]"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          void login(email, password)
            .then(() => {
              window.location.href = '/dashboard'
            })
            .catch((caught: Error) => setError(caught.message))
        }}
      >
        <span className="inline-flex items-center gap-2.5 text-lg font-semibold">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl" />
          {brand.productName}
        </span>
        <h1 className="mt-6 text-2xl font-semibold">Organization console</h1>
        <p className="mt-2 text-sm text-[var(--sv-muted)]">
          {brand.productName} keeps monitoring visible on each enrolled computer. This console is
          for administrators.
        </p>
        <label className="mt-6 block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-xl border border-[var(--sv-line)] px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
          />
        </label>
        <label className="mt-3 block text-sm">
          Password
          <input
            className="mt-1 w-full rounded-xl border border-[var(--sv-line)] px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        {error ? <p className="mt-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
        <button className="mt-5 w-full rounded-xl bg-[var(--sv-teal)] py-3 font-semibold text-white hover:bg-[var(--sv-teal-deep)]">
          Sign in
        </button>
      </form>
    </main>
  )
}
