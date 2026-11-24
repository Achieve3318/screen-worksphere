import { describe, expect, it } from 'vitest'
import { sanitizeReportHtml, visibleReportText } from './reportHtml.js'

const image = '/api/v1/reports/images/11111111-1111-4111-8111-111111111111'

describe('report html', () => {
  it('keeps a saved report image and drops other image sources', () => {
    const html = sanitizeReportHtml(
      `<p>Done</p><img src="${image}" alt="shot"><img src="https://evil.test/a.png"><img src="data:image/png;base64,aaaa">`,
    )
    expect(html).toContain(`<img src="${image}" alt="">`)
    expect(html).not.toContain('evil.test')
    expect(html).not.toContain('data:image')
    expect(visibleReportText(html)).toBe('Done')
  })

  it('treats an image-only answer as content', () => {
    const html = sanitizeReportHtml(`<figure class="image"><img src="${image}"></figure>`)
    expect(visibleReportText(html)).toBe('image')
    expect(visibleReportText('<p><br></p>')).toBe('')
  })
})
