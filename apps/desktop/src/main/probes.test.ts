import { describe, expect, it } from 'vitest'
import { decodeForeground } from './probes.js'

describe('foreground window decode', () => {
  it('reads the program name, process name, and window title', () => {
    const payload = Buffer.from('Google Chrome\nchrome\nInbox - Gmail', 'utf8').toString('base64')
    expect(decodeForeground(`warning\n${payload}\r\n`)).toEqual({
      app: 'Google Chrome',
      processName: 'chrome',
      title: 'Inbox - Gmail',
    })
  })
})
