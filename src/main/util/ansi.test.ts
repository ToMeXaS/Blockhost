import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001b[33mWARN\u001b[0m done')).toBe('WARN done')
    expect(stripAnsi('\u001b[0;33;1mx\u001b[m')).toBe('x')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('[12:00:00 INFO]: Done (3.2s)!')).toBe('[12:00:00 INFO]: Done (3.2s)!')
  })
})
