import extract from 'extract-zip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { InstallProgress } from '../../shared/types'
import { JsonCache } from '../cache'
import { probeJava } from '../java/detect'
import { JavaManager } from '../java/manager'
import { JavaResolver } from '../java/resolver'
import { runJava } from '../java/run'
import { downloadFile } from '../net/download'
import { createHttpClient } from '../net/http'
import { createProviders } from '../providers'
import { createMojangJavaLookup } from '../providers/vanilla'
import { readPropertiesFile, updateProperties } from '../servers/properties'
import { ServerInstaller } from '../servers/installer'
import { defaultSpawn, killTree, ProcessManager } from '../servers/process'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'

describe('real Paper server (network, ~150 MB download)', () => {
  it('installs, starts, reaches Done, and stops cleanly', async () => {
    const root = await tempDir()
    const http = createHttpClient({ cache: new JsonCache(join(root, 'cache')) })
    const providers = createProviders({ http, download: downloadFile, runJava })
    const java = new JavaResolver({
      manager: new JavaManager({
        root: join(root, 'java'),
        http,
        download: downloadFile,
        extractZip: (zipPath, destDir) => extract(zipPath, { dir: destDir })
      }),
      mojangJavaMajor: createMojangJavaLookup(http),
      probe: probeJava
    })
    const store = new ServerStore(join(root, 'servers.json'))
    await store.load()
    const events: InstallProgress[] = []
    const installer = new ServerInstaller({ store, providers, java, emit: (e) => events.push(e) })

    const version = (await providers.paper.listVersions()).find((v) => v.stable)!.id
    const port = 25700 + Math.floor(Math.random() * 200)
    const dir = join(root, 'servers', 'it-paper')
    const created = await installer.create({
      name: 'IT Paper',
      type: 'paper',
      mcVersion: version,
      dir,
      ramMb: 2048,
      port,
      eulaAccepted: true
    })
    await installer.waitFor(created.id)
    const errors = events.filter((e) => e.step === 'error').map((e) => e.message)
    expect(store.get(created.id).installState, errors.join('\n')).toBe('ready')
    expect(await readFile(join(dir, 'eula.txt'), 'utf8')).toContain('eula=true')

    const processes = new ProcessManager({
      spawn: defaultSpawn,
      kill: killTree,
      onStatus: () => {},
      onLog: () => {}
    })
    const rec = store.get(created.id)
    processes.start(rec, await java.forStart(rec))
    await vi.waitFor(() => expect(processes.status(rec.id)).toBe('running'), {
      timeout: 300_000,
      interval: 1000
    })

    const motd = 'IT edited while running'
    await expect(updateProperties(dir, { motd })).resolves.toBeUndefined()
    expect((await readPropertiesFile(dir)).find((e) => e.key === 'motd')?.value).toBe(motd)

    processes.stop(rec.id)
    expect(await processes.waitForExit(rec.id, 120_000)).toBe(true)
    expect(processes.status(rec.id)).toBe('stopped')
    expect(processes.getLog(rec.id).some((line) => line.includes(`:${port}`))).toBe(true)
  })
})
