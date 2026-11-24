'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ListPagination, pageOf, useListPage } from '../../components/ListPagination'
import { PageFrame, Panel } from '../../components/PageFrame'
import { api } from '../../lib/api'

type Device = {
  id: string
  name: string
  platform: string
  osVersion: string
  appVersion: string
  lastSeenAt: string
  revokedAt: string | null
  user: { name: string; email: string }
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api<{ items: Device[] }>('/api/v1/devices')
      .then((body) => setDevices(body.items))
      .catch((caught: Error) => setError(caught.message))
  }, [])
  const [page, setPage] = useListPage('', devices.length)
  const shown = pageOf(devices, page)
  return (
    <PageFrame
      title="Devices"
      subtitle="Computers enrolled for visible screenshot monitoring."
      icon={<MonitorIcon />}
    >
      {error ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
      <Panel className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wide text-[var(--sv-muted)] uppercase">
            <tr>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.items.map((device) => {
              const state = device.revokedAt
                ? 'Revoked'
                : online(device.lastSeenAt)
                  ? 'Online'
                  : 'Offline'
              return (
                <tr key={device.id} className="border-t border-[#eef2ef]">
                  <td className="px-4 py-3">
                    <Link className="font-medium text-[#16382f]" href={`/devices/${device.id}`}>
                      {device.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{device.user.name}</td>
                  <td className="px-4 py-3">
                    {device.platform} {device.osVersion}
                  </td>
                  <td className="px-4 py-3">{new Date(device.lastSeenAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        state === 'Online'
                          ? 'bg-emerald-50 text-[#1f8a5b]'
                          : 'bg-stone-100 text-[var(--sv-muted)]'
                      }`}
                    >
                      {state}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
      <ListPagination page={shown.current} total={devices.length} onChange={setPage} />
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

function online(value: string): boolean {
  return Date.now() - new Date(value).getTime() < 5 * 60 * 1000
}
