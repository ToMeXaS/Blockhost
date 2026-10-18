# Blockhost — Mod & Plugin Browser (Modrinth) — Design

Date: 2026-10-18
Status: Draft for review

## 1. Goal

Let a server owner find, install, update and remove mods (Fabric, Forge,
NeoForge) and plugins (Paper, Purpur) from inside Blockhost, filtered to what
works on that server, with required dependencies installed automatically.

This is sub-project 3 of 3 (player management → tunnel integration →
mod/plugin browser).

### In scope

- Search Modrinth filtered by the server's loader, Minecraft version and
  server-side support.
- Install a project plus its required dependencies.
- An installed list covering every `.jar` in `mods/` or `plugins/`,
  identifying jars added by hand, with update checks, Update and Remove.

### Out of scope

CurseForge, Hangar and other sources; Vanilla data packs; resource packs;
modpacks; optional dependencies; enabling/disabling without removing;
config editing; client-side mod distribution.

## 2. Facts this design relies on

Checked live against `https://api.modrinth.com/v2` on 2026-10-18:

- No API key; a descriptive `User-Agent` is required. Rate limit 300
  requests/minute, reported in `X-Ratelimit-Limit` / `-Remaining` /
  `-Reset` (seconds).
- `GET /search?query&facets&index&offset&limit` — `facets` is a JSON array
  of OR-groups ANDed together, e.g.
  `[["project_type:mod"],["categories:fabric"],["versions:1.21.4"],["server_side:required","server_side:optional"]]`.
  Hits include `project_id`, `slug`, `title`, `description`, `icon_url`,
  `downloads`, `categories`, `server_side`. Plugin hits can report
  `project_type: "mod"`; filtering is done by facets, not by that field.
- `GET /project/{id}` → `server_side` (`required|optional|unsupported|unknown`),
  `loaders`, `title`, `icon_url`.
- `GET /project/{id}/version?loaders=[..]&game_versions=[..]` → versions
  (newest first) with `id`, `version_number`, `version_type`
  (`release|beta|alpha`), `loaders`, `game_versions`, `dependencies[]`
  (`{project_id, version_id, file_name, dependency_type:
required|optional|incompatible|embedded}`) and `files[]`
  (`{url, filename, primary, size, hashes: {sha1, sha512}}`).
- `POST /version_files {hashes, algorithm: "sha1"}` → map hash → version
  (with `project_id`).
- `POST /version_files/update {hashes, algorithm: "sha1", loaders,
game_versions}` → map hash → newest compatible version.
- Image CDN: `https://cdn.modrinth.com`.

## 3. Approach

A main-process Modrinth client plus a small manifest in each server folder.
The app records what it installed in `<server>/.blockhost/content.json`;
listing scans the content folder so hand-added jars appear too, and unknown
jars are identified by sha1 through `version_files`. Update checks use one
`version_files/update` call for the whole list.

Rejected: no manifest (a lookup per visit, dependency links rebuilt each
time); packwiz (extra binary and file format).

## 4. Main-process modules

```
src/main/content/
  loaders.ts     server type → content target
  modrinth.ts    Modrinth API client
  manifest.ts    <server>/.blockhost/content.json
  resolver.ts    version choice + dependency plan
  service.ts     ContentService
```

### 4.1 `loaders.ts`

`contentTarget(type): { folder: 'mods' | 'plugins'; loaders: string[];
projectType: 'mod' | 'plugin'; label: 'Mods' | 'Plugins' } | null`

| server type | folder   | loaders (search facet / version filter) | label   |
| ----------- | -------- | --------------------------------------- | ------- |
| fabric      | mods     | fabric                                  | Mods    |
| forge       | mods     | forge                                   | Mods    |
| neoforge    | mods     | neoforge                                | Mods    |
| paper       | plugins  | paper, spigot, bukkit                   | Plugins |
| purpur      | plugins  | purpur, paper, spigot, bukkit           | Plugins |
| vanilla     | — (null) | —                                       | —       |

### 4.2 `modrinth.ts`

`createModrinthClient(fetchImpl?)` with:

- `search(target, mcVersion, query, offset)` — facets: project type, an
  OR-group of `categories:<loader>` for the target's loaders,
  `versions:<mcVersion>`, `server_side:required|optional`; `index=relevance`
  when `query` is non-empty, else `downloads`; `limit=20`.
- `project(id)`, `versions(id, loaders, mcVersion)`,
  `identify(sha1s)`, `latest(sha1s, loaders, mcVersion)`.
- `User-Agent: Blockhost/<app version> (github.com/ToMeXaS/blockhost)`.
- HTTP 429 → wait `X-Ratelimit-Reset` seconds (max 60) and retry once;
  network → `NETWORK`; other non-OK → `MODRINTH_API` with the status.
- 15 s request timeout.

### 4.3 `manifest.ts`

`content.json`: `{ version: 1, entries: [{ fileName, projectId, versionId,
title, versionNumber, sha1, dependencyOf: string[] }] }` where
`dependencyOf` lists projectIds that pulled this entry in. Missing file →
empty; unparsable → treated as empty and rebuilt on the next listing.
Written with `writeFileAtomic`.

### 4.4 `resolver.ts`

- `pickVersion(versions)` — first `release`, else first `beta`, else first
  `alpha` (input is newest-first); must have a primary file (else the first
  file).
