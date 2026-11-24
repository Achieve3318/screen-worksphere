export type ReceivePhase = 'pending' | 'uploading' | 'complete' | 'declined'

export function ReceiveControl({
  phase,
  uploaded,
  total,
  busy,
  onReceive,
  align = 'end',
}: {
  phase: ReceivePhase | null
  uploaded: number
  total: number
  busy: boolean
  onReceive: () => void
  align?: 'start' | 'end'
}) {
  const active = phase === 'pending' || phase === 'uploading'
  const percent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 35
  return (
    <div
      className={`flex min-w-44 flex-col gap-2 ${align === 'end' ? 'items-end' : 'items-start'}`}
    >
      {phase === 'pending' ? (
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          Waiting for device
        </span>
      ) : null}
      {phase === 'uploading' ? (
        <div className="w-full">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[#1f8a5b]">
            <span>Uploading</span>
            <span>{total > 0 ? `${uploaded} / ${total}` : 'Starting'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e7f6ee]">
            <div
              className={`h-full rounded-full bg-[#1f8a5b] ${total === 0 ? 'animate-pulse' : ''}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}
      {phase === 'complete' ? (
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-[#1f8a5b]">
          {total === 0 ? 'Nothing to upload' : `Uploaded ${uploaded}`}
        </span>
      ) : null}
      {phase === 'declined' ? (
        <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-[var(--sv-danger)]">
          Declined
        </span>
      ) : null}
      <button
        type="button"
        className="rounded-xl bg-[#1f8a5b] px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
        disabled={busy || active}
        onClick={onReceive}
      >
        {busy ? 'Sending…' : 'Receive screenshots'}
      </button>
    </div>
  )
}
