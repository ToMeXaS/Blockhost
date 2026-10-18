import { describe, expect, it, vi } from 'vitest'
import { PlayerTracker } from './tracker'

const ID = 'srv'

function setup() {
  const onChange = vi.fn()
  return { tracker: new PlayerTracker(onChange), onChange }
}

describe('PlayerTracker', () => {
  it('tracks joins and leaves across server log formats', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, [
      '[14:03:00] [Server thread/INFO]: Steve joined the game', // vanilla / fabric
      '[14:03:01 INFO]: alex_99 joined the game', // paper / purpur
      '[18Oct2026 14:03:02.123] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Notch joined the game' // forge / neoforge
    ])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Notch', 'Steve'])
    tracker.handleLines(ID, ['[14:05:00 INFO]: Steve left the game'])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Notch'])
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledWith(ID)
  })

  it('ignores chat that imitates a join line', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, [
      '[14:03:00] [Server thread/INFO]: <Bob> Steve joined the game',
      '[14:03:00] [Server thread/INFO]: <Bob> hi: Steve joined the game',
      '[14:03:00] [Server thread/INFO]: [Not Secure] <Bob> Steve joined the game',
      'Steve joined the game'
    ])
    expect(tracker.online(ID)).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces the set from a `list` reply', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Ghost joined the game'])
    tracker.handleLines(ID, [
      '[14:03:05 INFO]: There are 2 of a max of 20 players online: Steve, alex_99'
    ])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Steve'])
    tracker.handleLines(ID, ['[14:03:06] [Server thread/INFO]: There are 0 of a max of 20 players online: '])
    expect(tracker.online(ID)).toEqual([])
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('ignores a `list` reply whose names do not match the count', () => {
    const { tracker } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Steve joined the game'])
    // Some plugins print names on following lines; keep the set we have.
    tracker.handleLines(ID, ['[14:03:05 INFO]: There are 2 of a max of 20 players online:'])
    expect(tracker.online(ID)).toEqual(['Steve'])
  })

  it('does not notify when nothing changed', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Steve joined the game'])
    tracker.handleLines(ID, ['[14:03:01 INFO]: Steve joined the game'])
    tracker.handleLines(ID, ['[14:03:02 INFO]: Alex left the game'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps servers separate and clears on reset', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines('a', ['[14:03:00 INFO]: Steve joined the game'])
    tracker.handleLines('b', ['[14:03:00 INFO]: Alex joined the game'])
    tracker.reset('a')
    expect(tracker.online('a')).toEqual([])
    expect(tracker.online('b')).toEqual(['Alex'])
    expect(onChange).toHaveBeenLastCalledWith('a')
    onChange.mockClear()
    tracker.reset('a')
    expect(onChange).not.toHaveBeenCalled()
  })
})
