import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import {
  CONFIG_FILE_IDS,
  type ConfigEdit,
  type ConfigFileChange,
  type ConfigFileContent,
  type ConfigFileId,
  type ConfigFileInfo,
  type ConfigNode
} from '../../shared/types'
import { AppError } from '../errors'
import { pathExists, writeFileAtomic } from '../util/fs'

const FILES: Record<ConfigFileId, string> = {
  bukkit: 'bukkit.yml',
  spigot: 'spigot.yml',
  commands: 'commands.yml',
  help: 'help.yml',
  permissions: 'permissions.yml',
  'paper-legacy': 'paper.yml',
  'paper-global': 'config/paper-global.yml',
  'paper-world-defaults': 'config/paper-world-defaults.yml',
  purpur: 'purpur.yml',
  pufferfish: 'pufferfish.yml'
}

type Range = [number, number, number]

function fileOf(dir: string, id: ConfigFileId): string {
  if (!Object.hasOwn(FILES, id)) throw new AppError('CONFIG_UNKNOWN', `Unknown config file: ${id}`)
  return join(dir, FILES[id])
}

export async function readConfigText(dir: string, id: ConfigFileId): Promise<string> {
  const file = fileOf(dir, id)
  if (!(await pathExists(file))) {
    throw new AppError('CONFIG_MISSING', `${FILES[id]} does not exist`)
  }
  return readFile(file, 'utf8')
}

export function configFilePath(dir: string, id: ConfigFileId): string {
  return fileOf(dir, id)
}

export async function listConfigFiles(dir: string): Promise<ConfigFileInfo[]> {
  const found: ConfigFileInfo[] = []
  for (const id of CONFIG_FILE_IDS) {
    const path = FILES[id]
    if (await pathExists(join(dir, path))) {
      found.push({ id, label: path.split('/').pop() ?? path, path })
    }
  }
  return found
}

function cleanComment(text: string | null | undefined): string | undefined {
  const lines = (text ?? '').split('\n').map((line) => line.trim())
  const joined = lines.join('\n').trim()
  return joined || undefined
}

/** Kind and value of a non-map node; anything the form can't edit safely is `complex`. */
export function describeLeaf(node: unknown, text: string): Omit<ConfigNode, 'path' | 'comment'> {
  if (isScalar(node) && !String(node.type ?? '').startsWith('BLOCK')) {
    if (typeof node.value === 'boolean') return { kind: 'bool', value: node.value }
    if (typeof node.value === 'number') {
      return { kind: 'number', value: node.value, source: String(node.source ?? node.value) }
    }
    if (typeof node.value === 'string') return { kind: 'string', value: node.value }
  }
  if (
    isSeq(node) &&
    node.items.every(
      (item) =>
        isScalar(item) &&
        typeof item.value === 'string' &&
        !String(item.type ?? '').startsWith('BLOCK') &&
        !item.commentBefore &&
        !item.comment
    )
  ) {
    return { kind: 'list', value: node.items.map((item) => String((item as { value: string }).value)) }
  }
  const range = (node as { range?: Range } | null)?.range
  return { kind: 'complex', value: range ? text.slice(range[0], range[1]) : '' }
}

function walkMap(map: YAMLMap, parent: string[], text: string, out: ConfigNode[]): void {
  map.items.forEach((pair, index) => {
    if (!isScalar(pair.key)) return
    const path = [...parent, String(pair.key.value)]
    // yaml attaches the comment above a map's first key to the map itself.
    const comment = cleanComment(
      pair.key.commentBefore ?? (index === 0 ? map.commentBefore : undefined)
    )
    if (isMap(pair.value)) {
      out.push({ path, kind: 'map', comment })
      walkMap(pair.value, path, text, out)
    } else {
      out.push({ path, ...describeLeaf(pair.value, text), comment })
    }
  })
}

export function flattenYaml(text: string): ConfigNode[] {
  const doc = parseDocument(text)
  const out: ConfigNode[] = []
  if (isMap(doc.contents)) walkMap(doc.contents, [], text, out)
  return out
}

export function yamlError(text: string): string | undefined {
  return parseDocument(text).errors[0]?.message
}

export async function readConfigFile(dir: string, id: ConfigFileId): Promise<ConfigFileContent> {
  const text = await readConfigText(dir, id)
  const error = yamlError(text)
  return error ? { id, text, nodes: [], error } : { id, text, nodes: flattenYaml(text) }
}

interface Splice {
  start: number
  end: number
  text: string
}

function findNode(doc: Document, path: string[]): unknown {
  let node: unknown = doc.contents
  for (const segment of path) {
    if (!isMap(node)) return undefined
    const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === segment)
    if (!pair) return undefined
    node = pair.value
  }
  return node
}

