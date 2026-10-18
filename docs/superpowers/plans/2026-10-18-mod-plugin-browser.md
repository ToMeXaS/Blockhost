# Mod & Plugin Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mods/Plugins tab that searches Modrinth for content compatible with the server, installs it with its required dependencies, and lists installed jars (including hand-added ones) with update and remove.

**Architecture:** A new `src/main/content/` module: `loaders.ts` (server type → folder/loaders), `modrinth.ts` (API client), `manifest.ts` (`<server>/.blockhost/content.json`), `resolver.ts` (version choice + dependency plan), `service.ts` (`ContentService`). Exposed over zod-validated IPC; the renderer gets a `ContentTab`.

**Tech Stack:** Electron, TypeScript, zod 4, React 19, Tailwind 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-18-mod-plugin-browser-design.md`

## Global Constraints

- Modrinth base `https://api.modrinth.com/v2`; header `User-Agent: Blockhost/<app version> (github.com/ToMeXaS/blockhost)`; 15 s request timeout; HTTP 429 → wait `X-Ratelimit-Reset` seconds (min 1, max 60) and retry once.
- Search: `limit=20`; facets = `[["project_type:<mod|plugin>"], [categories:<loader> for each loader], ["versions:<mc>"], ["server_side:required","server_side:optional"]]`; `index=relevance` when the query is non-empty, else `downloads`.
- Loader table: fabric→mods [fabric]; forge→mods [forge]; neoforge→mods [neoforge]; paper→plugins [paper, spigot, bukkit]; purpur→plugins [purpur, paper, spigot, bukkit]; vanilla→none. Labels: Mods / Plugins.
- Version choice: newest `release`, else newest `beta`, else newest `alpha`; primary file, else the first file.
- Only `required` dependencies are installed; `incompatible` with an installed project → `CONTENT_CONFLICT`.
- Downloads verified by sha512 with the existing `downloadFile`; a failed install removes files written by that install.
- Update and Remove require the server stopped or crashed (`SERVER_RUNNING`); Install is allowed while running and reports `restartNeeded`.
- Safe file names: basename only, ends in `.jar`, no `..`, none of `<>:"/\|?*` or control characters, not a Windows reserved device name, no trailing dot or space, ≤ 200 chars → else `CONTENT_BAD_FILENAME`.
- Manifest `<server>/.blockhost/content.json` = `{ version: 1, entries: [{ fileName, projectId, versionId, title, versionNumber, sha1, dependencyOf }] }`, written with `writeFileAtomic`.
- Error codes: `CONTENT_NOT_SUPPORTED`, `CONTENT_NO_COMPATIBLE_VERSION`, `CONTENT_DEPENDENCY_UNAVAILABLE`, `CONTENT_CONFLICT`, `CONTENT_BAD_FILENAME`, `MODRINTH_API`, `SERVER_RUNNING`, `NETWORK`, `NOT_FOUND`.
- CSP `img-src 'self' data: https://cdn.modrinth.com`.
- Deviation from spec §5 (decided while planning): no `content:target` channel — the renderer reads the tab label from the shared `CONTENT_LABELS` constant (same table, no round trip).
- Renderer has no Node access. No `Co-Authored-By` or other attribution lines in commits. Before each commit: `npm run typecheck` and `npm test` pass.

## File Map

| File                                                                                                               | Status | Responsibility                         |
| ------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------- |
| `src/shared/types.ts`                                                                                              | modify | `CONTENT_LABELS`, content result types |
| `src/main/content/loaders.ts`                                                                                      | create | `contentTarget(type)`                  |
| `src/main/content/modrinth.ts`                                                                                     | create | Modrinth client                        |
| `src/main/content/manifest.ts`                                                                                     | create | manifest read/write                    |
| `src/main/content/resolver.ts`                                                                                     | create | `pickVersion`, `planInstall`           |
| `src/main/content/service.ts`                                                                                      | create | `ContentService`, `safeFileName`       |
| `src/main/integration/modrinth.integration.test.ts`                                                                | create | opt-in live install                    |
| `src/main/schemas.ts`                                                                                              | modify | content schemas                        |
| `src/shared/api.ts`, `src/main/ipc.ts`, `src/main/services.ts`, `src/main/index.ts`, `src/renderer/src/lib/api.ts` | modify | wiring                                 |
| `src/renderer/src/pages/tabs/ContentTab.tsx`                                                                       | create | tab UI                                 |
| `src/renderer/src/pages/ServerDetail.tsx`, `src/renderer/index.html`, `docs/smoke-test.md`                         | modify | tab, CSP, smoke items                  |

---

### Task 1: Shared types and the loader table

**Files:**

- Modify: `src/shared/types.ts` (append)
- Create: `src/main/content/loaders.ts`
- Test: `src/main/content/loaders.test.ts`

**Interfaces:**

- Produces (shared):
  ```ts
  export type ContentLabel = 'Mods' | 'Plugins'
  export const CONTENT_LABELS: Record<ServerType, ContentLabel | null>
  export interface ContentSearchHit {
    projectId: string
    slug: string
    title: string
    description: string
    iconUrl: string | null
    downloads: number
    installed: boolean
  }
  export interface ContentSearchResult {
    hits: ContentSearchHit[]
    total: number
  }
  export interface InstalledContent {
    fileName: string
    title: string
    versionNumber: string | null
    source: 'modrinth' | 'manual'
    projectId?: string
    update?: { versionId: string; versionNumber: string }
    neededBy: string[]
  }
  export interface InstalledContentList {
    items: InstalledContent[]
    offline: boolean
  }
  export interface ContentInstallResult {
    installed: { title: string; versionNumber: string; asDependency: boolean }[]
    restartNeeded: boolean
  }
  ```
- Produces (main): `export interface ContentTarget { folder: 'mods' | 'plugins'; loaders: string[]; projectType: 'mod' | 'plugin'; label: ContentLabel }` and `export function contentTarget(type: ServerType): ContentTarget | null` (returns a fresh copy each call).

- [ ] **Step 1: Write the failing test**

Create `src/main/content/loaders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONTENT_LABELS, SERVER_TYPES } from '../../shared/types'
import { contentTarget } from './loaders'

describe('contentTarget', () => {
  it('maps every server type', () => {
    expect(contentTarget('fabric')).toEqual({
      folder: 'mods',
      loaders: ['fabric'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('forge')).toEqual({
      folder: 'mods',
      loaders: ['forge'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('neoforge')).toEqual({
      folder: 'mods',
      loaders: ['neoforge'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('paper')).toEqual({
      folder: 'plugins',
      loaders: ['paper', 'spigot', 'bukkit'],
      projectType: 'plugin',
      label: 'Plugins'
    })
    expect(contentTarget('purpur')).toEqual({
      folder: 'plugins',
      loaders: ['purpur', 'paper', 'spigot', 'bukkit'],
      projectType: 'plugin',
      label: 'Plugins'
    })
    expect(contentTarget('vanilla')).toBeNull()
  })

  it('agrees with the shared labels and returns copies', () => {
    for (const type of SERVER_TYPES)
      expect(contentTarget(type)?.label ?? null).toBe(CONTENT_LABELS[type])
    contentTarget('paper')!.loaders.push('x')
    expect(contentTarget('paper')!.loaders).toEqual(['paper', 'spigot', 'bukkit'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/content/loaders.test.ts`
Expected: FAIL — `./loaders` missing / `CONTENT_LABELS` not exported.

- [ ] **Step 3: Add the shared types**

Append to `src/shared/types.ts`:

```ts
export type ContentLabel = 'Mods' | 'Plugins'

/** Which content tab a server type gets (null = none). */
export const CONTENT_LABELS: Record<ServerType, ContentLabel | null> = {
  vanilla: null,
  paper: 'Plugins',
  purpur: 'Plugins',
  fabric: 'Mods',
  forge: 'Mods',
  neoforge: 'Mods'
}

export interface ContentSearchHit {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  downloads: number
  installed: boolean
}

export interface ContentSearchResult {
  hits: ContentSearchHit[]
  total: number
}

export interface InstalledContent {
  fileName: string
  title: string
  versionNumber: string | null
  source: 'modrinth' | 'manual'
  projectId?: string
  update?: { versionId: string; versionNumber: string }
  /** Titles of installed content that pulled this in as a dependency. */
  neededBy: string[]
}

export interface InstalledContentList {
  items: InstalledContent[]
  /** True when Modrinth could not be reached; items are local files only. */
  offline: boolean
}

export interface ContentInstallResult {
  installed: { title: string; versionNumber: string; asDependency: boolean }[]
  restartNeeded: boolean
}
```

- [ ] **Step 4: Implement `loaders.ts`**

Create `src/main/content/loaders.ts`:

```ts
import type { ContentLabel, ServerType } from '../../shared/types'

export interface ContentTarget {
  folder: 'mods' | 'plugins'
  /** Modrinth loader names accepted by this server, most specific first. */
  loaders: string[]
  projectType: 'mod' | 'plugin'
  label: ContentLabel
}

const MODS = (loader: string): ContentTarget => ({
  folder: 'mods',
  loaders: [loader],
  projectType: 'mod',
  label: 'Mods'
})

const TARGETS: Record<ServerType, ContentTarget | null> = {
  vanilla: null,
  fabric: MODS('fabric'),
  forge: MODS('forge'),
  neoforge: MODS('neoforge'),
  paper: {
    folder: 'plugins',
    loaders: ['paper', 'spigot', 'bukkit'],
    projectType: 'plugin',
    label: 'Plugins'
  },
  purpur: {
    folder: 'plugins',
    loaders: ['purpur', 'paper', 'spigot', 'bukkit'],
    projectType: 'plugin',
    label: 'Plugins'
  }
}

export function contentTarget(type: ServerType): ContentTarget | null {
  const target = TARGETS[type]
  return target ? { ...target, loaders: [...target.loaders] } : null
}
```

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `npx vitest run src/main/content/loaders.test.ts` — PASS. Then `npm run typecheck && npm test` — both pass.

```bash
git add src/shared/types.ts src/main/content/loaders.ts src/main/content/loaders.test.ts
git commit -m "feat: map server types to mod and plugin targets"
```

