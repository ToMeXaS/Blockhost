import { describe, expect, it } from 'vitest'
import { fallbackJavaMajor, normalizeJavaMajor } from './requirements'

describe('normalizeJavaMajor', () => {
  it.each([
    [8, 8],
    [16, 17],
    [17, 17],
    [21, 21],
    [22, 25],
    [25, 25],
    [27, 27]
  ])('Java %i -> %i', (input, expected) => {
    expect(normalizeJavaMajor(input)).toBe(expected)
  })
})

describe('fallbackJavaMajor', () => {
  it.each([
    ['26.3', 25],
    ['26.1.2', 25],
    ['1.21.11', 21],
    ['1.20.5', 21],
    ['1.20.4', 17],
    ['1.17', 17],
    ['1.16.5', 8],
    ['1.12.2', 8],
    ['nonsense', 25]
  ])('Minecraft %s -> Java %i', (version, expected) => {
    expect(fallbackJavaMajor(version)).toBe(expected)
  })
})
