import { describe, expect, it } from 'vitest'
import { addToast, MAX_TOASTS, removeToast, TOAST_DURATION, type Toast } from './toasts'

const toast = (id: number, message = `message ${id}`, tone: Toast['tone'] = 'success'): Toast => ({
  id,
  tone,
  message
})

describe('addToast', () => {
  it('appends the newest toast at the end', () => {
    expect(addToast([toast(1)], toast(2)).map((t) => t.id)).toEqual([1, 2])
  })

  it(`keeps at most ${MAX_TOASTS}, dropping the oldest`, () => {
    let list: Toast[] = []
    for (let id = 1; id <= MAX_TOASTS + 2; id++) list = addToast(list, toast(id))
    expect(list.map((t) => t.id)).toEqual([3, 4, 5, 6])
  })

  it('replaces a toast with the same tone and message instead of stacking it', () => {
    const list = addToast([toast(1, 'Saved.'), toast(2)], toast(3, 'Saved.'))
    expect(list.map((t) => t.id)).toEqual([2, 3])
  })

  it('stacks the same message when the tone differs', () => {
    const list = addToast([toast(1, 'Done', 'success')], toast(2, 'Done', 'warn'))
    expect(list.map((t) => t.id)).toEqual([1, 2])
  })
})

describe('removeToast', () => {
  it('removes only the given toast', () => {
    expect(removeToast([toast(1), toast(2), toast(3)], 2).map((t) => t.id)).toEqual([1, 3])
  })

  it('ignores unknown ids', () => {
    const list = [toast(1)]
    expect(removeToast(list, 9)).toEqual(list)
  })
})

describe('TOAST_DURATION', () => {
  it('keeps errors up longest and warnings longer than successes', () => {
    expect(TOAST_DURATION.error).toBeGreaterThan(TOAST_DURATION.warn)
    expect(TOAST_DURATION.warn).toBeGreaterThan(TOAST_DURATION.success)
    expect(TOAST_DURATION.info).toBe(TOAST_DURATION.success)
  })
})
