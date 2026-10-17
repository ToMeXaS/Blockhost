import { describe, expect, it } from 'vitest'
import { compareMcVersions, parseMcVersion } from './mcVersion'

describe('parseMcVersion', () => {
  it('parses legacy and new-style versions', () => {
    expect(parseMcVersion('1.21.4')).toEqual([1, 21, 4])
    expect(parseMcVersion('26.1.2')).toEqual([26, 1, 2])
    expect(parseMcVersion('26.4-snapshot-4')).toEqual([26, 4])
  })

  it('returns null for non-numeric versions', () => {
    expect(parseMcVersion('craftmine')).toBeNull()
  })
})

describe('compareMcVersions', () => {
  it('orders versions numerically', () => {
    expect(compareMcVersions('1.21.10', '1.21.9')).toBeGreaterThan(0)
    expect(compareMcVersions('1.21', '1.21.0')).toBe(0)
    expect(compareMcVersions('26.1', '1.21.11')).toBeGreaterThan(0)
    expect(compareMcVersions('1.20.4', '1.20.5')).toBeLessThan(0)
  })

  it('sorts newest first', () => {
    const sorted = ['1.20.1', '26.3', '1.21.4', '26.1.2'].sort((a, b) => compareMcVersions(b, a))
    expect(sorted).toEqual(['26.3', '26.1.2', '1.21.4', '1.20.1'])
  })
})
