import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PropertyEntry } from '../../shared/types'
import { pathExists, writeFileAtomic } from '../util/fs'

type Line =
  { kind: 'raw'; text: string } | { kind: 'entry'; key: string; value: string; text: string }

export interface PropertiesDoc {
  lines: Line[]
  eol: string
}

const FILE = 'server.properties'
const SIMPLE_ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' }

function unescapeText(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, esc: string) =>
    esc.length === 5
      ? String.fromCharCode(parseInt(esc.slice(1), 16))
      : (SIMPLE_ESCAPES[esc] ?? esc)
  )
}

function escapeText(text: string, isKey: boolean): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = ch.charCodeAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\f') out += '\\f'
    else if ('=:#!'.includes(ch)) out += `\\${ch}`
    else if (ch === ' ' && (isKey || i === 0)) out += '\\ '
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out
}

function parseLine(text: string): Line {
  const t = text.trimStart()
  if (t === '' || t.startsWith('#') || t.startsWith('!')) return { kind: 'raw', text }
  let i = 0
  let key = ''
  while (i < t.length) {
    const ch = t[i]
    if (ch === '\\' && i + 1 < t.length) {
      key += t.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t') break
    key += ch
    i++
  }
  const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t'
  while (isSpace(t[i])) i++
  if (t[i] === '=' || t[i] === ':') i++
  while (isSpace(t[i])) i++
  return { kind: 'entry', key: unescapeText(key), value: unescapeText(t.slice(i)), text }
}

const entryLine = (key: string, value: string): Line => ({
  kind: 'entry',
  key,
  value,
  text: `${escapeText(key, true)}=${escapeText(value, false)}`
})

export function parseProperties(text: string): PropertiesDoc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const raw = text.length ? text.split(/\r?\n/) : []
  if (raw.length && raw[raw.length - 1] === '') raw.pop()
  return { eol, lines: raw.map(parseLine) }
}

export function serializeProperties(doc: PropertiesDoc): string {
  if (doc.lines.length === 0) return ''
  return doc.lines.map((line) => line.text).join(doc.eol) + doc.eol
}

export function getEntries(doc: PropertiesDoc): PropertyEntry[] {
  return doc.lines.flatMap((line) =>
    line.kind === 'entry' ? [{ key: line.key, value: line.value }] : []
  )
}

export function setEntries(doc: PropertiesDoc, entries: PropertyEntry[]): PropertiesDoc {
  const wanted = new Map(entries.map((e) => [e.key, e.value]))
  const lines: Line[] = []
  for (const line of doc.lines) {
    if (line.kind === 'raw') {
      lines.push(line)
      continue
    }
    const value = wanted.get(line.key)
    if (value === undefined) continue
    wanted.delete(line.key)
    lines.push(value === line.value ? line : entryLine(line.key, value))
  }
  for (const [key, value] of wanted) lines.push(entryLine(key, value))
  return { eol: doc.eol, lines }
}

async function readDoc(dir: string): Promise<PropertiesDoc> {
  const file = join(dir, FILE)
  return parseProperties((await pathExists(file)) ? await readFile(file, 'utf8') : '')
}

export async function readPropertiesFile(dir: string): Promise<PropertyEntry[]> {
  return getEntries(await readDoc(dir))
}

export async function writePropertiesFile(dir: string, entries: PropertyEntry[]): Promise<void> {
  const doc = setEntries(await readDoc(dir), entries)
  await writeFileAtomic(join(dir, FILE), serializeProperties(doc))
}

export async function updateProperties(
  dir: string,
  changes: Record<string, string>
): Promise<void> {
  const current = await readPropertiesFile(dir)
  const merged = current.map((e) =>
    Object.hasOwn(changes, e.key) ? { key: e.key, value: changes[e.key] } : e
  )
  for (const [key, value] of Object.entries(changes)) {
    if (!current.some((e) => e.key === key)) merged.push({ key, value })
  }
  await writePropertiesFile(dir, merged)
}