---

### Task 2: Modrinth client (`modrinth.ts`)

**Files:**

- Create: `src/main/content/modrinth.ts`
- Test: `src/main/content/modrinth.test.ts`

**Interfaces:**

- Consumes: `ContentTarget` (Task 1); `AppError`.
- Produces:

  ```ts
  export const MODRINTH_API = 'https://api.modrinth.com/v2'
  export const SEARCH_LIMIT = 20
  export interface ModrinthFile {
    url: string
    filename: string
    primary: boolean
    size: number
    hashes: { sha1: string; sha512: string }
  }
  export interface ModrinthDependency {
    project_id: string | null
    version_id: string | null
    file_name: string | null
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
  }
  export interface ModrinthVersion {
    id: string
    project_id: string
    version_number: string
    version_type: 'release' | 'beta' | 'alpha'
    loaders: string[]
    game_versions: string[]
    dependencies: ModrinthDependency[]
    files: ModrinthFile[]
  }
  export interface ModrinthProject {
    id: string
    slug: string
    title: string
    icon_url: string | null
    server_side: string
  }
  export interface ModrinthSearchHit {
    project_id: string
    slug: string
    title: string
    description: string
    icon_url: string | null
    downloads: number
  }
  export interface ModrinthClient {
    search(
      target: ContentTarget,
      mcVersion: string,
      query: string,
      offset: number
    ): Promise<{ hits: ModrinthSearchHit[]; total: number }>
    project(idOrSlug: string): Promise<ModrinthProject>
    projects(ids: string[]): Promise<ModrinthProject[]>
    version(id: string): Promise<ModrinthVersion>
    versions(projectId: string, loaders: string[], mcVersion: string): Promise<ModrinthVersion[]>
    identify(sha1s: string[]): Promise<Record<string, ModrinthVersion>>
    latest(
      sha1s: string[],
      loaders: string[],
      mcVersion: string
    ): Promise<Record<string, ModrinthVersion>>
  }
  export interface ModrinthClientOptions {
    userAgent: string
    fetchImpl?: typeof fetch
    base?: string
    timeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  }
  export function searchFacets(target: ContentTarget, mcVersion: string): string[][]
  export function createModrinthClient(opts: ModrinthClientOptions): ModrinthClient
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/content/modrinth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { contentTarget } from './loaders'
import { createModrinthClient, searchFacets } from './modrinth'

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

function fake(
  ...responses: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined
    })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  const sleep = vi.fn(async () => {})
  const client = createModrinthClient({
    userAgent: 'Blockhost/test (x)',
    fetchImpl,
    base: 'https://mr.test/v2',
    sleep
  })
  return { seen, client, sleep }
}

const params = (url: string) => new URL(url).searchParams

describe('searchFacets', () => {
  it('filters by type, loaders, version and server support', () => {
    expect(searchFacets(contentTarget('paper')!, '1.21.4')).toEqual([
      ['project_type:plugin'],
      ['categories:paper', 'categories:spigot', 'categories:bukkit'],
      ['versions:1.21.4'],
      ['server_side:required', 'server_side:optional']
    ])
  })
})

describe('createModrinthClient', () => {
  it('searches by relevance with a query and by downloads without one', async () => {
    const { seen, client } = fake(
      {
        body: {
          hits: [
            {
              project_id: 'AANobbMI',
              slug: 'sodium',
              title: 'Sodium',
              description: 'd',
              icon_url: null,
              downloads: 5
            }
          ],
          total_hits: 1
        }
      },
      { body: { hits: [], total_hits: 0 } }
    )
    const r = await client.search(contentTarget('fabric')!, '1.21.4', 'sodium', 20)
    expect(r).toEqual({
      hits: [
        {
          project_id: 'AANobbMI',
          slug: 'sodium',
          title: 'Sodium',
          description: 'd',
          icon_url: null,
          downloads: 5
        }
      ],
      total: 1
    })
    const p = params(seen[0].url)
    expect(seen[0].url.startsWith('https://mr.test/v2/search?')).toBe(true)
    expect(p.get('query')).toBe('sodium')
    expect(p.get('index')).toBe('relevance')
    expect(p.get('offset')).toBe('20')
    expect(p.get('limit')).toBe('20')
    expect(JSON.parse(p.get('facets')!)).toEqual(searchFacets(contentTarget('fabric')!, '1.21.4'))
    expect(seen[0].headers['User-Agent']).toBe('Blockhost/test (x)')

    await client.search(contentTarget('fabric')!, '1.21.4', '', 0)
    expect(params(seen[1].url).get('index')).toBe('downloads')
    expect(params(seen[1].url).has('query')).toBe(false)
  })

  it('lists versions filtered by loaders and game version', async () => {
    const { seen, client } = fake({ body: [] })
    await client.versions('AANobbMI', ['fabric'], '1.21.4')
    const u = new URL(seen[0].url)
    expect(u.pathname).toBe('/v2/project/AANobbMI/version')
    expect(JSON.parse(u.searchParams.get('loaders')!)).toEqual(['fabric'])
    expect(JSON.parse(u.searchParams.get('game_versions')!)).toEqual(['1.21.4'])
  })

  it('fetches projects in bulk and single projects and versions', async () => {
    const { seen, client } = fake(
      { body: [{ id: 'a' }] },
      { body: { id: 'b' } },
      { body: { id: 'v' } }
    )
    expect(await client.projects(['a'])).toEqual([{ id: 'a' }])
    expect(JSON.parse(params(seen[0].url).get('ids')!)).toEqual(['a'])
    await client.project('sodium')
    expect(new URL(seen[1].url).pathname).toBe('/v2/project/sodium')
    await client.version('v')
    expect(new URL(seen[2].url).pathname).toBe('/v2/version/v')
  })

  it('identifies and checks updates by sha1 with POST bodies', async () => {
    const { seen, client } = fake({ body: { h1: { id: 'v1' } } }, { body: { h1: { id: 'v2' } } })
    expect(await client.identify(['h1'])).toEqual({ h1: { id: 'v1' } })
    expect(seen[0]).toMatchObject({ method: 'POST', body: { hashes: ['h1'], algorithm: 'sha1' } })
    expect(new URL(seen[0].url).pathname).toBe('/v2/version_files')
    await client.latest(['h1'], ['fabric'], '1.21.4')
    expect(seen[1]).toMatchObject({
      method: 'POST',
      body: { hashes: ['h1'], algorithm: 'sha1', loaders: ['fabric'], game_versions: ['1.21.4'] }
    })
    expect(new URL(seen[1].url).pathname).toBe('/v2/version_files/update')
  })

  it('skips the request for an empty hash list', async () => {
    const { seen, client } = fake()
    expect(await client.identify([])).toEqual({})
    expect(await client.latest([], ['fabric'], '1.21.4')).toEqual({})
    expect(seen).toHaveLength(0)
  })

  it('waits out a rate limit once and retries', async () => {
    const { seen, client, sleep } = fake(
      { status: 429, body: {}, headers: { 'X-Ratelimit-Reset': '7' } },
      { body: { id: 'v' } }
    )
    expect(await client.version('v')).toEqual({ id: 'v' })
    expect(sleep).toHaveBeenCalledWith(7000)
    expect(seen).toHaveLength(2)
  })

  it('maps errors', async () => {
    const { client } = fake(
      { status: 404, body: { error: 'not_found' } },
      { status: 429, body: {}, headers: { 'X-Ratelimit-Reset': '1' } },
      { status: 429, body: {} }
    )
    await expect(client.project('nope')).rejects.toMatchObject({
      code: 'MODRINTH_API',
      details: { status: 404 }
    })
    await expect(client.project('busy')).rejects.toMatchObject({
      code: 'MODRINTH_API',
      details: { status: 429 }
    })

    const offline = createModrinthClient({
      userAgent: 'x',
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }) as unknown as typeof fetch
    })
    await expect(offline.project('a')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('times out slow requests', async () => {
    const hanging = createModrinthClient({
      userAgent: 'x',
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as unknown as typeof fetch
    })
    await expect(hanging.project('a')).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('did not respond')
    })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/content/modrinth.test.ts`
Expected: FAIL — `./modrinth` missing.

- [ ] **Step 3: Implement `modrinth.ts`**

Create `src/main/content/modrinth.ts`:

