import type { ServerType } from '../../shared/types'
import { compareMcVersions } from '../util/mcVersion'

export type TpsCommand = 'tps' | 'tick query'

export const MAX_TPS = 20
const TICK_COMMAND_SINCE = '1.20.3'

// Optional "[...]" logger groups and ": " before the message; continuation lines have none.
const PREFIX = String.raw`^(?:(?:\[[^\]]*\]\s*)+:\s)?`
const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const PAPER_TPS = new RegExp(`${PREFIX}TPS from last 1m, 5m, 15m: \\*?${NUM}`)
const AVG_TICK = new RegExp(`${PREFIX}Average time per tick: ${NUM}ms(?: \\(Target: ${NUM}ms\\))?`)
const REPLY = new RegExp(
  `${PREFIX}(?:${[
    'TPS from last 1m, 5m, 15m:',
    "The game is (?:running normally|frozen|sprinting|running, but can't keep up)",
    'Target tick rate:',
    'Average time per tick:',
    'Percentiles: P50:',
    'Unknown or incomplete command',
    'Unknown command\\.'
  ].join('|')})`
)
const WRONG_COMMAND_ECHO = /(?:^|:\s)(?:tps|tick query)<--\[HERE\]$/

export function tpsCommandFor(type: ServerType, mcVersion: string): TpsCommand | null {
  if (type === 'paper' || type === 'purpur') return 'tps'
  return compareMcVersions(mcVersion, TICK_COMMAND_SINCE) >= 0 ? 'tick query' : null
}

const toNumber = (text: string): number => Number(text.replace(',', '.'))

export function parseTps(line: string): number | null {
  const paper = PAPER_TPS.exec(line)
  if (paper) return Math.min(MAX_TPS, toNumber(paper[1]))
  const avg = AVG_TICK.exec(line)
  if (!avg) return null
  const ms = toNumber(avg[1])
  const cap = avg[2] ? 1000 / toNumber(avg[2]) : MAX_TPS
  return ms > 0 ? Math.min(cap, 1000 / ms) : cap
}

/** True for every line the `tps` / `tick query` commands (or a rejection of them) print. */
export function isTpsReply(line: string): boolean {
  return REPLY.test(line) || WRONG_COMMAND_ECHO.test(line)
}
