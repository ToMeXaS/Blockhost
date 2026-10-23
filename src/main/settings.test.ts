import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'blockhost-settings-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('starts empty when there is no file', async () => {
    const store = new SettingsStore(join(tmp, 'settings.json'))
    await store.load()
    expect(store.get()).toEqual({})
  })

  it('saves and reloads the backups folder, and resets it', async () => {
    const file = join(tmp, 'settings.json')
    const store = new SettingsStore(file)
    await store.load()
    await store.setBackupsDir('D:\\Backups')
    const again = new SettingsStore(file)
    await again.load()
    expect(again.get()).toEqual({ backupsDir: 'D:\\Backups' })

    await again.setBackupsDir(null)
    expect(again.get()).toEqual({})
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1 })
  })

  it('moves a corrupt file aside and uses defaults', async () => {
    const file = join(tmp, 'settings.json')
    await writeFile(file, '{oops')
    const store = new SettingsStore(file)
    await store.load()
    expect(store.get()).toEqual({})
    expect((await readdir(tmp)).some((n) => n.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('ignores a backupsDir that is not a string', async () => {
    const file = join(tmp, 'settings.json')
    await writeFile(file, JSON.stringify({ version: 1, backupsDir: 42 }))
    const store = new SettingsStore(file)
    await store.load()
    expect(store.get()).toEqual({})
  })

  it('saves and reloads autoUpdate, and keeps it when the backups folder is reset', async () => {
    const file = join(tmp, 'settings.json')
    const store = new SettingsStore(file)
    await store.load()
    await store.setAutoUpdate(false)
    await store.setBackupsDir('D:\Backups')
    await store.setBackupsDir(null)
    const again = new SettingsStore(file)
    await again.load()
    expect(again.get()).toEqual({ autoUpdate: false })
  })

  it('ignores an autoUpdate that is not a boolean', async () => {
    const file = join(tmp, 'settings.json')
    await writeFile(file, JSON.stringify({ version: 1, autoUpdate: 'no' }))
    const store = new SettingsStore(file)
    await store.load()
    expect(store.get()).toEqual({})
  })
})