```ts
import { AppError } from '../errors'
import type { ContentTarget } from './loaders'

export const MODRINTH_API = 'https://api.modrinth.com/v2'
export const SEARCH_LIMIT = 20
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RATE_LIMIT_WAIT_S = 60

export interface ModrinthFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha1: string; sha512: string }
}

export interface ModrinthDependency {
  project_id: string | null
  version_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ModrinthVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  loaders: string[]
  game_versions: string[]
  dependencies: ModrinthDependency[]
  files: ModrinthFile[]
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  icon_url: string | null
  server_side: string
}

export interface ModrinthSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
}

export interface ModrinthClient {
  search(
    target: ContentTarget,
    mcVersion: string,
    query: string,
    offset: number
  ): Promise<{ hits: ModrinthSearchHit[]; total: number }>
  project(idOrSlug: string): Promise<ModrinthProject>
  projects(ids: string[]): Promise<ModrinthProject[]>
  version(id: string): Promise<ModrinthVersion>
  versions(projectId: string, loaders: string[], mcVersion: string): Promise<ModrinthVersion[]>
  identify(sha1s: string[]): Promise<Record<string, ModrinthVersion>>
  latest(
    sha1s: string[],
    loaders: string[],
    mcVersion: string
  ): Promise<Record<string, ModrinthVersion>>
}

export interface ModrinthClientOptions {
  userAgent: string
  fetchImpl?: typeof fetch
  base?: string
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export function searchFacets(target: ContentTarget, mcVersion: string): string[][] {
  return [
    [`project_type:${target.projectType}`],
    target.loaders.map((loader) => `categories:${loader}`),
    [`versions:${mcVersion}`],
    ['server_side:required', 'server_side:optional']
  ]
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
const enc = (value: unknown): string => encodeURIComponent(JSON.stringify(value))

export function createModrinthClient(opts: ModrinthClientOptions): ModrinthClient {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = opts.base ?? MODRINTH_API
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = opts.sleep ?? defaultSleep

  async function send(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': opts.userAgent }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      const name = (err as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AppError('NETWORK', 'Modrinth did not respond in time.')
      }
      throw new AppError('NETWORK', `Could not reach Modrinth: ${(err as Error).message}`)
    }
  }

  async function request<T>(path: string, body?: unknown): Promise<T> {
    let res = await send(path, body)
    if (res.status === 429) {
      const reset = Number(res.headers.get('X-Ratelimit-Reset'))
      const seconds = Number.isFinite(reset)
        ? Math.min(Math.max(reset, 1), MAX_RATE_LIMIT_WAIT_S)
        : 1
      await sleep(seconds * 1000)
      res = await send(path, body)
    }
    if (!res.ok) {
      throw new AppError('MODRINTH_API', `Modrinth returned HTTP ${res.status}`, {
        status: res.status
      })
    }
    try {
      return (await res.json()) as T
    } catch {
      throw new AppError('MODRINTH_API', 'Modrinth returned an unreadable response', {
        status: res.status
      })
    }
  }

  return {
    async search(target, mcVersion, query, offset) {
      const q = query.trim()
      const parts = [
        ...(q ? [`query=${encodeURIComponent(q)}`] : []),
        `facets=${enc(searchFacets(target, mcVersion))}`,
        `index=${q ? 'relevance' : 'downloads'}`,
        `offset=${offset}`,
        `limit=${SEARCH_LIMIT}`
      ]
      const r = await request<{ hits: ModrinthSearchHit[]; total_hits: number }>(
        `/search?${parts.join('&')}`
      )
      return { hits: r.hits, total: r.total_hits }
    },
    project: (idOrSlug) => request<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`),
    projects: (ids) =>
      ids.length ? request<ModrinthProject[]>(`/projects?ids=${enc(ids)}`) : Promise.resolve([]),
    version: (id) => request<ModrinthVersion>(`/version/${encodeURIComponent(id)}`),
    versions: (projectId, loaders, mcVersion) =>
      request<ModrinthVersion[]>(
        `/project/${encodeURIComponent(projectId)}/version?loaders=${enc(loaders)}&game_versions=${enc([mcVersion])}`
      ),
    identify: async (sha1s) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files', {
            hashes: sha1s,
            algorithm: 'sha1'
          })
        : {},
    latest: async (sha1s, loaders, mcVersion) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files/update', {
            hashes: sha1s,
            algorithm: 'sha1',
            loaders,
            game_versions: [mcVersion]
          })
        : {}
  }
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run src/main/content/modrinth.test.ts` — PASS. Then `npm run typecheck && npm test`.

```bash
git add src/main/content/modrinth.ts src/main/content/modrinth.test.ts
git commit -m "feat: add Modrinth API client"
```

---

### Task 3: Content manifest (`manifest.ts`)

**Files:**

- Create: `src/main/content/manifest.ts`
- Test: `src/main/content/manifest.test.ts`

**Interfaces:**

- Consumes: `writeFileAtomic` (`src/main/util/fs.ts`), `tempDir` (`src/main/test-utils.ts`).
- Produces:

  ```ts
  export interface ManifestEntry {
    fileName: string
    projectId: string
    versionId: string
    title: string
    versionNumber: string
    sha1: string
    dependencyOf: string[]
  }
  export interface Manifest {
    version: 1
    entries: ManifestEntry[]
  }
  export function manifestPath(serverDir: string): string // <dir>/.blockhost/content.json
  export function readManifest(serverDir: string): Promise<Manifest>
  export function writeManifest(serverDir: string, manifest: Manifest): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/content/manifest.test.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { manifestPath, readManifest, writeManifest, type ManifestEntry } from './manifest'

const entry: ManifestEntry = {
  fileName: 'sodium-0.6.jar',
  projectId: 'AANobbMI',
  versionId: 'v1',
  title: 'Sodium',
  versionNumber: '0.6.0',
  sha1: 'abc',
  dependencyOf: []
}

describe('manifest', () => {
  it('lives under .blockhost', () => {
    expect(manifestPath('C:/srv')).toBe(join('C:/srv', '.blockhost', 'content.json'))
  })

  it('reads a missing manifest as empty', async () => {
    expect(await readManifest(await tempDir())).toEqual({ version: 1, entries: [] })
  })

  it('round-trips', async () => {
    const dir = await tempDir()
    await writeManifest(dir, { version: 1, entries: [entry] })
    expect(JSON.parse(await readFile(manifestPath(dir), 'utf8'))).toEqual({
      version: 1,
      entries: [entry]
    })
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [entry] })
  })

  it('treats a corrupt file as empty and drops malformed entries', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.blockhost'))
    await writeFile(manifestPath(dir), '{not json')
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [] })
    await writeFile(
      manifestPath(dir),
      JSON.stringify({
        version: 1,
        entries: [entry, { fileName: 'x.jar' }, 'junk', { ...entry, dependencyOf: 'no' }]
      })
    )
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [entry] })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/content/manifest.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `manifest.ts`**

Create `src/main/content/manifest.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../util/fs'

export interface ManifestEntry {
  fileName: string
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  sha1: string
  /** Project ids of installed content that pulled this entry in as a dependency. */
  dependencyOf: string[]
}

export interface Manifest {
  version: 1
  entries: ManifestEntry[]
}

const STRING_FIELDS = [
  'fileName',
  'projectId',
  'versionId',
  'title',
  'versionNumber',
  'sha1'
] as const

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    STRING_FIELDS.every((k) => typeof v[k] === 'string') &&
    Array.isArray(v.dependencyOf) &&
    v.dependencyOf.every((d) => typeof d === 'string')
  )
}

export function manifestPath(serverDir: string): string {
  return join(serverDir, '.blockhost', 'content.json')
}

export async function readManifest(serverDir: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(serverDir), 'utf8')) as {
      entries?: unknown
    }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(isEntry) : []
    return { version: 1, entries }
  } catch {
    return { version: 1, entries: [] }
  }
}

export async function writeManifest(serverDir: string, manifest: Manifest): Promise<void> {
  await writeFileAtomic(manifestPath(serverDir), `${JSON.stringify(manifest, null, 2)}\n`)
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run src/main/content/manifest.test.ts` — PASS. Then `npm run typecheck && npm test`.

```bash
git add src/main/content/manifest.ts src/main/content/manifest.test.ts
git commit -m "feat: record installed content in a manifest"
```

---

### Task 4: Version choice and dependency plan (`resolver.ts`)

**Files:**

- Create: `src/main/content/resolver.ts`
- Test: `src/main/content/resolver.test.ts`

**Interfaces:**

- Consumes: `ModrinthClient`, `ModrinthVersion`, `ModrinthFile` (Task 2); `AppError`.
- Produces:
  ```ts
  export interface PlanFile {
    url: string
    filename: string
    sha1: string
    sha512: string
    size: number
  }
  export interface PlanItem {
    projectId: string
    versionId: string
    title: string
    versionNumber: string
    file: PlanFile
    dependencyOf: string[]
  }
  export interface ResolveContext {
    client: Pick<ModrinthClient, 'project' | 'version' | 'versions'>
    loaders: string[]
    mcVersion: string
    installedProjectIds: Set<string>
    /** e.g. "Paper 1.21.4", used in messages */
    targetLabel: string
  }
  export function isCompatible(v: ModrinthVersion, loaders: string[], mcVersion: string): boolean
  export function pickVersion(versions: ModrinthVersion[]): ModrinthVersion | null
  export function primaryFile(v: ModrinthVersion): ModrinthFile
  export function planInstall(
    projectIdOrSlug: string,
    ctx: ResolveContext,
    versionId?: string
  ): Promise<PlanItem[]>
  ```
- Behaviour: the root project comes first in the returned list; dependencies follow in depth-first order. An installed root returns `[]`. `versionId` (used by updates) is preferred for the root when compatible.

- [ ] **Step 1: Write the failing tests**

Create `src/main/content/resolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import type { ModrinthDependency, ModrinthProject, ModrinthVersion } from './modrinth'
import { isCompatible, pickVersion, planInstall, type ResolveContext } from './resolver'

const project = (id: string, slug: string, title: string): ModrinthProject => ({
  id,
  slug,
  title,
  icon_url: null,
  server_side: 'optional'
})

const version = (
  id: string,
  projectId: string,
  opts: {
    type?: ModrinthVersion['version_type']
    deps?: ModrinthDependency[]
    loaders?: string[]
    game?: string[]
  } = {}
): ModrinthVersion => ({
  id,
  project_id: projectId,
  version_number: `${id}-num`,
  version_type: opts.type ?? 'release',
  loaders: opts.loaders ?? ['fabric'],
  game_versions: opts.game ?? ['1.21.4'],
  dependencies: opts.deps ?? [],
  files: [
    {
      url: `https://cdn/${id}.jar`,
      filename: `${id}.jar`,
      primary: true,
      size: 1,
      hashes: { sha1: `s1-${id}`, sha512: `s5-${id}` }
    }
  ]
})

const req = (projectId: string | null, versionId: string | null = null): ModrinthDependency => ({
  project_id: projectId,
  version_id: versionId,
  file_name: null,
  dependency_type: 'required'
})

function ctx(
  projects: ModrinthProject[],
  versions: ModrinthVersion[],
  installed: string[] = []
): ResolveContext {
  const find = (idOrSlug: string) => {
    const p = projects.find((x) => x.id === idOrSlug || x.slug === idOrSlug)
    if (!p) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
    return p
  }
  return {
    client: {
      project: vi.fn(async (id: string) => find(id)),
      version: vi.fn(async (id: string) => {
        const v = versions.find((x) => x.id === id)
        if (!v) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
        return v
      }),
      versions: vi.fn(async (pid: string, loaders: string[], mc: string) =>
        versions.filter((v) => v.project_id === pid && isCompatible(v, loaders, mc))
      )
    },
    loaders: ['fabric'],
    mcVersion: '1.21.4',
    installedProjectIds: new Set(installed),
    targetLabel: 'Fabric 1.21.4'
  }
}

