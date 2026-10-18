import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { createPlayitApi } from '../tunnel/api'

const secret = process.env.PLAYIT_TEST_SECRET

describe.skipIf(!secret)('playit.gg API (live, needs PLAYIT_TEST_SECRET)', () => {
  it('creates, finds and deletes a Minecraft Java tunnel', async () => {
    const api = createPlayitApi()
    const run = await api.rundata(secret!)
    expect(run.agentId).toMatch(/^[0-9a-f-]{36}$/)

    const port = 40000 + Math.floor(Math.random() * 1000)
    let id: string
    try {
      id = await api.createTunnel(secret!, {
        agentId: run.agentId,
        localPort: port,
        name: 'Blockhost test'
      })
    } catch (err) {
      if (err instanceof AppError && err.code === 'PLAYIT_CREATE_FORBIDDEN') {
        console.warn(
          `Tunnel creation is not allowed for this key: ${err.message} — the needs-setup fallback applies.`
        )
        return
      }
      throw err
    }
    try {
      const tunnel = await vi.waitFor(
        async () => {
          const found = (await api.rundata(secret!)).tunnels.find((t) => t.id === id)
          expect(found).toBeDefined()
          return found!
        },
        { timeout: 30_000, interval: 2_000 }
      )
      expect(tunnel.localPort).toBe(port)
      expect(tunnel.tunnelType).toBe('minecraft-java')
    } finally {
      await api.deleteTunnel(secret!, id)
    }
  })
})
