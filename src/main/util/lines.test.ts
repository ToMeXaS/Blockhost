import { describe, expect, it } from 'vitest'
import { LineSplitter } from './lines'

function collect(): { out: string[]; splitter: LineSplitter } {
  const out: string[] = []
  return { out, splitter: new LineSplitter((line) => out.push(line)) }
}

describe('LineSplitter', () => {
  it('emits complete lines across chunks', () => {
    const { out, splitter } = collect()
    splitter.push('hel')
    splitter.push('lo\nwor')
    splitter.push('ld\r\n')
    expect(out).toEqual(['hello', 'world'])
  })

  it('handles CRLF split across chunks', () => {
    const { out, splitter } = collect()
    splitter.push('a\r')
    splitter.push('\nb\n')
    expect(out).toEqual(['a', 'b'])
  })

  it('flushes a trailing partial line once', () => {
    const { out, splitter } = collect()
    splitter.push('tail')
    splitter.flush()
    splitter.flush()
    expect(out).toEqual(['tail'])
  })
})