- `plan(projectId, ctx)` → `{ items: PlanItem[] }` where `PlanItem =
{ projectId, versionId, title, versionNumber, file: {url, filename, sha1,
sha512, size}, dependencyOf: string[] }`. Walks `required` dependencies
  depth-first: a dependency given by `version_id` uses that version if it is
  compatible with the target loaders and game version, otherwise the best
  compatible version of its `project_id`; projects already installed (by
  projectId) or already in the plan are skipped; cycles are cut by the
  visited set. Any required dependency with no compatible version →
  `CONTENT_DEPENDENCY_UNAVAILABLE` naming it, and nothing is installed.
- The requested project with no compatible version →
  `CONTENT_NO_COMPATIBLE_VERSION` ("No version of X supports Paper
  1.21.4.").
- `incompatible` dependencies that are installed → `CONTENT_CONFLICT`
  naming both.

### 4.5 `service.ts` — `ContentService`

- `target(serverId)` → `contentTarget(rec.type)` or `CONTENT_NOT_SUPPORTED`.
- `search(serverId, query, offset)` → `{ hits: SearchHit[], total }` with an
  `installed: boolean` flag per hit (by projectId in the manifest).
- `listInstalled(serverId)` → scans `<dir>/<folder>/*.jar`, matches files to
  manifest entries by `fileName`; for files without an entry (or whose sha1
  differs) computes sha1 and calls `identify`, adding identified ones to the
  manifest with `dependencyOf: []`; drops manifest entries whose file is
  gone; then one `latest` call for all Modrinth-known files. Returns
  `InstalledItem { fileName, title, versionNumber, source: 'modrinth' |
'manual', projectId?, update?: { versionId, versionNumber }, neededBy:
string[] (titles) }`. If Modrinth is unreachable, returns the local list
  without identification/update info and `offline: true`.
- `install(serverId, projectId)` → plan, then download each item with its
  sha512 into `<folder>/<safe filename>`; a file that already exists is
  skipped; on any failure, files written by this call are removed. Writes
  the manifest. Returns `{ installed: { title, versionNumber,
asDependency: boolean }[], restartNeeded: boolean }` (`restartNeeded` when
  the server is starting/running).
- `update(serverId, fileName)` and `remove(serverId, fileName)` require the
  server to be stopped or crashed (`SERVER_RUNNING` otherwise — Windows
  locks loaded jars). Update downloads the new version first, then deletes
  the old file and updates the manifest entry; dependencies of the new
  version are installed like `install`. Remove deletes the file and its
  manifest entry; it does not remove dependencies.
- Safe file names: basename only, must end in `.jar`, no `..`, no
  characters `<>:"/\|?*` or control characters, not a Windows reserved
  device name, at most 200 chars; otherwise `CONTENT_BAD_FILENAME`. Paths
  are verified to resolve inside the content folder.

## 5. IPC

Invoke channels (zod-validated):

- `content:target(serverId)` → `{ folder, label } | null`
- `content:search(serverId, query: string ≤100, offset: int 0–10000)`
- `content:installed(serverId)`
- `content:install(serverId, projectId)` — projectId `^[A-Za-z0-9]{8}$` or
  a slug `^[a-z0-9_-]{1,64}$`
- `content:update(serverId, fileName)` / `content:remove(serverId,
fileName)` — fileName validated by the safe-name rule

New error codes: `CONTENT_NOT_SUPPORTED`, `CONTENT_NO_COMPATIBLE_VERSION`,
`CONTENT_DEPENDENCY_UNAVAILABLE`, `CONTENT_CONFLICT`, `CONTENT_BAD_FILENAME`,
`MODRINTH_API`, `SERVER_RUNNING` (exists).

## 6. UI — Mods / Plugins tab

A tab after Players labelled **Mods** or **Plugins** (from `content:target`),
hidden for Vanilla.

- **Installed** (top): rows with title (or file name), version, "from
  Modrinth" / "added manually", **Update** (when available) and **Remove**.
  Remove asks first, naming dependents when `neededBy` is non-empty
  ("Fabric API is needed by Sodium. Remove anyway?"). Update/Remove are
  disabled while the server is running, with "Stop the server to update or
  remove."
- **Browse** (below): search box (debounced 300 ms); results with icon,
  title, description, download count and **Install** / "Installed"; first
  view shows most-downloaded; **Load more**.
- After install: a note "Installed Sodium + Fabric API (dependency)"; while
  the server is running a banner **Restart the server to apply changes.**
- Offline: "Can't reach Modrinth" with Retry; the installed list still shows
  local files.
- CSP: `img-src 'self' data: https://cdn.modrinth.com`.

## 7. Testing

Vitest, TDD.

- `loaders.ts`: table test for all six types.
- `modrinth.ts`: fake fetch — facets JSON and encoding, index choice,
  User-Agent, 429 wait-and-retry (fake timers), timeout, error mapping.
- `resolver.ts`: release > beta > alpha; dependency chain; cycle; skip
  installed; dependency by version_id vs project_id; unavailable dependency;
  incompatible conflict.
- `manifest.ts`: round-trip; missing; corrupt.
- `service.ts`: temp folders + fake download + fake client — install with
  dependency; rollback on failure; existing file skipped; bad filename
  rejected; scan finds manual jars and identifies them; update/remove refused
  while running; update replaces the file; offline listing.
- Integration (opt-in, network): search `fabric-api` for Fabric 1.21.4,
  install into a temp `mods/`, verify sha512 and that `listInstalled` shows
  it from Modrinth.
- Manual smoke items: install a plugin on Paper and a mod with a dependency
  on Fabric; both load after restart; remove one.