describe('pickVersion', () => {
  it('prefers the newest release, then beta, then alpha', () => {
    const a = version('a', 'p', { type: 'alpha' })
    const b = version('b', 'p', { type: 'beta' })
    const r1 = version('r1', 'p')
    const r2 = version('r2', 'p')
    expect(pickVersion([a, b, r1, r2])?.id).toBe('r1')
    expect(pickVersion([a, b])?.id).toBe('b')
    expect(pickVersion([a])?.id).toBe('a')
    expect(pickVersion([])).toBeNull()
  })
})

describe('isCompatible', () => {
  it('needs a shared loader and the game version', () => {
    expect(isCompatible(version('x', 'p'), ['fabric'], '1.21.4')).toBe(true)
    expect(isCompatible(version('x', 'p', { loaders: ['forge'] }), ['fabric'], '1.21.4')).toBe(
      false
    )
    expect(isCompatible(version('x', 'p', { game: ['1.21.1'] }), ['fabric'], '1.21.4')).toBe(false)
  })
})

describe('planInstall', () => {
  const SODIUM = project('AANobbMI', 'sodium', 'Sodium')
  const API = project('P7dR8mSH', 'fabric-api', 'Fabric API')
  const LIB = project('LIBLIBLI', 'some-lib', 'Some Lib')

  it('plans the project and its required dependency chain, root first', async () => {
    const c = ctx(
      [SODIUM, API, LIB],
      [
        version('s1', SODIUM.id, {
          deps: [req(API.id), { ...req(LIB.id), dependency_type: 'optional' }]
        }),
        version('a1', API.id, { deps: [req(LIB.id)] }),
        version('l1', LIB.id)
      ]
    )
    const plan = await planInstall('sodium', c)
    expect(plan.map((i) => [i.projectId, i.versionId, i.dependencyOf])).toEqual([
      [SODIUM.id, 's1', []],
      [API.id, 'a1', [SODIUM.id]],
      [LIB.id, 'l1', [API.id]]
    ])
    expect(plan[0]).toMatchObject({
      title: 'Sodium',
      versionNumber: 's1-num',
      file: {
        url: 'https://cdn/s1.jar',
        filename: 's1.jar',
        sha1: 's1-s1',
        sha512: 's5-s1',
        size: 1
      }
    })
  })

  it('handles dependency cycles and records every parent', async () => {
    const c = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id)] }),
        version('a1', API.id, { deps: [req(SODIUM.id)] })
      ]
    )
    const plan = await planInstall(SODIUM.id, c)
    expect(plan.map((i) => i.projectId)).toEqual([SODIUM.id, API.id])
  })

  it('skips projects that are already installed', async () => {
    const c = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [req(API.id)] }), version('a1', API.id)],
      [API.id]
    )
    expect((await planInstall('sodium', c)).map((i) => i.projectId)).toEqual([SODIUM.id])
    const installedRoot = ctx([SODIUM], [version('s1', SODIUM.id)], [SODIUM.id])
    expect(await planInstall('sodium', installedRoot)).toEqual([])
  })

  it('uses a pinned dependency version when compatible, else the best compatible one', async () => {
    const pinnedOk = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id, 'a-old')] }),
        version('a-old', API.id),
        version('a-new', API.id)
      ]
    )
    expect((await planInstall('sodium', pinnedOk))[1].versionId).toBe('a-old')

    const pinnedBad = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id, 'a-forge')] }),
        version('a-forge', API.id, { loaders: ['forge'] }),
        version('a-new', API.id)
      ]
    )
    expect((await planInstall('sodium', pinnedBad))[1].versionId).toBe('a-new')

    const byVersionOnly = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [req(null, 'a1')] }), version('a1', API.id)]
    )
    expect((await planInstall('sodium', byVersionOnly))[1].projectId).toBe(API.id)
  })

  it('reports a project with no compatible version', async () => {
    const c = ctx([SODIUM], [version('s1', SODIUM.id, { game: ['1.20.1'] })])
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_NO_COMPATIBLE_VERSION',
      message: 'No version of Sodium supports Fabric 1.21.4.'
    })
  })

  it('reports an unavailable required dependency and plans nothing', async () => {
    const c = ctx([SODIUM, API], [version('s1', SODIUM.id, { deps: [req(API.id)] })])
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_DEPENDENCY_UNAVAILABLE',
      message: 'Sodium needs Fabric API, which has no version for Fabric 1.21.4.'
    })
  })

  it('reports a conflict with installed content', async () => {
    const c = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [{ ...req(API.id), dependency_type: 'incompatible' }] })],
      [API.id]
    )
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_CONFLICT',
      message: 'Sodium cannot be installed together with Fabric API.'
    })
  })

  it('prefers the requested version for the root (updates)', async () => {
    const c = ctx([SODIUM], [version('s2', SODIUM.id), version('s1', SODIUM.id)])
    expect((await planInstall('sodium', c, 's1'))[0].versionId).toBe('s1')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/content/resolver.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `resolver.ts`**

Create `src/main/content/resolver.ts`:

```ts
import { AppError } from '../errors'
import type { ModrinthClient, ModrinthFile, ModrinthVersion } from './modrinth'

export interface PlanFile {
  url: string
  filename: string
  sha1: string
  sha512: string
  size: number
}

export interface PlanItem {
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  file: PlanFile
  dependencyOf: string[]
}

export interface ResolveContext {
  client: Pick<ModrinthClient, 'project' | 'version' | 'versions'>
  loaders: string[]
  mcVersion: string
  installedProjectIds: Set<string>
  targetLabel: string
}

const TYPE_ORDER: ModrinthVersion['version_type'][] = ['release', 'beta', 'alpha']

export function isCompatible(v: ModrinthVersion, loaders: string[], mcVersion: string): boolean {
  return v.game_versions.includes(mcVersion) && v.loaders.some((l) => loaders.includes(l))
}

/** `versions` is newest first, as Modrinth returns them. */
export function pickVersion(versions: ModrinthVersion[]): ModrinthVersion | null {
  for (const type of TYPE_ORDER) {
    const found = versions.find((v) => v.version_type === type && v.files.length > 0)
    if (found) return found
  }
  return null
}

export function primaryFile(v: ModrinthVersion): ModrinthFile {
  return v.files.find((f) => f.primary) ?? v.files[0]
}

export async function planInstall(
  projectIdOrSlug: string,
  ctx: ResolveContext,
  versionId?: string
): Promise<PlanItem[]> {
  const items: PlanItem[] = []
  const byProject = new Map<string, PlanItem>()

  async function compatibleVersion(id: string | null): Promise<ModrinthVersion | null> {
    if (!id) return null
    try {
      const v = await ctx.client.version(id)
      return isCompatible(v, ctx.loaders, ctx.mcVersion) && v.files.length > 0 ? v : null
    } catch {
      return null
    }
  }

  async function visit(
    idOrSlug: string,
    pinnedVersion: string | null,
    parent: PlanItem | null
  ): Promise<void> {
    const project = await ctx.client.project(idOrSlug)
    if (ctx.installedProjectIds.has(project.id)) return
    const existing = byProject.get(project.id)
    if (existing) {
      if (parent && !existing.dependencyOf.includes(parent.projectId) && existing !== parent) {
        existing.dependencyOf.push(parent.projectId)
      }
      return
    }

    const version =
      (await compatibleVersion(pinnedVersion)) ??
      pickVersion(await ctx.client.versions(project.id, ctx.loaders, ctx.mcVersion))
    if (!version) {
      if (parent) {
        throw new AppError(
          'CONTENT_DEPENDENCY_UNAVAILABLE',
          `${parent.title} needs ${project.title}, which has no version for ${ctx.targetLabel}.`
        )
      }
      throw new AppError(
        'CONTENT_NO_COMPATIBLE_VERSION',
        `No version of ${project.title} supports ${ctx.targetLabel}.`
      )
    }

    const file = primaryFile(version)
    const item: PlanItem = {
      projectId: project.id,
      versionId: version.id,
      title: project.title,
      versionNumber: version.version_number,
      file: {
        url: file.url,
        filename: file.filename,
        sha1: file.hashes.sha1,
        sha512: file.hashes.sha512,
        size: file.size
      },
      dependencyOf: parent ? [parent.projectId] : []
    }
    items.push(item)
    byProject.set(project.id, item)

    for (const dep of version.dependencies) {
      if (
        dep.dependency_type === 'incompatible' &&
        dep.project_id &&
        ctx.installedProjectIds.has(dep.project_id)
      ) {
        const other = await ctx.client.project(dep.project_id)
        throw new AppError(
          'CONTENT_CONFLICT',
          `${project.title} cannot be installed together with ${other.title}.`
        )
      }
    }
    for (const dep of version.dependencies) {
      if (dep.dependency_type !== 'required') continue
      let depProject = dep.project_id
      if (!depProject && dep.version_id) {
        try {
          depProject = (await ctx.client.version(dep.version_id)).project_id
        } catch {
          depProject = null
        }
      }
      if (!depProject) continue
      await visit(depProject, dep.version_id, item)
    }
  }

  await visit(projectIdOrSlug, versionId ?? null, null)
  return items
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run src/main/content/resolver.test.ts` — PASS. If a test fails, fix the code to the behaviour the test states; do not weaken a test. Then `npm run typecheck && npm test`.

```bash
git add src/main/content/resolver.ts src/main/content/resolver.test.ts
git commit -m "feat: resolve compatible versions and required dependencies"
```

---

### Task 5: `ContentService` and the live install check

**Files:**

- Create: `src/main/content/service.ts`
- Create: `src/main/integration/modrinth.integration.test.ts`
- Test: `src/main/content/service.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4; `ServerStore` (`get`); `ProcessManager` (`status`); `DownloadFn` (`src/main/net/download.ts`, verifies `hash` and writes atomically via `.part`); `pathExists` (`src/main/util/fs.ts`); `SERVER_TYPE_LABELS`; `AppError`; `tempDir`.
- Produces:
  ```ts
  export function safeFileName(name: string): string // throws CONTENT_BAD_FILENAME
  export function sha1File(path: string): Promise<string>
  export interface ContentServiceDeps {
    store: Pick<ServerStore, 'get'>
    processes: Pick<ProcessManager, 'status'>
    client: ModrinthClient
    download: DownloadFn
    hashFile?: (path: string) => Promise<string> // sha1, defaults to sha1File
  }
  export class ContentService {
    constructor(deps: ContentServiceDeps)
    search(serverId: string, query: string, offset: number): Promise<ContentSearchResult>
    listInstalled(serverId: string): Promise<InstalledContentList>
    install(serverId: string, projectIdOrSlug: string): Promise<ContentInstallResult>
    update(serverId: string, fileName: string): Promise<ContentInstallResult>
    remove(serverId: string, fileName: string): Promise<void>
  }
  ```
- Behaviour notes: all operations for one server run one at a time (a per-server promise chain). `listInstalled` hashes every `.jar` in the content folder; files whose name and sha1 match a manifest entry are known; the rest are identified with one `identify` call and titled with one `projects` call; manifest entries whose file is gone are dropped; the manifest is rewritten only if it changed; one `latest` call gives updates. Modrinth errors (`NETWORK`, `MODRINTH_API`) during identify/latest make the result `offline: true` instead of failing. `neededBy` = titles of installed entries whose projectId is in this entry's `dependencyOf`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/content/service.test.ts`:

```ts
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ServerStatus, ServerType } from '../../shared/types'
import { AppError } from '../errors'
import type { DownloadOptions } from '../net/download'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'
import { readManifest, writeManifest } from './manifest'
import type { ModrinthClient, ModrinthProject, ModrinthVersion } from './modrinth'
import { ContentService, safeFileName } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SODIUM: ModrinthProject = {
  id: 'AANobbMI',
  slug: 'sodium',
  title: 'Sodium',
  icon_url: null,
  server_side: 'optional'
}
const API: ModrinthProject = {
  id: 'P7dR8mSH',
  slug: 'fabric-api',
  title: 'Fabric API',
  icon_url: null,
  server_side: 'optional'
}

function ver(
  id: string,
  projectId: string,
  filename: string,
  deps: string[] = []
): ModrinthVersion {
  return {
    id,
    project_id: projectId,
    version_number: `${id}-num`,
    version_type: 'release',
    loaders: ['fabric'],
    game_versions: ['1.21.4'],
    dependencies: deps.map((d) => ({
      project_id: d,
      version_id: null,
      file_name: null,
      dependency_type: 'required' as const
    })),
    files: [
      {
        url: `https://cdn/${filename}`,
        filename,
        primary: true,
        size: 1,
        hashes: { sha1: `sha1-${id}`, sha512: `sha512-${id}` }
      }
    ]
  }
}

