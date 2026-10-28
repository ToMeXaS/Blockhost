import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ContentService } from '../content/service'
import { createContentProviders } from '../content/providers'
import { downloadFile } from '../net/download'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'

const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('Hangar (network)', () => {
  it('finds and installs ViaVersion for a Paper 1.21.4 server', async () => {
    const root = await tempDir()
    const store = new ServerStore(join(root, 'servers.json'))
    await store.load()
    const dir = join(root, 'srv')
    await mkdir(dir)
    await store.add({
      id: ID,
      name: 'IT Paper',
      type: 'paper',
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

    const found = await service.search(ID, {
      text: 'viaversion',
      sources: ['hangar'],
      category: null,
      sort: 'relevance',
      cursor: null
    })
    expect(found.hits.length).toBeGreaterThan(0)
    const hit = found.hits[0]

    await service.install(ID, { source: hit.source, projectId: hit.projectId })

    const list = await service.listInstalled(ID)
    expect(list.offline).toEqual([])
    expect(list.items).toContainEqual(
      expect.objectContaining({ source: 'hangar', projectId: hit.projectId })
    )
  })
})
