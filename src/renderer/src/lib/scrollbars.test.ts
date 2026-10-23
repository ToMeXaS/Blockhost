import { afterEach, describe, expect, it, vi } from 'vitest'
import { showScrollbarsWhileScrolling } from './scrollbars'

function fakeElement() {
  const attrs = new Set<string>()
  return {
    attrs,
    setAttribute: (name: string) => void attrs.add(name),
    removeAttribute: (name: string) => void attrs.delete(name)
  }
}

function fakeRoot() {
  let listener: ((event: { target: unknown }) => void) | null = null
  return {
    addEventListener: vi.fn((_type: string, fn: typeof listener) => (listener = fn)),
    removeEventListener: vi.fn(() => (listener = null)),
    scroll: (target: unknown) => listener?.({ target })
  }
}

describe('showScrollbarsWhileScrolling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks the scrolled element and unmarks it once scrolling stops', () => {
    vi.useFakeTimers()
    const root = fakeRoot()
    const el = fakeElement()
    showScrollbarsWhileScrolling(root, 800)
    expect(root.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), {
      capture: true,
      passive: true
    })

    root.scroll(el)
    expect(el.attrs.has('data-scrolling')).toBe(true)
    vi.advanceTimersByTime(500)
    root.scroll(el)
    vi.advanceTimersByTime(500)
    expect(el.attrs.has('data-scrolling')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(el.attrs.has('data-scrolling')).toBe(false)
  })

  it('marks the root element when the document itself scrolls', () => {
    const root = fakeRoot()
    const html = fakeElement()
    showScrollbarsWhileScrolling(root, 800, html)
    root.scroll(root)
    expect(html.attrs.has('data-scrolling')).toBe(true)
  })

  it('stops listening when disposed', () => {
    const root = fakeRoot()
    const dispose = showScrollbarsWhileScrolling(root, 800)
    dispose()
    expect(root.removeEventListener).toHaveBeenCalled()
  })
})
