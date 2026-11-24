'use client'

import { Pagination } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { PageFrame, Panel } from '../../components/PageFrame'
import { api } from '../../lib/api'

type AuditRow = {
  id: string
  action: string
  resourceType: string
  resourceId: string | null
  metadata: unknown
  ipAddress: string | null
  createdAt: string
  actor: { name: string; email: string } | null
}

const AUDIT_PAGE_SIZE = 10

export default function AuditPage() {
  const [items, setItems] = useState<AuditRow[]>([])
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const cursors = useRef<Array<string | null>>([null])
  const [hasNext, setHasNext] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cursor = cursors.current[page - 1]
    if (page > 1 && !cursor) return
    const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) })
    if (action) params.set('action', action)
    if (cursor) params.set('cursor', cursor)
    let cancelled = false
    void api<{ items: AuditRow[]; nextCursor: string | null }>(
      `/api/v1/audit-logs?${params.toString()}`,
    )
      .then((body) => {
        if (cancelled) return
        setItems(body.items)
        setHasNext(Boolean(body.nextCursor))
        if (body.nextCursor) cursors.current[page] = body.nextCursor
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message)
      })
    return () => {
      cancelled = true
    }
  }, [action, page])

  return (
    <PageFrame
      title="Audit log"
      subtitle="Passwords, tokens, encryption keys, and screenshot bytes are not stored here."
      icon={<ListIcon />}
      actions={
        <input
          className="w-56 rounded-xl border border-[#e6ece8] bg-[#f7faf8] px-3 py-2 text-sm"
          placeholder="Filter by action"
          value={action}
          onChange={(event) => {
            setItems([])
            setPage(1)
            cursors.current = [null]
            setHasNext(false)
            setAction(event.target.value)
          }}
        />
      }
    >
      {error ? <p className="mb-3 text-sm text-[var(--sv-danger)]">{error}</p> : null}
      <Panel className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wide text-[var(--sv-muted)] uppercase">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t border-[#eef2ef]">
                <td className="px-4 py-3">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">{row.actor?.name || 'System'}</td>
                <td className="px-4 py-3">{formatAction(row.action)}</td>
                <td className="px-4 py-3">
                  {row.resourceType}
                  {row.resourceId ? ` ${row.resourceId.slice(0, 8)}` : ''}
                  {deviceNameFrom(row.metadata) ? ` · ${deviceNameFrom(row.metadata)}` : ''}
                </td>
                <td className="px-4 py-3">{row.ipAddress || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {items.length > 0 ? (
        <div className="mt-4 flex justify-end">
          <Pagination
            current={page}
            pageSize={AUDIT_PAGE_SIZE}
            total={hasNext ? page * AUDIT_PAGE_SIZE + 1 : page * AUDIT_PAGE_SIZE}
            showSizeChanger={false}
            onChange={(next) => {
              if (next === page) return
              if (next < page) {
                setPage(next)
                return
              }
              if (next === page + 1 && hasNext) setPage(next)
            }}
          />
        </div>
      ) : null}
    </PageFrame>
  )
}

function formatAction(action: string): string {
  if (action === 'device.force_quit') return 'App force quit'
  if (action === 'device.shutdown') return 'Computer turned off'
  return action
}

function deviceNameFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const name = (metadata as { deviceName?: unknown }).deviceName
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
    </svg>
  )
}
