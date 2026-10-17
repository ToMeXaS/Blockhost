import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortFree } from './port'

describe('isPortFree', () => {
  it('detects a port in use and free again after closing', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
    const { port } = server.address() as AddressInfo
    expect(await isPortFree(port)).toBe(false)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(await isPortFree(port)).toBe(true)
  })
})
