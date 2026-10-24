import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ContentService } from '../content/service'
import { createContentProviders } from '../content/providers'
import { downloadFile } from '../net/download'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Modrinth (network)', () => {
  it('finds and installs Fabric API for a Fabric 1.21.4 server', async () => {
    const root = await tempDir()
    const store = new ServerStore(join(root, 'servers.json'))
    await store.load()
    const dir = join(root, 'srv')
    await mkdir(dir)
    await store.add({
      id: ID,
      name: 'IT Fabric',
      type: 'fabric',
      mcVersion: '1.21.4',
      dir,
      ramMb: 2048,
      port: 25565,
      jvmArgs: [],
      launch: { args: [] },
      installState: 'ready',
      createdAt: new Date().toISOString()
    })
    const service = new ContentService({
      store,
      processes: { status: () => 'stopped' },
      providers: createContentProviders({
        userAgent: 'Blockhost-tests (github.com/ToMeXaS/blockhost)'
      }),
      download: downloadFile
    })

    const found = await service.search(ID, 'fabric api', 0)
    const hit = found.hits.find((h) => h.slug === 'fabric-api')
    expect(hit).toBeDefined()

    const result = await service.install(ID, hit!.projectId)
    expect(result.installed[0].title).toMatch(/Fabric API/)

    const list = await service.listInstalled(ID)
    expect(list.offline).toBe(false)
    expect(list.items).toContainEqual(
      expect.objectContaining({ source: 'modrinth', projectId: hit!.projectId })
    )
  })
})
