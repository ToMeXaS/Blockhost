import { describe, expect, it } from 'vitest'
import { matchesFilter, parseLogLevel } from './logLevel'

describe('parseLogLevel', () => {
  it('reads a vanilla INFO line and its prefix length', () => {
    const text = '[12:00:00] [Server thread/INFO]: Done (3.2s)!'
    expect(parseLogLevel(text)).toEqual({
      level: 'info',
      tagEnd: '[12:00:00] [Server thread/INFO]: '.length
    })
  })

  it('reads Paper-style WARN lines', () => {
    const text = "[12:00:00 WARN]: Can't keep up!"
    expect(parseLogLevel(text)).toEqual({ level: 'warn', tagEnd: '[12:00:00 WARN]: '.length })
  })

  it('maps ERROR, SEVERE and FATAL to error', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/ERROR]: Failed').level).toBe('error')
    expect(parseLogLevel('[12:00:00 SEVERE]: Broken').level).toBe('error')
    expect(parseLogLevel('[12:00:00] [main/FATAL]: Crash').level).toBe('error')
  })

  it('includes a Forge logger bracket in the prefix', () => {
    const text = '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done'
    expect(parseLogLevel(text)).toEqual({
      level: 'info',
      tagEnd: '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: '.length
    })
  })

  it('detects chat lines', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/INFO]: <Steve> hello').level).toBe('chat')
    expect(parseLogLevel('[12:00:00 INFO]: [Not Secure] <Steve> hi').level).toBe('chat')
  })

  it('marks echoed commands and Blockhost lines', () => {
    expect(parseLogLevel('> op Steve')).toEqual({ level: 'cmd', tagEnd: 0 })
    expect(parseLogLevel('[Blockhost] Server stopped')).toEqual({ level: 'system', tagEnd: 0 })
  })

  it('falls back to keywords for lines without a prefix', () => {
    expect(parseLogLevel('java.lang.RuntimeException: boom')).toEqual({ level: 'error', tagEnd: 0 })
    expect(parseLogLevel('WARNING: something odd')).toEqual({ level: 'warn', tagEnd: 0 })
    expect(parseLogLevel('\tat foo.Bar.baz(Bar.java:1)')).toEqual({ level: 'plain', tagEnd: 0 })
  })

  it('treats malformed and empty lines as plain', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/INF')).toEqual({ level: 'plain', tagEnd: 0 })
    expect(parseLogLevel('')).toEqual({ level: 'plain', tagEnd: 0 })
  })
})

describe('matchesFilter', () => {
  it('shows everything for all', () => {
    expect(matchesFilter('plain', 'all')).toBe(true)
  })

  it('shows warnings and errors for warnings', () => {
    expect(matchesFilter('warn', 'warnings')).toBe(true)
    expect(matchesFilter('error', 'warnings')).toBe(true)
    expect(matchesFilter('info', 'warnings')).toBe(false)
  })

  it('shows only chat for chat', () => {
    expect(matchesFilter('chat', 'chat')).toBe(true)
    expect(matchesFilter('cmd', 'chat')).toBe(false)
  })
})