async function setup(opts: { type?: ServerType; status?: ServerStatus } = {}) {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const dir = join(root, 'srv')
  await mkdir(dir)
  await store.add({
    id: ID,
    name: 'SMP',
    type: opts.type ?? 'fabric',
    mcVersion: '1.21.4',
    dir,
    ramMb: 2048,
    port: 25565,
    jvmArgs: [],
    launch: { args: [] },
    installState: 'ready',
    createdAt: '2026-10-18T12:00:00.000Z'
  })
  const projects = [SODIUM, API]
  const versions: ModrinthVersion[] = [
    ver('s1', SODIUM.id, 'sodium-1.jar', [API.id]),
    ver('a1', API.id, 'fabric-api-1.jar')
  ]
  const find = (idOrSlug: string) => {
    const p = projects.find((x) => x.id === idOrSlug || x.slug === idOrSlug)
    if (!p) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
    return p
  }
  const client = {
    search: vi.fn(async () => ({
      hits: [
        {
          project_id: SODIUM.id,
          slug: 'sodium',
          title: 'Sodium',
          description: 'Fast',
          icon_url: 'https://cdn.modrinth.com/i.png',
          downloads: 9
        },
        {
          project_id: API.id,
          slug: 'fabric-api',
          title: 'Fabric API',
          description: 'API',
          icon_url: null,
          downloads: 8
        }
      ],
      total: 2
    })),
    project: vi.fn(async (id: string) => find(id)),
    projects: vi.fn(async (ids: string[]) => ids.map(find)),
    version: vi.fn(async (id: string) => versions.find((v) => v.id === id)!),
    versions: vi.fn(async (pid: string) => versions.filter((v) => v.project_id === pid)),
    identify: vi.fn(async (): Promise<Record<string, ModrinthVersion>> => ({})),
    latest: vi.fn(async (): Promise<Record<string, ModrinthVersion>> => ({}))
  } satisfies ModrinthClient
  const downloads: DownloadOptions[] = []
  const download = vi.fn(async (o: DownloadOptions) => {
    downloads.push(o)
    await mkdir(join(o.dest, '..'), { recursive: true })
    await writeFile(o.dest, 'jar')
  })
  const hashes: Record<string, string> = {}
  const processes = { status: vi.fn((): ServerStatus => opts.status ?? 'stopped') }
  const service = new ContentService({
    store,
    processes,
    client,
    download,
    hashFile: async (p) => hashes[basename(p)] ?? `unknown-${basename(p)}`
  })
  const mods = join(dir, 'mods')
  return { store, dir, mods, client, versions, download, downloads, hashes, processes, service }
}

describe('safeFileName', () => {
  it('accepts plain jar names and rejects anything else', () => {
    expect(safeFileName('sodium-fabric-0.6.0+mc1.21.4.jar')).toBe(
      'sodium-fabric-0.6.0+mc1.21.4.jar'
    )
    for (const bad of [
      '../evil.jar',
      'a/b.jar',
      'a\\b.jar',
      'evil.exe',
      'x.jar ',
      'CON.jar',
      'a:b.jar',
      'a\u0000.jar',
      '',
      'x'.repeat(201) + '.jar',
      '..jar'
    ]) {
      expect(() => safeFileName(bad), bad).toThrowError(
        expect.objectContaining({ code: 'CONTENT_BAD_FILENAME' })
      )
    }
  })
})

