'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { PageFrame, Panel } from '../../components/PageFrame'
import { api } from '../../lib/api'

type Policy = {
  captureEnabled: boolean
  screenshotIntervalSeconds: number
  captureMode: 'ALL_DISPLAYS' | 'PRIMARY_ONLY'
  format: 'WEBP' | 'JPEG'
  quality: number
  maxWidth: number | null
  manualUploadAllowed: boolean
  automaticUploadEnabled: boolean
  automaticUploadIntervalMinutes: number
  uploadOnlyOnUnmeteredNetwork: boolean
  deleteAfterUpload: boolean
  localRetentionDays: number
  maxLocalStorageGB: number
  serverRetentionDays: number | null
  pauseCaptureWhileLocked: boolean
  idleDetectionEnabled: boolean
  idleThresholdMinutes: number
  excludedApplications: string[]
  screenshotAccessRoles: Array<'OWNER' | 'ADMIN' | 'MANAGER' | 'PAYMENT_MANAGER' | 'MEMBER'>
  dailyReportFields: ReportPrompt[]
  weeklyReportFields: ReportPrompt[]
}

type ReportPrompt = { id: string; label: string }

const retentionOptions = [30, 60, 90, 180, 365]
const tabs = [
  ['capture', 'Capture'],
  ['upload', 'Upload'],
  ['storage', 'Storage'],
  ['reports', 'Reports'],
  ['access', 'Access'],
] as const
type PolicyTab = (typeof tabs)[number][0]

