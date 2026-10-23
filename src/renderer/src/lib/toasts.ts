export type ToastTone = 'success' | 'error' | 'warn' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

export const MAX_TOASTS = 4

/** How long each tone stays up, in ms. Errors tend to be longer and matter more. */
export const TOAST_DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  warn: 6000,
  error: 8000
}

/** Adds a toast at the end. A repeat of a visible toast replaces it, which restarts its timer. */
export function addToast(list: Toast[], toast: Toast): Toast[] {
  const others = list.filter((t) => t.tone !== toast.tone || t.message !== toast.message)
  return [...others, toast].slice(-MAX_TOASTS)
}

export function removeToast(list: Toast[], id: number): Toast[] {
  return list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list
}