function scalarText(value: string, type?: string | null, flow = false): string {
  if (/[\r\n]/.test(value)) {
    throw new AppError('CONFIG_VALUE', 'Line breaks are not allowed here; use Raw mode')
  }
  const defaultStringType = type === 'QUOTE_DOUBLE' || type === 'QUOTE_SINGLE' ? type : 'PLAIN'
  // Flow context: plain text containing flow indicators would split or nest the list.
  if (flow && /[,[\]{}]/.test(value)) {
    return stringify(value, { defaultStringType: 'QUOTE_SINGLE', lineWidth: 0 }).trimEnd()
  }
  return stringify(value, { defaultStringType, lineWidth: 0 }).trimEnd()
}

function spliceFor(doc: Document, text: string, edit: ConfigEdit, eol: string): Splice {
  const where = edit.path.join('.')
  const node = findNode(doc, edit.path)
  const range = (node as { range?: Range } | null | undefined)?.range
  if (node === undefined || isMap(node) || !range) {
    throw new AppError('CONFIG_PATH', `No setting at ${where}`)
  }
  const [start, end] = range
  const { kind } = describeLeaf(node, text)
  const { value } = edit
  const wrongType = (): AppError =>
    new AppError('CONFIG_VALUE', `Wrong value type for ${where}`)

  switch (kind) {
    case 'bool':
      if (typeof value !== 'boolean') throw wrongType()
      return { start, end, text: String(value) }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw wrongType()
      let out = String(value)
      if (/^[-+]?\d*\.\d/.test(text.slice(start, end)) && !/[.e]/i.test(out)) out += '.0'
      return { start, end, text: out }
    }
    case 'string':
      if (typeof value !== 'string') throw wrongType()
      return { start, end, text: scalarText(value, (node as { type?: string }).type) }
    case 'list': {
      if (!Array.isArray(value)) throw wrongType()
      const isFlow = Boolean((node as YAMLSeq).flow)
      const items = value.map((item) => scalarText(item, null, isFlow))
      if ((node as YAMLSeq).flow) {
        return { start, end, text: items.length ? `[ ${items.join(', ')} ]` : '[]' }
      }
      if (items.length === 0) {
        // `[]` can't start its own line under the key, so pull it up onto the key's line.
        let from = start
        while (from > 0 && /\s/.test(text[from - 1])) from--
        if (text[from - 1] !== ':') {
          throw new AppError('CONFIG_VALUE', `${where} can only be emptied in Raw mode`)
        }
        // A block list's range ends after its final newline; keep it.
        const tail = text.slice(start, end).endsWith('\n') ? eol : ''
        return { start: from, end, text: ' []' + tail }
      }
      const column = start - (text.lastIndexOf('\n', start - 1) + 1)
      const body = items.map((item) => `- ${item}`).join(eol + ' '.repeat(column))
      return { start, end, text: body + (text.slice(start, end).endsWith('\n') ? eol : '') }
    }
    default:
      throw new AppError('CONFIG_VALUE', `${where} can only be edited in Raw mode`)
  }
}

function assertValidYaml(text: string): void {
  const error = yamlError(text)
  if (error) throw new AppError('CONFIG_INVALID', `Invalid YAML: ${error}`)
}

/** Applies value edits by splicing new text over each value's range, so nothing else changes. */
export function applyEdits(text: string, edits: ConfigEdit[]): string {
  assertValidYaml(text)
  const doc = parseDocument(text)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const latest = new Map(edits.map((edit) => [JSON.stringify(edit.path), edit]))
  const splices = [...latest.values()]
    .map((edit) => spliceFor(doc, text, edit, eol))
    .sort((a, b) => b.start - a.start)
  let out = text
  for (const s of splices) out = out.slice(0, s.start) + s.text + out.slice(s.end)

  assertValidYaml(out)
  const check = parseDocument(out)
  for (const edit of latest.values()) {
    const written = describeLeaf(findNode(check, edit.path), out).value
    if (JSON.stringify(written) !== JSON.stringify(edit.value)) {
      throw new AppError('CONFIG_VALUE', `Could not safely write ${edit.path.join('.')}`)
    }
  }
  return out
}

export async function writeConfigFile(
  dir: string,
  id: ConfigFileId,
  change: ConfigFileChange
): Promise<void> {
  const current = await readConfigText(dir, id)
  let next: string
  if (change.mode === 'raw') {
    assertValidYaml(change.text)
    next = change.text
  } else {
    next = applyEdits(current, change.edits)
  }
  await writeFileAtomic(configFilePath(dir, id), next)
}
