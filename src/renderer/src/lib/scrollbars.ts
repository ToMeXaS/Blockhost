interface Markable {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

interface ScrollRoot {
  addEventListener(
    type: 'scroll',
    listener: (event: { target: unknown }) => void,
    options: { capture: boolean; passive: boolean }
  ): void
  removeEventListener(
    type: 'scroll',
    listener: (event: { target: unknown }) => void,
    options: { capture: boolean }
  ): void
}

/**
 * Sets `data-scrolling` on whatever element is scrolling and clears it once scrolling
 * has been idle for hideAfterMs, so CSS can show scrollbar thumbs only while scrolling.
 * Scroll events do not bubble, hence the capture listener on the root.
 */
export function showScrollbarsWhileScrolling(
  root: ScrollRoot,
  hideAfterMs: number,
  rootElement?: Markable
): () => void {
  const timers = new Map<Markable, ReturnType<typeof setTimeout>>()
  const onScroll = (event: { target: unknown }): void => {
    const el = (event.target === root ? rootElement : event.target) as Markable | undefined
    if (!el || typeof el.setAttribute !== 'function') return
    el.setAttribute('data-scrolling', '')
    clearTimeout(timers.get(el))
    timers.set(
      el,
      setTimeout(() => {
        el.removeAttribute('data-scrolling')
        timers.delete(el)
      }, hideAfterMs)
    )
  }
  root.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => {
    root.removeEventListener('scroll', onScroll, { capture: true })
    for (const timer of timers.values()) clearTimeout(timer)
  }
}
