import { createHash } from 'node:crypto'
import type { PlayerRef } from '../../shared/types'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'

export const MOJANG_PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft/'

export function formatUuid(hex: string): string {
  const h = hex.toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Same as Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name), used by offline-mode servers. */
export function offlineUuid(name: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes.toString('hex'))
}

const notFound = (name: string): AppError =>
  new AppError('PLAYER_NOT_FOUND', `No Minecraft account named ${name}`)

export async function lookupPlayer(
  http: HttpClient,
  name: string,
  onlineMode: boolean
): Promise<PlayerRef> {
  if (!onlineMode) return { uuid: offlineUuid(name), name }

  let text: string
  try {
    text = await http.getText(`${MOJANG_PROFILE_URL}${encodeURIComponent(name)}`)
  } catch (err) {
    if (err instanceof AppError && err.code === 'HTTP' && err.details?.status === 404)
      throw notFound(name)
    if (err instanceof AppError && err.code === 'NETWORK') {
      throw new AppError(
        'NETWORK',
        `${err.message}. Adding a player to a stopped server needs the internet to look up their account, unless the server's online mode is turned off.`
      )
    }
    throw err
  }

  if (!text.trim()) throw notFound(name)
  let body: { id?: unknown; name?: unknown }
  try {
    body = JSON.parse(text) as { id?: unknown; name?: unknown }
  } catch {
    throw new AppError('HTTP', 'api.mojang.com returned an unreadable response')
  }
  if (typeof body.id !== 'string' || !/^[0-9a-f]{32}$/i.test(body.id)) throw notFound(name)
  return { uuid: formatUuid(body.id), name: typeof body.name === 'string' ? body.name : name }
}
