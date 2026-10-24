import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml'
import {
  CONFIG_FILE_IDS,
  type ConfigFileContent,
  type ConfigFileId,
  type ConfigFileInfo,
  type ConfigNode
} from '../../shared/types'
import { AppError } from '../errors'
import { pathExists } from '../util/fs'

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
