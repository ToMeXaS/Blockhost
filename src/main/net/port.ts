import { createServer } from 'node:net'

/** True if nothing is listening on the port (Minecraft binds all interfaces, so we test 0.0.0.0). */
export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}
