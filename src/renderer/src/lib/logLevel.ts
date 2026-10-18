export type LogLevel = 'info' | 'warn' | 'error' | 'chat' | 'cmd' | 'system' | 'plain'
export type LogFilter = 'all' | 'warnings' | 'chat'

export interface ParsedLine {
  level: LogLevel
  /** Length of the `[time] [thread/LEVEL]: ` prefix; 0 when the line has none. */
  tagEnd: number
}

// Vanilla/Fabric: "[12:00:00] [Server thread/INFO]: msg"
// Forge/NeoForge: "[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: msg"
// Paper/Purpur:   "[12:00:00 INFO]: msg"
const PREFIX =
  /^((?:\[[^\]]*\]\s*)?\[[^\]]*?[/ ](INFO|WARN|WARNING|ERROR|SEVERE|FATAL|DEBUG|TRACE)\](?:\s*\[[^\]]*\])?:?\s*)(.*)$/
const CHAT = /^(?:\[Not Secure\]\s*)?<[^>]+>\s/

function levelOf(tag: string, message: string): LogLevel {
  if (tag === 'WARN' || tag === 'WARNING') return 'warn'
  if (tag === 'ERROR' || tag === 'SEVERE' || tag === 'FATAL') return 'error'
  return CHAT.test(message) ? 'chat' : 'info'
}

export function parseLogLevel(text: string): ParsedLine {
  if (text.startsWith('> ')) return { level: 'cmd', tagEnd: 0 }
  if (text.startsWith('[Blockhost]')) return { level: 'system', tagEnd: 0 }
  const match = PREFIX.exec(text)
  if (match) return { level: levelOf(match[2]!, match[3]!), tagEnd: match[1]!.length }
  if (/\b(ERROR|SEVERE|FATAL)\b|Exception/.test(text)) return { level: 'error', tagEnd: 0 }
  if (/\bWARN(ING)?\b/.test(text)) return { level: 'warn', tagEnd: 0 }
  return { level: 'plain', tagEnd: 0 }
}

export function matchesFilter(level: LogLevel, filter: LogFilter): boolean {
  if (filter === 'warnings') return level === 'warn' || level === 'error'
  if (filter === 'chat') return level === 'chat'
  return true
}

export const LEVEL_TEXT: Record<LogLevel, string> = {
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-danger',
  chat: 'text-ok-text',
  cmd: 'text-accent',
  system: 'text-info',
  plain: 'text-text-2'
}