describe('ContentService', () => {
  it('refuses servers without mods or plugins', async () => {
    const { service } = await setup({ type: 'vanilla' })
    await expect(service.search(ID, '', 0)).rejects.toMatchObject({ code: 'CONTENT_NOT_SUPPORTED' })
  })

  it('searches and marks installed projects', async () => {
    const { service, dir, client } = await setup()
    await writeManifest(dir, {
      version: 1,
      entries: [
        {
          fileName: 'fabric-api-1.jar',
          projectId: API.id,
          versionId: 'a1',
          title: 'Fabric API',
          versionNumber: '1',
          sha1: 'x',
          dependencyOf: []
        }
      ]
    })
    const r = await service.search(ID, 'sod', 20)
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'mods' }),
      '1.21.4',
      'sod',
      20
    )
    expect(r).toEqual({
      total: 2,
      hits: [
        {
          projectId: SODIUM.id,
          slug: 'sodium',
          title: 'Sodium',
          description: 'Fast',
          iconUrl: 'https://cdn.modrinth.com/i.png',
          downloads: 9,
          installed: false
        },
        {
          projectId: API.id,
          slug: 'fabric-api',
          title: 'Fabric API',
          description: 'API',
          iconUrl: null,
          downloads: 8,
          installed: true
        }
      ]
    })
  })

  it('installs a project with its dependency, verifying sha512', async () => {
    const { service, mods, dir, downloads } = await setup()
    const result = await service.install(ID, 'sodium')
    expect(result).toEqual({
      installed: [
        { title: 'Sodium', versionNumber: 's1-num', asDependency: false },
        { title: 'Fabric API', versionNumber: 'a1-num', asDependency: true }
      ],
      restartNeeded: false
    })
    expect(downloads.map((d) => [basename(d.dest), d.hash])).toEqual([
      ['sodium-1.jar', { algo: 'sha512', value: 'sha512-s1' }],
      ['fabric-api-1.jar', { algo: 'sha512', value: 'sha512-a1' }]
    ])
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect((await readManifest(dir)).entries).toEqual([
      {
        fileName: 'sodium-1.jar',
        projectId: SODIUM.id,
        versionId: 's1',
        title: 'Sodium',
        versionNumber: 's1-num',
        sha1: 'sha1-s1',
        dependencyOf: []
      },
      {
        fileName: 'fabric-api-1.jar',
        projectId: API.id,
        versionId: 'a1',
        title: 'Fabric API',
        versionNumber: 'a1-num',
        sha1: 'sha1-a1',
        dependencyOf: [SODIUM.id]
      }
    ])
  })

  it('reports that a restart is needed while the server runs', async () => {
    const { service } = await setup({ status: 'running' })
    expect((await service.install(ID, 'sodium')).restartNeeded).toBe(true)
  })

  it('removes files it wrote when a later download fails', async () => {
    const { service, mods, dir, download } = await setup()
    download.mockImplementationOnce(async (o: DownloadOptions) => {
      await mkdir(mods, { recursive: true })
      await writeFile(o.dest, 'jar')
    })
    download.mockRejectedValueOnce(
      new AppError('HASH_MISMATCH', 'Checksum mismatch for fabric-api-1.jar')
    )
    await expect(service.install(ID, 'sodium')).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(await readdir(mods)).toEqual([])
    expect((await readManifest(dir)).entries).toEqual([])
  })

  it('skips a download when a file with that name exists', async () => {
    const { service, mods, download } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'fabric-api-1.jar'), 'mine')
    await service.install(ID, 'sodium')
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe file names from Modrinth before writing anything', async () => {
    const { service, versions, download } = await setup()
    versions[0].files[0].filename = '..\\..\\evil.jar'
    await expect(service.install(ID, 'sodium')).rejects.toMatchObject({
      code: 'CONTENT_BAD_FILENAME'
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('lists installed jars, identifies manual ones and finds updates', async () => {
    const { service, mods, dir, client, hashes } = await setup()
    await mkdir(mods)
    for (const f of ['sodium-1.jar', 'mystery.jar', 'api-by-hand.jar', 'notes.txt'])
      await writeFile(join(mods, f), 'x')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['api-by-hand.jar'] = 'sha1-a1'
    await writeManifest(dir, {
      version: 1,
      entries: [
        {
          fileName: 'sodium-1.jar',
          projectId: SODIUM.id,
          versionId: 's1',
          title: 'Sodium',
          versionNumber: 's1-num',
          sha1: 'sha1-s1',
          dependencyOf: []
        },
        {
          fileName: 'gone.jar',
          projectId: 'GONEGONE',
          versionId: 'g',
          title: 'Gone',
          versionNumber: 'g',
          sha1: 'g',
          dependencyOf: []
        }
      ]
    })
    client.identify.mockResolvedValueOnce({ 'sha1-a1': ver('a1', API.id, 'fabric-api-1.jar') })
    client.latest.mockResolvedValueOnce({ 'sha1-s1': ver('s2', SODIUM.id, 'sodium-2.jar') })

    const list = await service.listInstalled(ID)
    expect(client.identify).toHaveBeenCalledWith(['sha1-a1', 'unknown-mystery.jar'])
    expect(list.offline).toBe(false)
    expect(list.items).toEqual([
      {
        fileName: 'api-by-hand.jar',
        title: 'Fabric API',
        versionNumber: 'a1-num',
        source: 'modrinth',
        projectId: API.id,
        neededBy: []
      },
      {
        fileName: 'mystery.jar',
        title: 'mystery.jar',
        versionNumber: null,
        source: 'manual',
        neededBy: []
      },
      {
        fileName: 'sodium-1.jar',
        title: 'Sodium',
        versionNumber: 's1-num',
        source: 'modrinth',
        projectId: SODIUM.id,
        update: { versionId: 's2', versionNumber: 's2-num' },
        neededBy: []
      }
    ])
    expect((await readManifest(dir)).entries.map((e) => e.fileName).sort()).toEqual([
      'api-by-hand.jar',
      'sodium-1.jar'
    ])
  })

  it('names the content that needs a dependency', async () => {
    const { service, mods, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['fabric-api-1.jar'] = 'sha1-a1'
    const list = await service.listInstalled(ID)
    expect(list.items.find((i) => i.fileName === 'fabric-api-1.jar')?.neededBy).toEqual(['Sodium'])
    expect(await readdir(mods)).toHaveLength(2)
  })

  it('still lists local files when Modrinth is unreachable', async () => {
    const { service, mods, client } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'mystery.jar'), 'x')
    client.identify.mockRejectedValueOnce(new AppError('NETWORK', 'Could not reach Modrinth'))
    const list = await service.listInstalled(ID)
    expect(list).toEqual({
      offline: true,
      items: [
        {
          fileName: 'mystery.jar',
          title: 'mystery.jar',
          versionNumber: null,
          source: 'manual',
          neededBy: []
        }
      ]
    })
  })

  it('refuses update and remove while the server is running', async () => {
    for (const status of ['starting', 'running', 'stopping'] as const) {
      const { service } = await setup({ status })
      await expect(service.remove(ID, 'sodium-1.jar')).rejects.toMatchObject({
        code: 'SERVER_RUNNING'
      })
      await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
        code: 'SERVER_RUNNING'
      })
    }
  })

  it('updates by downloading the new version and removing the old file', async () => {
    const { service, mods, dir, client, versions, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    versions.unshift(ver('s2', SODIUM.id, 'sodium-2.jar', [API.id]))
    client.latest.mockResolvedValueOnce({ 'sha1-s1': versions[0] })
    const result = await service.update(ID, 'sodium-1.jar')
    expect(result.installed).toEqual([
      { title: 'Sodium', versionNumber: 's2-num', asDependency: false }
    ])
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-2.jar'])
    const entries = (await readManifest(dir)).entries
    expect(entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      versionId: 's2'
    })
    expect(entries).toHaveLength(2)
  })

  it('does nothing when no update is available', async () => {
    const { service, download } = await setup()
    await service.install(ID, 'sodium')
    download.mockClear()
    expect(await service.update(ID, 'sodium-1.jar')).toEqual({
      installed: [],
      restartNeeded: false
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('removes a file and its manifest entry', async () => {
    const { service, mods, dir } = await setup()
    await service.install(ID, 'sodium')
    await service.remove(ID, 'sodium-1.jar')
    expect(await readdir(mods)).toEqual(['fabric-api-1.jar'])
    expect((await readManifest(dir)).entries.map((e) => e.fileName)).toEqual(['fabric-api-1.jar'])
    await expect(service.remove(ID, '../x.jar')).rejects.toMatchObject({
      code: 'CONTENT_BAD_FILENAME'
    })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/content/service.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `service.ts`**

Create `src/main/content/service.ts`:

```ts
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  SERVER_TYPE_LABELS,
  type ContentInstallResult,
  type ContentSearchResult,
  type InstalledContent,
  type InstalledContentList,
  type ServerRecord
} from '../../shared/types'
import { AppError } from '../errors'
import type { DownloadFn } from '../net/download'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import { pathExists } from '../util/fs'
import { contentTarget, type ContentTarget } from './loaders'
import { readManifest, writeManifest, type Manifest, type ManifestEntry } from './manifest'
import type { ModrinthClient } from './modrinth'
import { planInstall, type PlanItem } from './resolver'

const RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export function safeFileName(name: string): string {
  const ok =
    name.length > 0 &&
    name.length <= 200 &&
    !FORBIDDEN_CHARS.test(name) &&
    !name.includes('..') &&
    name.toLowerCase().endsWith('.jar') &&
    !/[. ]$/.test(name) &&
    !RESERVED_DEVICE_NAMES.test(name)
  if (!ok) throw new AppError('CONTENT_BAD_FILENAME', `Refusing to use the file name "${name}".`)
  return name
}

export async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

const isOfflineError = (err: unknown): boolean =>
  err instanceof AppError && (err.code === 'NETWORK' || err.code === 'MODRINTH_API')

export interface ContentServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'status'>
  client: ModrinthClient
  download: DownloadFn
  hashFile?: (path: string) => Promise<string>
}

interface Ctx {
  rec: ServerRecord
  target: ContentTarget
  folder: string
  label: string
}

export class ContentService {
  private readonly deps: ContentServiceDeps
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: ContentServiceDeps) {
    this.deps = deps
  }

  search(serverId: string, query: string, offset: number): Promise<ContentSearchResult> {
    return this.serial(serverId, async () => {
      const { rec, target } = this.ctx(serverId)
      const installed = new Set((await readManifest(rec.dir)).entries.map((e) => e.projectId))
      const r = await this.deps.client.search(target, rec.mcVersion, query, offset)
      return {
        total: r.total,
        hits: r.hits.map((h) => ({
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          description: h.description,
          iconUrl: h.icon_url,
          downloads: h.downloads,
          installed: installed.has(h.project_id)
        }))
      }
    })
  }

  listInstalled(serverId: string): Promise<InstalledContentList> {
    return this.serial(serverId, async () => {
      const { rec, target, folder } = this.ctx(serverId)
      const hashFile = this.deps.hashFile ?? sha1File
      const files = await this.jarFiles(folder)
      const manifest = await readManifest(rec.dir)
      const shas = new Map<string, string>()
      for (const f of files) shas.set(f, await hashFile(join(folder, f)))

      const known = manifest.entries.filter((e) => shas.get(e.fileName) === e.sha1)
      const knownNames = new Set(known.map((e) => e.fileName))
      const unknown = files.filter((f) => !knownNames.has(f))
      const entries = [...known]
      let offline = false

      if (unknown.length) {
        try {
          const found = await this.deps.client.identify(unknown.map((f) => shas.get(f)!))
          const hits = unknown.filter((f) => found[shas.get(f)!])
          const projects = await this.deps.client.projects([
            ...new Set(hits.map((f) => found[shas.get(f)!].project_id))
          ])
          const titles = new Map(projects.map((p) => [p.id, p.title]))
          for (const f of hits) {
            const v = found[shas.get(f)!]
            entries.push({
              fileName: f,
              projectId: v.project_id,
              versionId: v.id,
              title: titles.get(v.project_id) ?? f,
              versionNumber: v.version_number,
              sha1: shas.get(f)!,
              dependencyOf: []
            })
          }
        } catch (err) {
          if (!isOfflineError(err)) throw err
          offline = true
        }
      }

      if (!sameEntries(entries, manifest.entries))
        await writeManifest(rec.dir, { version: 1, entries })

      let updates: Record<string, { id: string; version_number: string }> = {}
      if (!offline && entries.length) {
        try {
          updates = await this.deps.client.latest(
            entries.map((e) => e.sha1),
            target.loaders,
            rec.mcVersion
          )
        } catch (err) {
          if (!isOfflineError(err)) throw err
          offline = true
        }
      }

      const byName = new Map(entries.map((e) => [e.fileName, e]))
      const titleOf = new Map(entries.map((e) => [e.projectId, e.title]))
      const items: InstalledContent[] = files.map((f) => {
        const e = byName.get(f)
        if (!e)
          return { fileName: f, title: f, versionNumber: null, source: 'manual', neededBy: [] }
        const u = updates[e.sha1]
        return {
          fileName: f,
          title: e.title,
          versionNumber: e.versionNumber,
          source: 'modrinth',
          projectId: e.projectId,
          ...(u && u.id !== e.versionId
            ? { update: { versionId: u.id, versionNumber: u.version_number } }
            : {}),
          neededBy: e.dependencyOf.filter((p) => titleOf.has(p)).map((p) => titleOf.get(p)!)
        }
      })
      items.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      return { items, offline }
    })
  }

  install(serverId: string, projectIdOrSlug: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      const manifest = await readManifest(c.rec.dir)
      const plan = await this.plan(c, manifest, projectIdOrSlug)
      await this.apply(c, manifest, plan, null)
      return this.result(c, plan)
    })
  }

  update(serverId: string, fileName: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      const manifest = await readManifest(c.rec.dir)
      const entry = manifest.entries.find((e) => e.fileName === name)
      if (!entry) {
        throw new AppError(
          'NOT_FOUND',
          `${name} was not installed from Modrinth, so Blockhost cannot update it.`
        )
      }
      const latest = (
        await this.deps.client.latest([entry.sha1], c.target.loaders, c.rec.mcVersion)
      )[entry.sha1]
      if (!latest || latest.id === entry.versionId) return { installed: [], restartNeeded: false }

      const others: Manifest = { version: 1, entries: manifest.entries.filter((e) => e !== entry) }
      const plan = await this.plan(c, others, entry.projectId, latest.id)
      if (plan[0]) plan[0].dependencyOf = entry.dependencyOf
      await this.apply(c, others, plan, entry)
      return this.result(c, plan)
    })
  }

  remove(serverId: string, fileName: string): Promise<void> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      await rm(join(c.folder, name), { force: true })
      const manifest = await readManifest(c.rec.dir)
      const entries = manifest.entries.filter((e) => e.fileName !== name)
      if (entries.length !== manifest.entries.length)
        await writeManifest(c.rec.dir, { version: 1, entries })
    })
  }

  private ctx(serverId: string): Ctx {
    const rec = this.deps.store.get(serverId)
    const target = contentTarget(rec.type)
    if (!target)
      throw new AppError('CONTENT_NOT_SUPPORTED', 'Vanilla servers cannot use mods or plugins.')
    return {
      rec,
      target,
      folder: join(rec.dir, target.folder),
      label: `${SERVER_TYPE_LABELS[rec.type]} ${rec.mcVersion}`
    }
  }

  private isUp(serverId: string): boolean {
    const s = this.deps.processes.status(serverId)
    return s === 'starting' || s === 'running' || s === 'stopping'
  }

  private requireStopped(c: Ctx): void {
    if (this.isUp(c.rec.id)) {
      throw new AppError(
        'SERVER_RUNNING',
        `Stop the server before updating or removing ${c.target.label.toLowerCase()}.`
      )
    }
  }

  private plan(
    c: Ctx,
    manifest: Manifest,
    projectIdOrSlug: string,
    versionId?: string
  ): Promise<PlanItem[]> {
    return planInstall(
      projectIdOrSlug,
      {
        client: this.deps.client,
        loaders: c.target.loaders,
        mcVersion: c.rec.mcVersion,
        installedProjectIds: new Set(manifest.entries.map((e) => e.projectId)),
        targetLabel: c.label
      },
      versionId
    )
  }

  /** Downloads the plan; `replacing` is the entry an update supersedes. */
  private async apply(
    c: Ctx,
    manifest: Manifest,
    plan: PlanItem[],
    replacing: ManifestEntry | null
  ): Promise<void> {
    const names = plan.map((item) => safeFileName(item.file.filename))
    const written: string[] = []
    try {
      for (const [i, item] of plan.entries()) {
        const dest = join(c.folder, names[i])
        const isReplacement = i === 0 && replacing !== null && names[i] === replacing.fileName
        if (!isReplacement && (await pathExists(dest))) continue
        await this.deps.download({
          url: item.file.url,
          dest,
          hash: { algo: 'sha512', value: item.file.sha512 }
        })
        written.push(dest)
      }
    } catch (err) {
      for (const file of written) await rm(file, { force: true })
      throw err
    }
    if (replacing && replacing.fileName !== names[0])
      await rm(join(c.folder, replacing.fileName), { force: true })

    const entries = manifest.entries.filter((e) => !names.includes(e.fileName))
    plan.forEach((item, i) =>
      entries.push({
        fileName: names[i],
        projectId: item.projectId,
        versionId: item.versionId,
        title: item.title,
        versionNumber: item.versionNumber,
        sha1: item.file.sha1,
        dependencyOf: item.dependencyOf
      })
    )
    if (plan.length || replacing) await writeManifest(c.rec.dir, { version: 1, entries })
  }

  private result(c: Ctx, plan: PlanItem[]): ContentInstallResult {
    return {
      installed: plan.map((item, i) => ({
        title: item.title,
        versionNumber: item.versionNumber,
        asDependency: i > 0
      })),
      restartNeeded: plan.length > 0 && this.isUp(c.rec.id)
    }
  }

  private async jarFiles(folder: string): Promise<string[]> {
    try {
      return (await readdir(folder)).filter((f) => f.toLowerCase().endsWith('.jar')).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private serial<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(serverId) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    this.queues.set(
      serverId,
      run.catch(() => {})
    )
    return run
  }
}

function sameEntries(a: ManifestEntry[], b: ManifestEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

Notes for the implementer:

- In the update test the dependency (Fabric API) is already installed, so the update plan holds only the new Sodium; the result therefore lists only Sodium (`asDependency: false`).
- `apply` writes the manifest after all downloads succeed; if any download fails it removes the files this call wrote and leaves the manifest unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/content/service.test.ts`
Expected: PASS. If a test fails, find the real cause; fix the code to match the behaviour the test states (it reflects the spec) and record any deviation.

- [ ] **Step 5: Add the live install check**

Create `src/main/integration/modrinth.integration.test.ts`:

```ts
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ContentService } from '../content/service'
import { createModrinthClient } from '../content/modrinth'
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
      client: createModrinthClient({ userAgent: 'Blockhost-tests (github.com/ToMeXaS/blockhost)' }),
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
```

Run: `npm run test:integration -- src/main/integration/modrinth.integration.test.ts`
Expected: PASS (needs the internet; downloads ~2 MB). The download is checked against Modrinth's sha512 by `downloadFile`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — both pass.

```bash
git add src/main/content/service.ts src/main/content/service.test.ts src/main/integration/modrinth.integration.test.ts
git commit -m "feat: install, list, update and remove Modrinth content"
```

---

### Task 6: Wire content into the app

**Files:**

- Modify: `src/main/schemas.ts` (append)
- Test: `src/main/schemas.test.ts` (append)
- Modify: `src/shared/api.ts`, `src/main/services.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/renderer/src/lib/api.ts`

**Interfaces:**

- Consumes: `ContentService`, `safeFileName` (Task 5); `createModrinthClient` (Task 2); shared content types (Task 1).
- Produces:
  - schemas `contentQuerySchema` (string, trimmed, ≤100), `contentOffsetSchema` (int 0–10000), `projectRefSchema` (`^[A-Za-z0-9_-]{1,64}$`), `contentFileSchema` (passes `safeFileName`).
  - invoke channels `'content:search'`, `'content:installed'`, `'content:install'`, `'content:update'`, `'content:remove'`.
  - `Services.content: ContentService`; `createServices` options gain `appVersion: string`.
  - renderer `api.contentSearch(id, query, offset): Promise<ContentSearchResult>`, `api.contentInstalled(id): Promise<InstalledContentList>`, `api.contentInstall(id, projectId): Promise<ContentInstallResult>`, `api.contentUpdate(id, fileName): Promise<ContentInstallResult>`, `api.contentRemove(id, fileName): Promise<void>`.

- [ ] **Step 1: Write the failing schema tests**

Append to `src/main/schemas.test.ts` (add `contentFileSchema, contentOffsetSchema, contentQuerySchema, projectRefSchema` to its import from `./schemas`):

```ts
describe('content schemas', () => {
  it('validates queries, offsets, project refs and file names', () => {
    expect(contentQuerySchema.parse('  sodium ')).toBe('sodium')
    expect(() => contentQuerySchema.parse('x'.repeat(101))).toThrow()
    expect(contentOffsetSchema.parse(40)).toBe(40)
    for (const bad of [-1, 10001, 1.5]) expect(() => contentOffsetSchema.parse(bad)).toThrow()
    expect(projectRefSchema.parse('AANobbMI')).toBe('AANobbMI')
    expect(projectRefSchema.parse('fabric-api')).toBe('fabric-api')
    for (const bad of ['', 'a b', '../x', 'x'.repeat(65)])
      expect(() => projectRefSchema.parse(bad)).toThrow()
    expect(contentFileSchema.parse('sodium-1.jar')).toBe('sodium-1.jar')
    for (const bad of ['../x.jar', 'x.exe', 'CON.jar'])
      expect(() => contentFileSchema.parse(bad)).toThrow()
  })
})
```

Run: `npx vitest run src/main/schemas.test.ts` — FAIL (schemas not exported).

- [ ] **Step 2: Add the schemas**

Append to `src/main/schemas.ts` (add `import { safeFileName } from './content/service'` at the top with the other imports):

```ts
export const contentQuerySchema = z.string().trim().max(100)
export const contentOffsetSchema = z.number().int().min(0).max(10000)
export const projectRefSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a Modrinth project')
export const contentFileSchema = z
  .string()
  .max(200)
  .refine((name) => {
    try {
      safeFileName(name)
      return true
    } catch {
      return false
    }
  }, 'Not a safe .jar file name')
```

Run: `npx vitest run src/main/schemas.test.ts` — PASS.

- [ ] **Step 3: Channels**

In `src/shared/api.ts`, after `'tunnel:retry',` in `INVOKE_CHANNELS`, add:

```ts
  'content:search',
  'content:installed',
  'content:install',
  'content:update',
  'content:remove',
```

- [ ] **Step 4: Services**

In `src/main/services.ts`:

- Add imports `import { createModrinthClient } from './content/modrinth'` and `import { ContentService } from './content/service'`.
- Add `content: ContentService` to `Services` after `tunnels`.
- Add `appVersion: string` to the `createServices` options type and destructure it.
- After the `TunnelService` construction, add:
  ```ts
  const content = new ContentService({
    store,
    processes,
    client: createModrinthClient({
      userAgent: `Blockhost/${appVersion} (github.com/ToMeXaS/blockhost)`
    }),
    download: downloadFile
  })
  ```
- Add `content` to the returned object after `tunnels`.

In `src/main/index.ts`, add `appVersion: app.getVersion()` to the `createServices({...})` call.

- [ ] **Step 5: IPC handlers**

In `src/main/ipc.ts`:

- Import `contentFileSchema, contentOffsetSchema, contentQuerySchema, projectRefSchema` from `./schemas` (keep the import list alphabetical).
- Add `content` to the services destructuring.
- After the tunnel handlers, add:

  ```ts
  handle(
    'content:search',
    z.tuple([idSchema, contentQuerySchema, contentOffsetSchema]),
    (id, query, offset) => content.search(id, query, offset)
  )
  handle('content:installed', z.tuple([idSchema]), (id) => content.listInstalled(id))
  handle('content:install', z.tuple([idSchema, projectRefSchema]), (id, projectId) =>
    content.install(id, projectId)
  )
  handle('content:update', z.tuple([idSchema, contentFileSchema]), (id, fileName) =>
    content.update(id, fileName)
  )
  handle('content:remove', z.tuple([idSchema, contentFileSchema]), (id, fileName) =>
    content.remove(id, fileName)
  )
  ```

- [ ] **Step 6: Renderer API**

In `src/renderer/src/lib/api.ts`, add `ContentInstallResult`, `ContentSearchResult`, `InstalledContentList` to the type import and, after the tunnel calls:

```ts
  contentSearch: (id: string, query: string, offset: number) =>
    call<ContentSearchResult>('content:search', id, query, offset),
  contentInstalled: (id: string) => call<InstalledContentList>('content:installed', id),
  contentInstall: (id: string, projectId: string) =>
    call<ContentInstallResult>('content:install', id, projectId),
  contentUpdate: (id: string, fileName: string) =>
    call<ContentInstallResult>('content:update', id, fileName),
  contentRemove: (id: string, fileName: string) => call<void>('content:remove', id, fileName),
```

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm test && npm run build` — all pass.

```bash
git add src/main/schemas.ts src/main/schemas.test.ts src/shared/api.ts src/main/services.ts src/main/ipc.ts src/main/index.ts src/renderer/src/lib/api.ts
git commit -m "feat: expose the mod and plugin browser over IPC"
```

---

### Task 7: Mods / Plugins tab, CSP and smoke checklist

**Files:**

- Create: `src/renderer/src/pages/tabs/ContentTab.tsx`
- Modify: `src/renderer/src/pages/ServerDetail.tsx`
- Modify: `src/renderer/index.html` (CSP)
- Modify: `docs/smoke-test.md`

**Interfaces:**

- Consumes: renderer `api.content*` (Task 6); `CONTENT_LABELS`, content types, `ServerView` (Task 1); `Button`, `ErrorText`, `inputClass`; `errorMessage`.
- Produces: `export function ContentTab({ server }: { server: ServerView })`.

No renderer test harness exists; verify with typecheck and build.

- [ ] **Step 1: Create the tab**

Create `src/renderer/src/pages/tabs/ContentTab.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CONTENT_LABELS,
  type ContentSearchHit,
  type InstalledContent,
  type InstalledContentList,
  type ServerView
} from '../../../../shared/types'
import { Button, ErrorText, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

const SEARCH_DEBOUNCE_MS = 300

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  )
}

export function ContentTab({ server }: { server: ServerView }) {
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const locked =
    server.status === 'starting' || server.status === 'running' || server.status === 'stopping'

  const [installed, setInstalled] = useState<InstalledContentList | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContentSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const loadInstalled = useCallback(() => {
    api
      .contentInstalled(server.id)
      .then(setInstalled)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id])
  useEffect(() => loadInstalled(), [loadInstalled])

  const runSearch = useCallback(
    async (q: string, offset: number) => {
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(null)
      try {
        const r = await api.contentSearch(server.id, q, offset)
        if (seq !== searchSeq.current) return
        setHits((prev) => (offset === 0 ? r.hits : [...prev, ...r.hits]))
        setTotal(r.total)
      } catch (err) {
        if (seq === searchSeq.current) setSearchError(errorMessage(err))
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    [server.id]
  )
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim(), 0), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const install = (hit: ContentSearchHit) =>
    act(hit.projectId, async () => {
      const r = await api.contentInstall(server.id, hit.projectId)
      const [main, ...deps] = r.installed
      setNotice(
        main
          ? `Installed ${main.title}${deps.length ? ` + ${deps.map((d) => `${d.title} (dependency)`).join(', ')}` : ''}.`
          : `${hit.title} is already installed.`
      )
      if (r.restartNeeded) setRestartNeeded(true)
      setHits((prev) =>
        prev.map((h) => (h.projectId === hit.projectId ? { ...h, installed: true } : h))
      )
      loadInstalled()
    })

  const update = (item: InstalledContent) =>
    act(item.fileName, async () => {
      const r = await api.contentUpdate(server.id, item.fileName)
      setNotice(
        r.installed[0]
          ? `Updated ${item.title} to ${r.installed[0].versionNumber}.`
          : `${item.title} is up to date.`
      )
      loadInstalled()
    })

  const remove = (item: InstalledContent) => {
    const warning = item.neededBy.length
      ? `${item.title} is needed by ${item.neededBy.join(', ')}. Remove anyway?`
      : `Remove ${item.title}?`
    if (!window.confirm(warning)) return
    void act(item.fileName, async () => {
      await api.contentRemove(server.id, item.fileName)
      setNotice(`Removed ${item.title}.`)
      setHits((prev) =>
        prev.map((h) => (h.projectId === item.projectId ? { ...h, installed: false } : h))
      )
      loadInstalled()
    })
  }

  return (
    <div className="space-y-4 pb-6">
      {restartNeeded && server.status === 'running' && (
        <p className="rounded-md border border-amber-800 bg-amber-950/60 px-3 py-2 text-sm text-amber-200">
          Restart the server to apply changes.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <Card title={`Installed ${noun}`}>
        {!installed ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            {installed.offline && (
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                Can&apos;t reach Modrinth — showing local files only.
                <Button variant="ghost" onClick={loadInstalled}>
                  Retry
                </Button>
              </div>
            )}
            {locked && (
              <p className="text-xs text-zinc-500">Stop the server to update or remove {noun}.</p>
            )}
            {installed.items.length === 0 ? (
              <p className="text-sm text-zinc-500">No {noun} installed yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {installed.items.map((item) => (
                  <li
                    key={item.fileName}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {item.versionNumber ?? item.fileName} ·{' '}
                        {item.source === 'modrinth' ? 'from Modrinth' : 'added manually'}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {item.update && (
                        <Button
                          disabled={locked || busy !== null}
                          onClick={() => void update(item)}
                          title={`Update to ${item.update.versionNumber}`}
                        >
                          Update
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={locked || busy !== null}
                        onClick={() => remove(item)}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title={`Browse ${noun} on Modrinth`}>
        <label className="block">
          <span className="sr-only">Search {noun}</span>
          <input
            type="search"
            className={inputClass}
            placeholder={`Search ${noun} for ${server.mcVersion}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {searchError ? (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            Can&apos;t reach Modrinth.
            <Button variant="ghost" onClick={() => void runSearch(query.trim(), 0)}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {!searching && hits.length === 0 && (
              <p className="text-sm text-zinc-500">No {noun} found for this server.</p>
            )}
            <ul className="divide-y divide-zinc-800">
              {hits.map((hit) => (
                <li key={hit.projectId} className="flex items-center gap-3 py-2 text-sm">
                  {hit.iconUrl ? (
                    <img src={hit.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded" />
                  ) : (
                    <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded bg-zinc-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{hit.title}</div>
                    <div className="truncate text-xs text-zinc-500">{hit.description}</div>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatDownloads(hit.downloads)} downloads
                  </span>
                  {hit.installed ? (
                    <span className="shrink-0 text-xs text-emerald-400">Installed</span>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={busy !== null}
                      onClick={() => void install(hit)}
                    >
                      {busy === hit.projectId ? 'Installing…' : 'Install'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {searching && <p className="text-sm text-zinc-500">Searching…</p>}
            {!searching && hits.length < total && (
              <Button variant="ghost" onClick={() => void runSearch(query.trim(), hits.length)}>
                Load more
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Add the tab to the detail page**

In `src/renderer/src/pages/ServerDetail.tsx`:

- Import `CONTENT_LABELS` from `../../../shared/types` (alongside `ServerView`) and `import { ContentTab } from './tabs/ContentTab'`.
- Change the `Tab` type to `type Tab = 'console' | 'players' | 'content' | 'properties' | 'settings' | 'connect'`.
- In `TABS`, insert `{ id: 'content', label: 'Mods' },` after the Players entry.
- Inside the component, before `return`, add:
  ```tsx
  const contentLabel = CONTENT_LABELS[server.type]
  const tabs = TABS.filter((t) => t.id !== 'content' || contentLabel).map((t) =>
    t.id === 'content' && contentLabel ? { ...t, label: contentLabel } : t
  )
  ```
- In the `<nav>`, change `TABS.map((t) => (` to `tabs.map((t) => (`.
- After `{tab === 'players' && <PlayersTab server={server} />}` add:

  ```tsx
  {
    tab === 'content' && contentLabel && <ContentTab server={server} />
  }
  ```

- [ ] **Step 3: Allow Modrinth icons**

In `src/renderer/index.html`, change `img-src 'self' data:` to `img-src 'self' data: https://cdn.modrinth.com` in the Content-Security-Policy.

- [ ] **Step 4: Smoke checklist**

In `docs/smoke-test.md`, before the "Uninstall" line, add:

```markdown
- [ ] Paper server: the Plugins tab finds and installs a plugin (e.g. LuckPerms); after a restart the console shows it loading
- [ ] Fabric server: installing Sodium also installs Fabric API; the note names both; after a restart the server starts with both
- [ ] A jar copied into mods/ by hand shows as "from Modrinth" once identified, or "added manually"
- [ ] Remove is disabled while the server runs; after stopping, removing Fabric API warns that Sodium needs it
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npx prettier --check src/renderer/src/pages/tabs/ContentTab.tsx src/renderer/src/pages/ServerDetail.tsx src/renderer/index.html docs/smoke-test.md && npm test && npm run build`
Expected: all pass (run `npx prettier --write` on any listed file Prettier reports, then re-check).

```bash
git add src/renderer/src/pages/tabs/ContentTab.tsx src/renderer/src/pages/ServerDetail.tsx src/renderer/index.html docs/smoke-test.md
git commit -m "feat: add the Mods and Plugins tab"
```