export default function SettingsPage() {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [orgName, setOrgName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<PolicyTab>('capture')

  useEffect(() => {
    void api<Policy>('/api/v1/policy')
      .then((body) =>
        setPolicy({
          ...body,
          dailyReportFields: body.dailyReportFields ?? [],
          weeklyReportFields: body.weeklyReportFields ?? [],
        }),
      )
      .catch((caught: Error) => setMessage(caught.message))
    void api<{ organization: { name: string } }>('/api/v1/auth/me').then((body) => {
      setOrgName(body.organization.name)
    })
  }, [])
  if (!policy) {
    return (
      <PageFrame
        title="Setting"
        subtitle="Capture rules are enforced by the server, not only hidden in the desktop app."
        icon={<SlidersIcon />}
      >
        <p className="text-sm text-[var(--sv-muted)]">{message || 'Loading policy…'}</p>
      </PageFrame>
    )
  }

  const current = policy
  function save() {
    const blank = [...current.dailyReportFields, ...current.weeklyReportFields].some(
      (field) => field.label.trim().length === 0,
    )
    if (blank) {
      setTab('reports')
      setMessage('Each report prompt needs a label.')
      return
    }
    void api<Policy>('/api/v1/policy', { method: 'PUT', body: JSON.stringify(current) })
      .then((saved) => {
        setPolicy(saved)
        setMessage('Setting saved.')
      })
      .catch((caught: Error) => setMessage(caught.message))
  }

  return (
    <PageFrame
      title="Setting"
      subtitle="Capture cannot run faster than every 30 seconds. These rules are enforced by the server."
      icon={<SlidersIcon />}
      actions={
        <button
          className="rounded-xl bg-[#1f8a5b] px-4 py-2 text-sm font-semibold text-white"
          onClick={save}
        >
          Save
        </button>
      }
    >
      {message ? (
        <p
          className={`mb-3 text-sm ${
            message === 'Setting saved.' || message === 'Organization renamed.'
              ? 'text-[#1f8a5b]'
              : 'text-[var(--sv-danger)]'
          }`}
        >
          {message}
        </p>
      ) : null}
      <div className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-[#e6ece8] bg-white p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              tab === id ? 'bg-[#1f8a5b] text-white' : 'text-[#5c6b64] hover:bg-[#f3f6f4]'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <Panel className="grid max-w-3xl gap-4 p-5">
        {tab === 'capture' ? (
          <>
            <label className="flex items-center justify-between rounded-2xl border border-[#e6ece8] bg-[#f7faf8] px-4 py-3">
              Screenshot capture enabled
              <input
                type="checkbox"
                checked={policy.captureEnabled}
                onChange={(event) => setPolicy({ ...policy, captureEnabled: event.target.checked })}
              />
            </label>
            <Field label="Capture interval (seconds)">
              <input
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                type="number"
                min={30}
                max={3600}
                value={policy.screenshotIntervalSeconds}
                onChange={(event) =>
                  setPolicy({ ...policy, screenshotIntervalSeconds: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Displays">
              <select
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                value={policy.captureMode}
                onChange={(event) =>
                  setPolicy({ ...policy, captureMode: event.target.value as Policy['captureMode'] })
                }
              >
                <option value="ALL_DISPLAYS">All displays</option>
                <option value="PRIMARY_ONLY">Primary display only</option>
              </select>
            </Field>
            <Field label="Format and quality">
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                  value={policy.format}
                  onChange={(event) =>
                    setPolicy({ ...policy, format: event.target.value as Policy['format'] })
                  }
                >
                  <option value="WEBP">WebP</option>
                  <option value="JPEG">JPEG</option>
                </select>
                <input
                  className="rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                  type="number"
                  min={40}
                  max={100}
                  value={policy.quality}
                  onChange={(event) =>
                    setPolicy({ ...policy, quality: Number(event.target.value) })
                  }
                />
              </div>
            </Field>
            <Field label="Maximum width">
              <select
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                value={policy.maxWidth ?? ''}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    maxWidth: event.target.value ? Number(event.target.value) : null,
                  })
                }
              >
                <option value="">Original</option>
                <option value="2560">2560</option>
                <option value="1920">1920</option>
                <option value="1440">1440</option>
              </select>
            </Field>
            <label className="flex items-center justify-between text-sm">
              Pause capture while the computer is locked
              <input
                type="checkbox"
                checked={policy.pauseCaptureWhileLocked}
                onChange={(event) =>
                  setPolicy({ ...policy, pauseCaptureWhileLocked: event.target.checked })
                }
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Idle detection
              <input
                type="checkbox"
                checked={policy.idleDetectionEnabled}
                onChange={(event) =>
                  setPolicy({ ...policy, idleDetectionEnabled: event.target.checked })
                }
              />
            </label>
            <Field label="Idle threshold (minutes)">
              <input
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                type="number"
                min={1}
                max={240}
                value={policy.idleThresholdMinutes}
                onChange={(event) =>
                  setPolicy({ ...policy, idleThresholdMinutes: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Excluded foreground applications">
              <textarea
                className="min-h-24 w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                value={policy.excludedApplications.join('\n')}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    excludedApplications: event.target.value
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </>
        ) : null}
        {tab === 'upload' ? (
          <>
            <label className="flex items-center justify-between text-sm">
              Automatic upload
              <input
                type="checkbox"
                checked={policy.automaticUploadEnabled}
                onChange={(event) =>
                  setPolicy({ ...policy, automaticUploadEnabled: event.target.checked })
                }
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Manual upload allowed
              <input
                type="checkbox"
                checked={policy.manualUploadAllowed}
                onChange={(event) =>
                  setPolicy({ ...policy, manualUploadAllowed: event.target.checked })
                }
              />
            </label>
            <Field label="Automatic upload interval (minutes)">
              <input
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                type="number"
                min={1}
                max={1440}
                value={policy.automaticUploadIntervalMinutes}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    automaticUploadIntervalMinutes: Number(event.target.value),
                  })
                }
              />
            </Field>
            <label className="flex items-center justify-between text-sm">
              Upload only on unmetered networks when detectable
              <input
                type="checkbox"
                checked={policy.uploadOnlyOnUnmeteredNetwork}
                onChange={(event) =>
                  setPolicy({ ...policy, uploadOnlyOnUnmeteredNetwork: event.target.checked })
                }
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Delete local copy after upload
              <input
                type="checkbox"
                checked={policy.deleteAfterUpload}
                onChange={(event) =>
                  setPolicy({ ...policy, deleteAfterUpload: event.target.checked })
                }
              />
            </label>
          </>
        ) : null}
        {tab === 'storage' ? (
          <>
            <Field label="Local retention days">
              <input
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                type="number"
                min={1}
                max={365}
                value={policy.localRetentionDays}
                onChange={(event) =>
                  setPolicy({ ...policy, localRetentionDays: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Max local storage (GB)">
              <input
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                type="number"
                min={1}
                max={100}
                value={policy.maxLocalStorageGB}
                onChange={(event) =>
                  setPolicy({ ...policy, maxLocalStorageGB: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Server retention">
              <select
                className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                value={policy.serverRetentionDays ?? ''}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    serverRetentionDays: event.target.value ? Number(event.target.value) : null,
                  })
                }
              >
                <option value="">Unlimited</option>
                {retentionOptions.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}
        {tab === 'access' ? (
          <>
            <Field label="Screenshot access roles">
              <div className="flex flex-wrap gap-3 text-sm">
                {(['OWNER', 'ADMIN', 'MANAGER', 'PAYMENT_MANAGER', 'MEMBER'] as const).map((role) => (
                  <label key={role} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.screenshotAccessRoles.includes(role)}
                      disabled={role === 'OWNER'}
                      onChange={() => {
                        const has = policy.screenshotAccessRoles.includes(role)
                        const screenshotAccessRoles = has
                          ? policy.screenshotAccessRoles.filter((item) => item !== role)
                          : [...policy.screenshotAccessRoles, role]
                        setPolicy({ ...policy, screenshotAccessRoles })
                      }}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Organization name">
              <div className="flex gap-2">
                <input
                  className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                />
                <button
                  className="rounded-xl border border-[#e6ece8] bg-white px-3 text-sm"
                  onClick={() =>
                    void api('/api/v1/organization', {
                      method: 'PATCH',
                      body: JSON.stringify({ name: orgName }),
                    })
                      .then(() => setMessage('Organization renamed.'))
                      .catch((caught: Error) => setMessage(caught.message))
                  }
                >
                  Rename
                </button>
              </div>
            </Field>
          </>
        ) : null}
        {tab === 'reports' ? (
          <>
            <PromptEditor
              label="Daily report prompts"
              hint="People fill these in from the desktop app each day. Leave the list empty to turn daily reports off."
              fields={policy.dailyReportFields}
              onChange={(dailyReportFields) => setPolicy({ ...policy, dailyReportFields })}
            />
            <PromptEditor
              label="Weekly report prompts"
              hint="People fill these in once for the current week. Leave the list empty to turn weekly reports off."
              fields={policy.weeklyReportFields}
              onChange={(weeklyReportFields) => setPolicy({ ...policy, weeklyReportFields })}
            />
          </>
        ) : null}
      </Panel>
    </PageFrame>
  )
}

function SlidersIcon() {
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
      <path d="M4 7h16M4 17h16" strokeLinecap="round" />
      <circle cx="8" cy="7" r="2" />
      <circle cx="16" cy="17" r="2" />
    </svg>
  )
}

function PromptEditor({
  label,
  hint,
  fields,
  onChange,
}: {
  label: string
  hint: string
  fields: ReportPrompt[]
  onChange: (fields: ReportPrompt[]) => void
}) {
  return (
    <div className="text-sm">
      <span className="mb-1 block text-[var(--sv-muted)]">{label}</span>
      <p className="mb-2 text-xs text-[var(--sv-muted)]">{hint}</p>
      <div className="grid gap-2">
        {fields.map((field) => (
          <div key={field.id} className="flex gap-2">
            <input
              className="w-full rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2"
              value={field.label}
              placeholder="Prompt"
              maxLength={160}
              onChange={(event) =>
                onChange(
                  fields.map((item) =>
                    item.id === field.id ? { ...item, label: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="rounded-xl border border-[#e6ece8] bg-white px-3 text-sm"
              onClick={() => onChange(fields.filter((item) => item.id !== field.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="w-fit rounded-xl border border-[#e6ece8] bg-white px-3 py-2 text-sm"
          onClick={() => onChange([...fields, { id: crypto.randomUUID(), label: '' }])}
        >
          Add prompt
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--sv-muted)]">{label}</span>
      {children}
    </label>
  )
}
