import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { applyEdits, flattenYaml, listConfigFiles, readConfigFile, writeConfigFile } from './configFiles'

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

describe('applyEdits', () => {
  it('changes only the edited values and keeps comments and layout', () => {
    const out = applyEdits(SAMPLE, [
      { path: ['settings', 'connection-throttle'], value: 5000 },
      { path: ['settings', 'allow-end'], value: false },
      { path: ['settings', 'name'], value: "it's" }
    ])
    expect(out).toBe(
      SAMPLE.replace('connection-throttle: 4000', 'connection-throttle: 5000')
        .replace('allow-end: true', 'allow-end: false')
        .replace("name: 'hi'", "name: 'it''s'")
    )
  })

  it('keeps a float a float', () => {
    expect(applyEdits(SAMPLE, [{ path: ['settings', 'ratio'], value: 3 }])).toContain('ratio: 3.0\n')
  })

  it('rewrites block and flow lists in place', () => {
    const out = applyEdits(SAMPLE, [
      { path: ['settings', 'list'], value: ['c', 'd e'] },
      { path: ['settings', 'flow'], value: ['z'] }
    ])
    expect(out).toContain('  list:\n  - c\n  - d e\n  flow: [ z ]\n  objects:\n  - name: x\n')
    expect(applyEdits(SAMPLE, [{ path: ['settings', 'list'], value: [] }])).toContain(
      '  list: []\n  flow'
    )
  })

  it('quotes strings that would otherwise change type', () => {
    const out = applyEdits('a: x\n', [{ path: ['a'], value: 'true' }])
    expect(flattenYaml(out)[0]).toMatchObject({ kind: 'string', value: 'true' })
  })

  it('keeps CRLF line endings when rewriting a block list', () => {
    const crlf = 'l:\r\n- a\r\nn: 1\r\n'
    expect(applyEdits(crlf, [{ path: ['l'], value: ['b', 'c'] }])).toBe('l:\r\n- b\r\n- c\r\nn: 1\r\n')
  })

  it('refuses unknown paths, maps, complex values and type changes', () => {
    expect(() => applyEdits(SAMPLE, [{ path: ['nope'], value: 1 }])).toThrow(/No setting/)
    expect(() => applyEdits(SAMPLE, [{ path: ['settings'], value: 1 }])).toThrow(/No setting/)
    expect(() => applyEdits(SAMPLE, [{ path: ['settings', 'objects'], value: 'x' }])).toThrow(
      /Raw/
    )
    expect(() => applyEdits(SAMPLE, [{ path: ['settings', 'ratio'], value: 'x' }])).toThrow(
      /type/
    )
  })

  it('refuses line breaks', () => {
    expect(() => applyEdits(SAMPLE, [{ path: ['top'], value: 'a\nb' }])).toThrow(/Line breaks/)
  })
})

describe('writeConfigFile', () => {
  it('writes value edits', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), SAMPLE)
    await writeConfigFile(dir, 'bukkit', {
      mode: 'values',
      edits: [{ path: ['spawn-limits', 'monsters'], value: 50 }]
    })
    expect(await readFile(join(dir, 'bukkit.yml'), 'utf8')).toBe(
      SAMPLE.replace('monsters: 70', 'monsters: 50')
    )
  })

  it('writes raw text when it is valid YAML', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), SAMPLE)
    await writeConfigFile(dir, 'bukkit', { mode: 'raw', text: '# new\na: 1\n' })
    expect(await readFile(join(dir, 'bukkit.yml'), 'utf8')).toBe('# new\na: 1\n')
  })

  it('refuses invalid raw YAML and leaves the file alone', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), SAMPLE)
    await expect(
      writeConfigFile(dir, 'bukkit', { mode: 'raw', text: 'a: [1, 2\n' })
    ).rejects.toThrow(/Invalid YAML/)
    expect(await readFile(join(dir, 'bukkit.yml'), 'utf8')).toBe(SAMPLE)
  })

  it('refuses value edits when the file on disk is invalid', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'bukkit.yml'), 'a: [1, 2\n')
    await expect(
      writeConfigFile(dir, 'bukkit', { mode: 'values', edits: [{ path: ['a'], value: 1 }] })
    ).rejects.toThrow(/Invalid YAML/)
  })
})
