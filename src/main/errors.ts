import { z } from 'zod'
import type { ApiError } from '../shared/types'

export class AppError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details }
  if (err instanceof z.ZodError) {
    const message = err.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message
      )
      .join('; ')
    return { code: 'INVALID_INPUT', message }
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }
}
