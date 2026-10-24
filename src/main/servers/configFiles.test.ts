import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { flattenYaml, listConfigFiles, readConfigFile } from './configFiles'

const SAMPLE = [
  '# header comment',
  '',
  'settings:',
  '  # allow the end',
  '  allow-end: true',
  '  # throttle ms',
  '  connection-throttle: 4000',
  '  ratio: 1.0',
  "  name: 'hi'",
  '  empty:',
  '  list:',
  '  - a',
  '  - b',
  '  flow: [x, y]',
  '  objects:',
  '  - name: x',
  'spawn-limits:',
  '  monsters: 70',
  'top: plain',
  ''
].join('\n')

describe('flattenYaml', () => {
  it('flattens keys in file order with kinds, values and comments', () => {
    expect(flattenYaml(SAMPLE)).toEqual([
      { path: ['settings'], kind: 'map', comment: undefined },
      { path: ['settings', 'allow-end'], kind: 'bool', value: true, comment: 'allow the end' },
      {
        path: ['settings', 'connection-throttle'],
        kind: 'number',
        value: 4000,
        source: '4000',
        comment: 'throttle ms'
      },
      { path: ['settings', 'ratio'], kind: 'number', value: 1, source: '1.0', comment: undefined },
      { path: ['settings', 'name'], kind: 'string', value: 'hi', comment: undefined },
      { path: ['settings', 'empty'], kind: 'complex', value: '', comment: undefined },
      { path: ['settings', 'list'], kind: 'list', value: ['a', 'b'], comment: undefined },
      { path: ['settings', 'flow'], kind: 'list', value: ['x', 'y'], comment: undefined },
      { path: ['settings', 'objects'], kind: 'complex', value: '- name: x\n', comment: undefined },
      { path: ['spawn-limits'], kind: 'map', comment: undefined },
      { path: ['spawn-limits', 'monsters'], kind: 'number', value: 70, source: '70', comment: undefined },
      { path: ['top'], kind: 'string', value: 'plain', comment: undefined }
    ])
  })

  it('stringifies numeric keys', () => {
    expect(flattenYaml('ids:\n  5: on\n  6: true\n').map((n) => n.path)).toEqual([
      ['ids'],
      ['ids', '5'],
      ['ids', '6']
    ])
  })
})

describe('listConfigFiles', () => {
  it('lists only files that exist, in allowlist order, including config/ paths', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'spigot.yml'), 'a: 1\n')
    await writeFile(join(dir, 'bukkit.yml'), 'a: 1\n')
    await mkdir(join(dir, 'config'))
    await writeFile(join(dir, 'config', 'paper-global.yml'), 'a: 1\n')
    expect(await listConfigFiles(dir)).toEqual([
      { id: 'bukkit', label: 'bukkit.yml', path: 'bukkit.yml' },
      { id: 'spigot', label: 'spigot.yml', path: 'spigot.yml' },
      { id: 'paper-global', label: 'paper-global.yml', path: 'config/paper-global.yml' }
    ])
  })
})

describe('readConfigFile', () => {
  it('returns text and nodes', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), SAMPLE)
    const content = await readConfigFile(dir, 'bukkit')
    expect(content.text).toBe(SAMPLE)
    expect(content.error).toBeUndefined()
    expect(content.nodes).toHaveLength(12)
  })

  it('reports invalid YAML instead of throwing', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), 'a: [1, 2\n')
    const content = await readConfigFile(dir, 'bukkit')
    expect(content.nodes).toEqual([])
    expect(content.error).toBeTruthy()
  })

  it('refuses a missing file', async () => {
    const dir = await tempDir()
    await expect(readConfigFile(dir, 'spigot')).rejects.toThrow(/does not exist/)
  })

  it('refuses an unknown id', async () => {
    const dir = await tempDir()
    await expect(readConfigFile(dir, '../evil' as never)).rejects.toThrow(/Unknown config file/)
  })
})
