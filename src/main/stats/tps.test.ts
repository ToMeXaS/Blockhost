import { describe, expect, it } from 'vitest'
import { isTpsReply, parseTps, tpsCommandFor } from './tps'

describe('tpsCommandFor', () => {
  it.each([
    ['paper', '1.8.8', 'tps'],
    ['purpur', '1.21.4', 'tps'],
    ['vanilla', '1.21.4', 'tick query'],
    ['vanilla', '1.20.3', 'tick query'],
    ['fabric', '26.3', 'tick query'],
    ['forge', '1.20.4', 'tick query'],
    ['neoforge', '1.21.1', 'tick query'],
    ['vanilla', '1.20.2', null],
    ['forge', '1.12.2', null]
  ] as const)('%s %s → %s', (type, version, expected) => {
    expect(tpsCommandFor(type, version)).toBe(expected)
  })
})

describe('parseTps', () => {
  it('reads the 1-minute value from Paper', () => {
    expect(parseTps('[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 19.8, 20.0, 20.0')).toBe(19.8)
  })

  it('strips Paper\'s "*" marker and caps at 20', () => {
    expect(parseTps('[12:00:00 INFO]: TPS from last 1m, 5m, 15m: *20.0, *20.0, *20.0')).toBe(20)
  })

  it('accepts comma decimals', () => {
    expect(parseTps('[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 17,5, 18,0, 19,0')).toBe(17.5)
  })

  it('turns vanilla average tick time into TPS, capped at the target rate', () => {
    expect(parseTps('Average time per tick: 1.2ms (Target: 50.0ms)')).toBe(20)
    expect(parseTps('Average time per tick: 62.5ms (Target: 50.0ms)')).toBe(16)
    expect(parseTps('Average time per tick: 10.0ms (Target: 100.0ms)')).toBe(10)
  })

  it('handles a prefixed average line and the sprinting form', () => {
    expect(
      parseTps('[12:00:00] [Server thread/INFO]: Average time per tick: 80,0ms (Target: 50,0ms)')
    ).toBe(12.5)
    expect(parseTps('Average time per tick: 25.0ms')).toBe(20)
  })

  it('ignores other lines', () => {
    expect(parseTps('[12:00:00 INFO]: Steve joined the game')).toBeNull()
    expect(parseTps('[12:00:00] [Server thread/INFO]: The game is running normally')).toBeNull()
  })
})

describe('isTpsReply', () => {
  it.each([
    '[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 19.8, 20.0, 20.0',
    '[12:00:00] [Server thread/INFO]: The game is running normally',
    '[12:00:00] [Server thread/INFO]: The game is frozen',
    '[12:00:00] [Server thread/INFO]: The game is sprinting',
    "[12:00:00] [Server thread/INFO]: The game is running, but can't keep up with the current tick rate",
    '[12:00:00] [Server thread/INFO]: Target tick rate: 20.0 per second.',
    'Average time per tick: 1.2ms (Target: 50.0ms)',
    '[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: Percentiles: P50: 1.1ms P95: 2.0ms P99: 3.4ms, sample: 100',
    '[12:00:00] [Server thread/INFO]: Unknown or incomplete command, see below for error',
    '[12:00:00] [Server thread/INFO]: tick query<--[HERE]',
    '[12:00:00 INFO]: Unknown command. Type "/help" for help.'
  ])('hides %s', (line) => {
    expect(isTpsReply(line)).toBe(true)
  })

  it.each([
    '[12:00:00 INFO]: Steve joined the game',
    '[12:00:00 INFO]: <Steve> The game is running normally',
    '[12:00:00] [Server thread/INFO]: give Steve diamond<--[HERE]',
    "[12:00:00 WARN]: Can't keep up! Is the server overloaded? Running 2034ms or 40 ticks behind"
  ])('keeps %s', (line) => {
    expect(isTpsReply(line)).toBe(false)
  })
})
