import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, toApiError } from './errors'

describe('toApiError', () => {
  it('converts AppError with details', () => {
    expect(toApiError(new AppError('PORT_IN_USE', 'Port busy', { port: 25565 }))).toEqual({
      code: 'PORT_IN_USE',
      message: 'Port busy',
      details: { port: 25565 }
    })
  })

  it('converts ZodError into INVALID_INPUT naming the field', () => {
    const result = z.object({ port: z.number() }).safeParse({ port: 'x' })
    const apiError = toApiError(result.error)
    expect(apiError.code).toBe('INVALID_INPUT')
    expect(apiError.message).toContain('port')
  })

  it('converts unknown errors into INTERNAL', () => {
    expect(toApiError(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' })
    expect(toApiError('weird')).toEqual({ code: 'INTERNAL', message: 'weird' })
  })
})
