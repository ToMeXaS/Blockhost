import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpBan, OpEntry, PlayerBan, PlayerListName, PlayerRef } from '../../shared/types'
import { pathExists, writeFileAtomic } from '../util/fs'

export const LIST_FILES: Record<PlayerListName, string> = {
  ops: 'ops.json',
  whitelist: 'whitelist.json',
  bannedPlayers: 'banned-players.json',
  bannedIps: 'banned-ips.json'
}

export type RawEntry = Record<string, unknown>

export interface ListFile {
  entries: RawEntry[]
  corrupt: boolean
}

const isEntry = (value: unknown): value is RawEntry =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export async function readList(dir: string, list: PlayerListName): Promise<ListFile> {
  const file = join(dir, LIST_FILES[list])
  if (!(await pathExists(file))) return { entries: [], corrupt: false }
  try {
    const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
    if (text.trim() === '') return { entries: [], corrupt: false }
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) return { entries: [], corrupt: true }
    return { entries: parsed, corrupt: false }
  } catch {
    return { entries: [], corrupt: true }
  }
}

export async function writeList(
  dir: string,
  list: PlayerListName,
  entries: RawEntry[]
): Promise<void> {
  await writeFileAtomic(join(dir, LIST_FILES[list]), `${JSON.stringify(entries, null, 2)}\n`)
}

export function toOps(entries: RawEntry[]): OpEntry[] {
  return entries.map((e) => ({
    uuid: str(e.uuid),
    name: str(e.name),
    level: typeof e.level === 'number' ? e.level : 4
  }))
}

export function toWhitelist(entries: RawEntry[]): PlayerRef[] {
  return entries.map((e) => ({ uuid: str(e.uuid), name: str(e.name) }))
}

export function toPlayerBans(entries: RawEntry[]): PlayerBan[] {
  return entries.map((e) => ({
    uuid: str(e.uuid),
    name: str(e.name),
    reason: str(e.reason),
    created: str(e.created)
  }))
}

export function toIpBans(entries: RawEntry[]): IpBan[] {
  return entries.map((e) => ({ ip: str(e.ip), reason: str(e.reason), created: str(e.created) }))
}

export function hasName(entry: RawEntry, name: string): boolean {
  return str(entry.name).toLowerCase() === name.toLowerCase()
}

/** The server's ban date format (`yyyy-MM-dd HH:mm:ss Z`), written in UTC. */
export function banTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} +0000`
}
