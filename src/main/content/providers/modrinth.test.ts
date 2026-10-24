import { describe, expect, it, vi } from 'vitest'
import { contentTarget } from '../loaders'
import type { ModrinthClient, ModrinthVersion } from '../modrinth'
import { modrinthProvider, toVersion } from './modrinth'

const MV: ModrinthVersion = {
  id: 'v1',
  project_id: 'P',
  version_number: '1.0',
  version_type: 'beta',
  loaders: ['fabric'],
  game_versions: ['1.21.4'],
  date_published: '2026-10-01T00:00:00Z',
  dependencies: [
    { project_id: 'D', version_id: null, file_name: null, dependency_type: 'required' }
  ],
  files: [
    {
      url: 'https://cdn.modrinth.com/a.jar',
      filename: 'a.jar',
      primary: false,
      size: 5,
      hashes: { sha1: 's1', sha512: 's5' }
    },
    {
      url: 'https://cdn.modrinth.com/b.jar',
      filename: 'b.jar',
      primary: true,
      size: 6,
      hashes: { sha1: 't1', sha512: 't5' }
    }
  ]
}

function client(overrides: Partial<ModrinthClient> = {}): ModrinthClient {
  return {
    search: vi.fn(async () => ({
      hits: [
        {
          project_id: 'P',
          slug: 'p',
          title: 'Pee',
          description: 'd',
          icon_url: null,
          downloads: 3,
          author: 'me',
          date_modified: '2026-10-02T00:00:00Z'
        }
      ],
      total: 1
    })),
    project: vi.fn(async () => ({
      id: 'P',
      slug: 'p',
      title: 'Pee',
      icon_url: 'https://cdn.modrinth.com/i.png',
      server_side: 'optional',
      project_type: 'mod',
      description: 'short',
      body: '# Hi',
      updated: '2026-10-02T00:00:00Z',
      downloads: 3,
      license: { id: 'MIT', name: 'MIT License' },
      gallery: [{ url: 'https://cdn.modrinth.com/g.png', title: 'Shot', ordering: 0 }],
      source_url: 'https://github.com/x',
      issues_url: null,
      wiki_url: 'https://wiki',
      discord_url: null
    })),
    projects: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, slug: id, title: `T-${id}`, icon_url: null, server_side: 'optional' }))
    ),
    version: vi.fn(async () => MV),
    versions: vi.fn(async () => [MV]),
    allVersions: vi.fn(async () => [MV]),
    identify: vi.fn(async () => ({ s1: MV })),
    latest: vi.fn(async () => ({ s1: MV })),
    ...overrides
  }
}

describe('toVersion', () => {
  it('normalizes a Modrinth version using its primary file', () => {
    expect(toVersion(MV)).toEqual({
      id: 'v1',
      projectId: 'P',
      versionNumber: '1.0',
      channel: 'beta',
      publishedAt: '2026-10-01T00:00:00Z',
      mcVersions: ['1.21.4'],
      loaders: ['fabric'],
      file: {
        url: 'https://cdn.modrinth.com/b.jar',
        externalUrl: null,
        filename: 'b.jar',
        size: 6,
        hash: { algo: 'sha512', value: 't5' },
        sha1: 't1'
      },
      dependencies: [
        { projectId: 'D', versionId: null, kind: 'required', name: null, externalUrl: null }
      ]
    })
  })
})

describe('modrinthProvider', () => {
  const fabric = contentTarget('fabric')!

  it('supports mods and plugins', () => {
    const p = modrinthProvider(client())
    expect(p.supports(fabric)).toBe(true)
    expect(p.supports(contentTarget('paper')!)).toBe(true)
    expect(p.downloadHosts).toEqual(['cdn.modrinth.com'])
  })

  it('maps search with sort and category', async () => {
    const c = client()
    const r = await modrinthProvider(c).search({
      target: fabric,
      mcVersion: '1.21.4',
      text: 'x',
      category: 'admin',
      sort: 'updated',
      offset: 20,
      limit: 20
    })
    expect(c.search).toHaveBeenCalledWith(fabric, '1.21.4', 'x', 20, {
      index: 'updated',
      categories: ['management']
    })
    expect(r).toEqual({
      total: 1,
      hits: [
        {
          source: 'modrinth',
          projectId: 'P',
          slug: 'p',
          title: 'Pee',
          author: 'me',
          description: 'd',
          iconUrl: null,
          downloads: 3,
          updatedAt: '2026-10-02T00:00:00Z',
          untestedOnVersion: false
        }
      ]
    })
  })

  it('sorts an empty query by downloads even when relevance is asked for', async () => {
    const c = client()
    await modrinthProvider(c).search({
      target: fabric,
      mcVersion: '1.21.4',
      text: '  ',
      category: null,
      sort: 'relevance',
      offset: 0,
      limit: 20
    })
    expect(c.search).toHaveBeenCalledWith(fabric, '1.21.4', '  ', 0, {
      index: 'downloads',
      categories: undefined
    })
  })

  it('maps project details', async () => {
    const info = await modrinthProvider(client()).project('p')
    expect(info).toEqual({
      id: 'P',
      slug: 'p',
      title: 'Pee',
      author: null,
      summary: 'short',
      iconUrl: 'https://cdn.modrinth.com/i.png',
      downloads: 3,
      updatedAt: '2026-10-02T00:00:00Z',
      license: 'MIT License',
      description: { format: 'markdown', body: '# Hi' },
      gallery: [{ url: 'https://cdn.modrinth.com/g.png', title: 'Shot' }],
      links: [
        { kind: 'page', url: 'https://modrinth.com/mod/p' },
        { kind: 'source', url: 'https://github.com/x' },
        { kind: 'wiki', url: 'https://wiki' }
      ],
      pageUrl: 'https://modrinth.com/mod/p'
    })
  })

  it('identifies jars with titles and icons', async () => {
    const c = client()
    expect(await modrinthProvider(c).identify!(['s1'])).toEqual({
      s1: { projectId: 'P', versionId: 'v1', versionNumber: '1.0', title: 'T-P', iconUrl: null }
    })
    expect(c.projects).toHaveBeenCalledWith(['P'])
  })

  it('passes includeBeta through to latest', async () => {
    const c = client()
    const r = await modrinthProvider(c).latest!(['s1'], fabric, '1.21.4', true)
    expect(c.latest).toHaveBeenCalledWith(['s1'], ['fabric'], '1.21.4', true)
    expect(r.s1.id).toBe('v1')
  })
})
