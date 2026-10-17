import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '../../shared/types'
import { tempDir } from '../test-utils'
import { ServerStore } from './store'

function record(id: string, overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id,
    name: `Server ${id}`,
    type: 'paper',
    mcVersion: '26.3',
    dir: `C:/servers/${id}`,
    ramMb: 2048,
    port: 25565,
    jvmArgs: [],
    installState: 'ready',
    createdAt: '2026-10-17T12:00:00.000Z',
    ...overrides
  }
}

async function freshStore(): Promise<{ file: string; store: ServerStore }> {
  const file = join(await tempDir(), 'servers.json')
  const store = new ServerStore(file)
  await store.load()
  return { file, store }
}

describe('ServerStore', () => {
  it('starts empty when no file exists', async () => {
    const { store } = await freshStore()
    expect(store.list()).toEqual([])
  })

  it('persists records across instances', async () => {
    const { file, store } = await freshStore()
    await store.add(record('a'))
    await store.add(record('b'))
    const reloaded = new ServerStore(file)
    await reloaded.load()
    expect(reloaded.list().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('updates and removes records', async () => {
    const { store } = await freshStore()
    await store.add(record('a'))
    const updated = await store.update('a', { ramMb: 4096 })
    expect(updated.ramMb).toBe(4096)
    expect(store.get('a').ramMb).toBe(4096)
    await store.remove('a')
    expect(store.list()).toEqual([])
  })

  it('throws NOT_FOUND for unknown ids', async () => {
    const { store } = await freshStore()
    expect(() => store.get('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    await expect(store.update('nope', { ramMb: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('returns copies so callers cannot mutate the store', async () => {
    const { store } = await freshStore()
    await store.add(record('a'))
    store.get('a').jvmArgs.push('-Xfoo')
    expect(store.get('a').jvmArgs).toEqual([])
  })

  it('marks interrupted installs as failed on load', async () => {
    const { file, store } = await freshStore()
    await store.add(record('a', { installState: 'installing' }))
    const reloaded = new ServerStore(file)
    await reloaded.load()
    expect(reloaded.get('a').installState).toBe('failed')
  })

  it('moves a corrupt file aside and starts empty', async () => {
    const dir = await tempDir()
    const file = join(dir, 'servers.json')
    await writeFile(file, '{not json')
    const store = new ServerStore(file)
    await store.load()
    expect(store.list()).toEqual([])
    expect((await readdir(dir)).some((f) => f.startsWith('servers.json.corrupt-'))).toBe(true)
  })

  it('serializes concurrent writes', async () => {
    const { file, store } = await freshStore()
    await Promise.all([store.add(record('a')), store.add(record('b')), store.add(record('c'))])
    const reloaded = new ServerStore(file)
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(3)
  })
})
