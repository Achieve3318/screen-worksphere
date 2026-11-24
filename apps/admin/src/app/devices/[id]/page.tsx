'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PageFrame, Panel } from '../../../components/PageFrame'
import { api } from '../../../lib/api'

type Device = {
  id: string
  name: string
  platform: string
  osVersion: string
  appVersion: string
  lastSeenAt: string
  createdAt: string
  revokedAt: string | null
  user: { name: string; email: string }
  _count: { screenshots: number }
}

export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>()
  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  function load() {
    void api<Device>(`/api/v1/devices/${params.id}`)
      .then(setDevice)
      .catch((caught: Error) => setError(caught.message))
  }
  useEffect(load, [params.id])
  if (error) {
    return (
      <PageFrame title="Device" subtitle="Enrollment, activity, and revocation." icon={<MonitorIcon />}>
        <p className="text-sm text-[var(--sv-danger)]">{error}</p>
      </PageFrame>
    )
  }
  if (!device) {
    return (
      <PageFrame title="Device" subtitle="Enrollment, activity, and revocation." icon={<MonitorIcon />}>
        <p className="text-sm text-[var(--sv-muted)]">Loading device…</p>
      </PageFrame>
    )
  }
  return (
    <PageFrame title={device.name} subtitle="Enrollment, activity, and revocation." icon={<MonitorIcon />}>
      <Panel className="max-w-xl p-5">
      <dl className="grid gap-2 text-sm">
        <Row label="Person" value={`${device.user.name} · ${device.user.email}`} />
        <Row label="Platform" value={`${device.platform} ${device.osVersion}`} />
        <Row label="App" value={device.appVersion} />
        <Row label="Last seen" value={new Date(device.lastSeenAt).toLocaleString()} />
        <Row label="Screenshots" value={String(device._count.screenshots)} />
        <Row label="Device ID" value={device.id} />
      </dl>
      <button
        className="mt-6 rounded-xl bg-[#16382f] px-4 py-2 text-sm text-white disabled:opacity-40"
        disabled={Boolean(device.revokedAt)}
        onClick={() =>
          void api(`/api/v1/devices/${device.id}/revoke`, { method: 'POST' }).then(load)
        }
      >
        {device.revokedAt ? 'Revoked' : 'Revoke device'}
      </button>
      <p className="mt-3 text-sm text-[var(--sv-muted)]">
        A revoked device stops uploading and tells the person they need reauthorization. Encrypted
        files already on that computer stay there.
      </p>
      </Panel>
    </PageFrame>
  )
}

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-[var(--sv-muted)]">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  )
}
