import { describe, expect, it } from 'vitest'
import { parseJavaVersionOutput, probeJava } from './detect'

describe('parseJavaVersionOutput', () => {
  it.each([
    ['java version "1.8.0_392"\nJava(TM) SE Runtime Environment', 8],
    ['openjdk version "17.0.20.1" 2026-07-21', 17],
    ['java version "25.0.1" 2025-10-21 LTS', 25],
    ['openjdk version "21" 2023-09-19', 21],
    ['garbage', null]
  ])('parses %j', (output, major) => {
    expect(parseJavaVersionOutput(output)).toBe(major)
  })
})

describe('probeJava', () => {
  it('returns null for an executable that is not Java', async () => {
    expect(await probeJava(process.execPath)).toBeNull()
  })

  it('returns null for a missing executable', async () => {
    expect(await probeJava('C:/definitely/not/here/java.exe')).toBeNull()
  })
})
