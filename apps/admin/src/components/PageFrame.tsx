import type { ReactNode } from 'react'

export function PageFrame({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6ece8] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-[#1f8a5b]">
            {icon}
          </span>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-[var(--sv-muted)]">{subtitle}</p>
          </div>
        </div>
        {actions}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-3xl border border-[#e6ece8] bg-white shadow-[0_10px_30px_-24px_rgba(22,56,47,0.45)] ${className}`}
    >
      {children}
    </div>
  )
}
