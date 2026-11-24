'use client'

import { Pagination } from 'antd'
import { useEffect, useState } from 'react'

export const PAGE_SIZE = 10

export function useListPage(resetKey: string, total: number, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [resetKey])
  useEffect(() => {
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (page > pages) setPage(pages)
  }, [page, pageSize, total])
  return [page, setPage] as const
}

export function pageOf<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize) || 1)
  const current = Math.min(Math.max(page, 1), pages)
  const start = (current - 1) * pageSize
  return { current, items: items.slice(start, start + pageSize) }
}

export function ListPagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  onChange,
}: {
  page: number
  total: number
  pageSize?: number
  onChange: (page: number) => void
}) {
  if (total === 0) return null
  return (
    <div className="mt-4 flex justify-end">
      <Pagination
        current={page}
        pageSize={pageSize}
        total={total}
        showSizeChanger={false}
        onChange={onChange}
      />
    </div>
  )
}
