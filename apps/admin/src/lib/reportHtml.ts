const allowedTags = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'h2',
  'h3',
  'blockquote',
  'img',
])

const reportImagePath = /^\/api\/v1\/reports\/images\/[0-9a-f-]{36}$/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeReportHtml(html: string): string {
  const withoutDanger = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
  return withoutDanger.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tag: string, attrs: string) => {
    const name = tag.toLowerCase()
    if (!allowedTags.has(name)) return ''
    if (match.startsWith('</')) return `</${name}>`
    if (name === 'br') return '<br>'
    if (name === 'img') {
      const src = /src\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
      const value = (src?.[1] ?? src?.[2] ?? '').trim()
      if (!reportImagePath.test(value)) return ''
      return `<img src="${value}" alt="">`
    }
    if (name !== 'a') return `<${name}>`
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const value = (href?.[1] ?? href?.[2] ?? '').trim()
    if (!/^https?:\/\//i.test(value) && !/^mailto:/i.test(value)) return '<a>'
    return `<a href="${value.replace(/"/g, '')}" rel="noreferrer">`
  })
}

export function reportAnswerHtml(text: string): string {
  const value = text.trim()
  if (!value) return '—'
  if (!/<\/?[a-z][^>]*>/i.test(value)) return escapeHtml(value).replace(/\n/g, '<br>')
  return sanitizeReportHtml(value)
}
