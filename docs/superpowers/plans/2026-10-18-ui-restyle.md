# UI Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Blockhost's renderer to the dark admin-panel design: design tokens, bundled fonts, a sidebar shell with a server switcher, a server header, a new Overview section, and every existing screen moved to the new look.

**Architecture:** Colours, radii and fonts become Tailwind 4 `@theme` tokens in `main.css`. A restyled kit in `components/ui.tsx` plus `components/icons.tsx` provides the building blocks. `components/AppShell.tsx` replaces the header-plus-tabs layout; `pages/ServerPage.tsx` (renamed from `ServerDetail.tsx`) renders the server header and the active section from `pages/sections/`. Only renderer code changes.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, Tailwind 4, Vitest (node environment, `src/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-10-18-ui-restyle-design.md`

## Global Constraints

- Only files under `src/renderer/`, `package.json`, `package-lock.json` and `docs/` change. No changes to `src/main/`, `src/preload/`, `src/shared/`, IPC or `src/renderer/index.html` (CSP stays as is).
- The only new dependencies are `@fontsource-variable/geist` and `@fontsource-variable/jetbrains-mono` (runtime `dependencies`). No icon, component or animation library.
- No behaviour of existing features changes: state, effects, `api.*` calls, validation, confirmation flows and user-facing strings stay as they are unless a task says otherwise. Restyle tasks change JSX structure and classes only.
- Colours come only from the theme tokens (`bg-panel`, `text-muted`, `border-border` …). Files a task touches must end with no Tailwind palette colour classes: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow|gray|slate|neutral)-[0-9]" <file>` prints nothing. No hex colours in `.tsx` files except the avatar palette in `lib/format.ts`.
- Radii: cards `rounded-card` (14px), buttons/inputs/nav `rounded-btn` (9px), badges/chips `rounded-sm` (7px).
- Mono font (`font-mono`) for addresses, ports, versions, numbers and console text.
- Unit tests stay in the node environment: test only pure functions (`*.test.ts`), no component rendering tests.
- After every task: `npm run typecheck`, `npm test` and `npm run build` pass; run `npx prettier --write` on the files you changed.
- Commit messages: conventional style (`feat:`, `style:`, `docs:`), no `Co-Authored-By` or any Claude/AI attribution lines.
- The window's minimum width is 860px and default 1100px; the sidebar collapses to an icon rail below 1000px (`min-[1000px]:` variants).

### Class mapping (for restyle tasks)

| Old classes                                    | New classes                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| `bg-zinc-950`                                  | `bg-bg`                                              |
| `bg-zinc-900`, `bg-zinc-900/60`                | `bg-panel`                                           |
| `bg-zinc-800`, `bg-zinc-700`                   | `bg-panel-2`                                         |
| `bg-black` (log panels)                        | `bg-console`                                         |
| `border-zinc-800`, `divide-zinc-800`           | `border-border`, `divide-border-soft`                |
| `border-zinc-700`, `border-zinc-600`           | `border-border-strong`                               |
| `text-zinc-100`, `text-zinc-200`               | `text-text`                                          |
| `text-zinc-300`                                | `text-text-2`                                        |
| `text-zinc-400`                                | `text-muted`                                         |
| `text-zinc-500`, `text-zinc-600`               | `text-faint`                                         |
| `bg-zinc-500` (dots)                           | `bg-faint`                                           |
| `text-emerald-*`                               | `text-accent` (or `text-ok-text` in notices)         |
| `bg-emerald-950/*` + `border-emerald-900`      | `bg-ok-bg` + `border-ok-border`, text `text-ok-text` |
| `bg-emerald-400/500/600`, `border-emerald-500` | `bg-accent`, `border-accent`                         |
| `accent-emerald-500` (checkbox/range)          | `accent-accent`                                      |
| `text-red-300/400`                             | `text-danger`                                        |
| `bg-red-950/*` + `border-red-900*`             | `bg-bad-bg` + `border-bad-border`                    |
| `bg-red-500/600/700`                           | `bg-danger`                                          |
| `text-amber-*`                                 | `text-warn`                                          |
| `bg-amber-950/*` + `border-amber-800/900`      | `bg-warn-bg` + `border-warn-border`                  |
| `bg-amber-400/500`                             | `bg-warn`                                            |
| `text-sky-400`                                 | `text-info`                                          |
| `rounded-md`, `rounded` on buttons/inputs      | `rounded-btn`                                        |
| `rounded-md`/`rounded-lg` on panels            | `rounded-card`                                       |

---

### Task 1: Theme tokens and fonts

**Files:**

- Modify: `package.json` (dependencies)
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**

- Produces: Tailwind utilities for every token below (`bg-bg`, `bg-panel`, `text-muted`, `border-border-strong`, `ring-ring`, `rounded-card`, `rounded-btn`, `rounded-sm`, `font-sans`, `font-mono`, `fill-accent` …) used by all later tasks.

- [ ] **Step 1: Install the fonts**

Run: `npm install @fontsource-variable/geist@^5.3.0 @fontsource-variable/jetbrains-mono@^5.3.0`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Replace `src/renderer/src/assets/main.css`**

```css
@import 'tailwindcss';

@theme {
  --color-bg: #0c0e11;
  --color-sidebar: #0f1215;
  --color-panel: #13171b;
  --color-panel-2: #1a1f25;
  --color-console: #0a0c0e;
  --color-nav-active: #1c2229;
  --color-border: #1f242b;
  --color-border-soft: #1a1f25;
  --color-border-strong: #2a313a;
  --color-ring: #262d35;
  --color-text: #e8eaed;
  --color-text-2: #c9d0d7;
  --color-muted: #8c96a1;
  --color-nav: #9aa3ae;
  --color-faint: #6f7883;
  --color-accent: #8be36b;
  --color-accent-ink: #0c0e11;
  --color-link: #9be07f;
  --color-info: #6fa8f5;
  --color-warn: #f2b84b;
  --color-danger: #f2958a;
  --color-ok-bg: #172517;
  --color-ok-text: #a6e795;
  --color-ok-border: #25402a;
  --color-bad-bg: #251818;
  --color-bad-border: #402525;
  --color-stop-bg: #2a1717;
  --color-stop-text: #f7b0a7;
  --color-stop-border: #4a2a2a;
  --color-warn-bg: #2a2214;
  --color-warn-border: #4a3b1e;

  --radius-card: 14px;
  --radius-btn: 9px;
  --radius-sm: 7px;

  --font-sans: 'Geist Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', Consolas, monospace;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: color-mix(in srgb, var(--color-accent) 35%, transparent);
}
```

- [ ] **Step 3: Import the fonts in `src/renderer/src/main.tsx`**

Replace the first line `import './assets/main.css'` with:

```tsx
import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import './assets/main.css'
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass. Then confirm the fonts were bundled locally:
Run: `ls out/renderer/assets | grep -i woff2`
Expected: at least one `geist-*.woff2` and one `jetbrains-mono-*.woff2` file.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/assets/main.css src/renderer/src/main.tsx
git commit -m "style: add design tokens and bundle Geist and JetBrains Mono"
```

---

### Task 2: Pure helpers (routes, log levels, formatting, uptime)

**Files:**

- Create: `src/renderer/src/lib/routes.ts`, `src/renderer/src/lib/routes.test.ts`
- Create: `src/renderer/src/lib/logLevel.ts`, `src/renderer/src/lib/logLevel.test.ts`
- Create: `src/renderer/src/lib/uptime.ts`, `src/renderer/src/lib/uptime.test.ts`
- Modify: `src/renderer/src/lib/format.ts`
- Create: `src/renderer/src/lib/format.test.ts`

**Interfaces:**

- Produces:
  - `type Section = 'overview' | 'console' | 'players' | 'content' | 'properties' | 'connect' | 'settings'`
  - `interface SectionInfo { id: Section; label: string }`
  - `sectionsFor(type: ServerType): SectionInfo[]`
  - `resolveSection(type: ServerType, remembered?: Section): Section`
  - `type LogLevel = 'info' | 'warn' | 'error' | 'chat' | 'cmd' | 'system' | 'plain'`
  - `interface ParsedLine { level: LogLevel; tagEnd: number }` — `tagEnd` is the length of the `[time] [thread/LEVEL]: ` prefix, 0 when there is none
  - `parseLogLevel(text: string): ParsedLine`
  - `type LogFilter = 'all' | 'warnings' | 'chat'`
  - `matchesFilter(level: LogLevel, filter: LogFilter): boolean`
  - `LEVEL_TEXT: Record<LogLevel, string>` (Tailwind text classes)
  - `nextRunningSince(prev: Record<string, number>, serverId: string, status: ServerStatus, now: number): Record<string, number>`
  - In `format.ts`: `formatUptime(ms: number): string`, `avatarColor(name: string): string`, `AVATAR_COLORS: readonly string[]`, `serverAddress(server: Pick<ServerView, 'port' | 'tunnel'>): string`, `javaLabel(javaPath?: string): string`; `STATUS_DOT` switched to token classes.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSection, sectionsFor } from './routes'

describe('sectionsFor', () => {
  it('hides the content section for Vanilla', () => {
    expect(sectionsFor('vanilla').map((s) => s.id)).toEqual([
      'overview',
      'console',
      'players',
      'properties',
      'connect',
      'settings'
    ])
  })

  it('labels the content section Plugins for Paper and Mods for Fabric', () => {
    expect(sectionsFor('paper').find((s) => s.id === 'content')?.label).toBe('Plugins')
    expect(sectionsFor('fabric').find((s) => s.id === 'content')?.label).toBe('Mods')
  })

  it('keeps the sidebar order', () => {
    expect(sectionsFor('neoforge').map((s) => s.label)).toEqual([
      'Overview',
      'Console',
      'Players',
      'Mods',
      'Properties',
      'Connect',
      'Settings'
    ])
  })
})

describe('resolveSection', () => {
  it('defaults to overview', () => {
    expect(resolveSection('paper')).toBe('overview')
  })

  it('keeps a remembered section the server has', () => {
    expect(resolveSection('paper', 'content')).toBe('content')
    expect(resolveSection('vanilla', 'console')).toBe('console')
  })

  it('falls back to overview when the server has no such section', () => {
    expect(resolveSection('vanilla', 'content')).toBe('overview')
  })
})
```

`src/renderer/src/lib/logLevel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchesFilter, parseLogLevel } from './logLevel'

describe('parseLogLevel', () => {
  it('reads a vanilla INFO line and its prefix length', () => {
    const text = '[12:00:00] [Server thread/INFO]: Done (3.2s)!'
    expect(parseLogLevel(text)).toEqual({
      level: 'info',
      tagEnd: '[12:00:00] [Server thread/INFO]: '.length
    })
  })

  it('reads Paper-style WARN lines', () => {
    const text = "[12:00:00 WARN]: Can't keep up!"
    expect(parseLogLevel(text)).toEqual({ level: 'warn', tagEnd: '[12:00:00 WARN]: '.length })
  })

  it('maps ERROR, SEVERE and FATAL to error', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/ERROR]: Failed').level).toBe('error')
    expect(parseLogLevel('[12:00:00 SEVERE]: Broken').level).toBe('error')
    expect(parseLogLevel('[12:00:00] [main/FATAL]: Crash').level).toBe('error')
  })

  it('includes a Forge logger bracket in the prefix', () => {
    const text = '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done'
    expect(parseLogLevel(text)).toEqual({
      level: 'info',
      tagEnd: '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: '.length
    })
  })

  it('detects chat lines', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/INFO]: <Steve> hello').level).toBe('chat')
    expect(parseLogLevel('[12:00:00 INFO]: [Not Secure] <Steve> hi').level).toBe('chat')
  })

  it('marks echoed commands and Blockhost lines', () => {
    expect(parseLogLevel('> op Steve')).toEqual({ level: 'cmd', tagEnd: 0 })
    expect(parseLogLevel('[Blockhost] Server stopped')).toEqual({ level: 'system', tagEnd: 0 })
  })

  it('falls back to keywords for lines without a prefix', () => {
    expect(parseLogLevel('java.lang.RuntimeException: boom')).toEqual({ level: 'error', tagEnd: 0 })
    expect(parseLogLevel('WARNING: something odd')).toEqual({ level: 'warn', tagEnd: 0 })
    expect(parseLogLevel('\tat foo.Bar.baz(Bar.java:1)')).toEqual({ level: 'plain', tagEnd: 0 })
  })

  it('treats malformed and empty lines as plain', () => {
    expect(parseLogLevel('[12:00:00] [Server thread/INF')).toEqual({ level: 'plain', tagEnd: 0 })
    expect(parseLogLevel('')).toEqual({ level: 'plain', tagEnd: 0 })
  })
})

describe('matchesFilter', () => {
  it('shows everything for all', () => {
    expect(matchesFilter('plain', 'all')).toBe(true)
  })

  it('shows warnings and errors for warnings', () => {
    expect(matchesFilter('warn', 'warnings')).toBe(true)
    expect(matchesFilter('error', 'warnings')).toBe(true)
    expect(matchesFilter('info', 'warnings')).toBe(false)
  })

  it('shows only chat for chat', () => {
    expect(matchesFilter('chat', 'chat')).toBe(true)
    expect(matchesFilter('cmd', 'chat')).toBe(false)
  })
})
```

`src/renderer/src/lib/uptime.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextRunningSince } from './uptime'

describe('nextRunningSince', () => {
  it('records the time a server becomes running', () => {
    expect(nextRunningSince({}, 'a', 'running', 1000)).toEqual({ a: 1000 })
  })

  it('keeps the first time while it stays running', () => {
    const prev = { a: 1000 }
    expect(nextRunningSince(prev, 'a', 'running', 5000)).toBe(prev)
  })

  it('forgets the time when the server leaves running', () => {
    expect(nextRunningSince({ a: 1000, b: 2000 }, 'a', 'stopping', 5000)).toEqual({ b: 2000 })
  })

  it('returns the same object when nothing changes', () => {
    const prev = { b: 2000 }
    expect(nextRunningSince(prev, 'a', 'stopped', 5000)).toBe(prev)
  })
})
```

`src/renderer/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, avatarColor, formatUptime, javaLabel, serverAddress } from './format'

describe('formatUptime', () => {
  it.each([
    [-5, '0s'],
    [0, '0s'],
    [45_000, '45s'],
    [125_000, '2m 5s'],
    [3_725_000, '1h 2m'],
    [90_000_000, '1d 1h']
  ])('%i ms → %s', (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected)
  })
})

describe('avatarColor', () => {
  it('is stable and from the palette', () => {
    expect(avatarColor('Steve')).toBe(avatarColor('Steve'))
    expect(AVATAR_COLORS).toContain(avatarColor('Steve'))
    expect(AVATAR_COLORS).toContain(avatarColor(''))
  })
})

describe('serverAddress', () => {
  it('uses the tunnel address when shared', () => {
    expect(
      serverAddress({ port: 25565, tunnel: { enabled: true, address: 'abc.joinmc.link' } })
    ).toBe('abc.joinmc.link')
  })

  it('falls back to localhost and the port', () => {
    expect(serverAddress({ port: 25570 })).toBe('localhost:25570')
    expect(serverAddress({ port: 25570, tunnel: { enabled: false, address: 'x.y' } })).toBe(
      'localhost:25570'
    )
    expect(serverAddress({ port: 25570, tunnel: { enabled: true } })).toBe('localhost:25570')
  })
})

describe('javaLabel', () => {
  it('says auto without a custom path', () => {
    expect(javaLabel(undefined)).toBe('Java auto')
  })

  it('shows the custom file name', () => {
    expect(javaLabel('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe')).toBe('java.exe')
    expect(javaLabel('/usr/bin/java')).toBe('java')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib`
Expected: FAIL — modules `./routes`, `./logLevel`, `./uptime` not found and `formatUptime` etc. not exported.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/routes.ts`:

```ts
import { CONTENT_LABELS, type ServerType } from '../../../shared/types'

export type Section =
  'overview' | 'console' | 'players' | 'content' | 'properties' | 'connect' | 'settings'

export interface SectionInfo {
  id: Section
  label: string
}

const ORDER: Section[] = [
  'overview',
  'console',
  'players',
  'content',
  'properties',
  'connect',
  'settings'
]

const LABELS: Record<Exclude<Section, 'content'>, string> = {
  overview: 'Overview',
  console: 'Console',
  players: 'Players',
  properties: 'Properties',
  connect: 'Connect',
  settings: 'Settings'
}

/** The sidebar sections a server of this type has, in order. */
export function sectionsFor(type: ServerType): SectionInfo[] {
  const contentLabel = CONTENT_LABELS[type]
  return ORDER.flatMap((id): SectionInfo[] => {
    if (id !== 'content') return [{ id, label: LABELS[id] }]
    return contentLabel ? [{ id, label: contentLabel }] : []
  })
}

/** The remembered section if this server type has it, otherwise Overview. */
export function resolveSection(type: ServerType, remembered?: Section): Section {
  if (!remembered) return 'overview'
  return sectionsFor(type).some((s) => s.id === remembered) ? remembered : 'overview'
}
```

`src/renderer/src/lib/logLevel.ts`:

```ts
export type LogLevel = 'info' | 'warn' | 'error' | 'chat' | 'cmd' | 'system' | 'plain'
export type LogFilter = 'all' | 'warnings' | 'chat'

export interface ParsedLine {
  level: LogLevel
  /** Length of the `[time] [thread/LEVEL]: ` prefix; 0 when the line has none. */
  tagEnd: number
}

// Vanilla/Fabric: "[12:00:00] [Server thread/INFO]: msg"
// Forge/NeoForge: "[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: msg"
// Paper/Purpur:   "[12:00:00 INFO]: msg"
const PREFIX =
  /^((?:\[[^\]]*\]\s*)?\[[^\]]*?[/ ](INFO|WARN|WARNING|ERROR|SEVERE|FATAL|DEBUG|TRACE)\](?:\s*\[[^\]]*\])?:?\s*)(.*)$/
const CHAT = /^(?:\[Not Secure\]\s*)?<[^>]+>\s/

function levelOf(tag: string, message: string): LogLevel {
  if (tag === 'WARN' || tag === 'WARNING') return 'warn'
  if (tag === 'ERROR' || tag === 'SEVERE' || tag === 'FATAL') return 'error'
  return CHAT.test(message) ? 'chat' : 'info'
}

export function parseLogLevel(text: string): ParsedLine {
  if (text.startsWith('> ')) return { level: 'cmd', tagEnd: 0 }
  if (text.startsWith('[Blockhost]')) return { level: 'system', tagEnd: 0 }
  const match = PREFIX.exec(text)
  if (match) return { level: levelOf(match[2]!, match[3]!), tagEnd: match[1]!.length }
  if (/\b(ERROR|SEVERE|FATAL)\b|Exception/.test(text)) return { level: 'error', tagEnd: 0 }
  if (/\bWARN(ING)?\b/.test(text)) return { level: 'warn', tagEnd: 0 }
  return { level: 'plain', tagEnd: 0 }
}

export function matchesFilter(level: LogLevel, filter: LogFilter): boolean {
  if (filter === 'warnings') return level === 'warn' || level === 'error'
  if (filter === 'chat') return level === 'chat'
  return true
}

export const LEVEL_TEXT: Record<LogLevel, string> = {
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-danger',
  chat: 'text-ok-text',
  cmd: 'text-accent',
  system: 'text-info',
  plain: 'text-text-2'
}
```

`src/renderer/src/lib/uptime.ts`:

```ts
import type { ServerStatus } from '../../../shared/types'

/** Updates the map of server id → time it was first seen running. */
export function nextRunningSince(
  prev: Record<string, number>,
  serverId: string,
  status: ServerStatus,
  now: number
): Record<string, number> {
  if (status === 'running') {
    return prev[serverId] === undefined ? { ...prev, [serverId]: now } : prev
  }
  if (prev[serverId] === undefined) return prev
  const next = { ...prev }
  delete next[serverId]
  return next
}
```

In `src/renderer/src/lib/format.ts`:

1. Change the import to `import type { ServerStatus, ServerType, ServerView } from '../../../shared/types'`.
2. Replace `STATUS_DOT` with:

```ts
export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'bg-faint',
  starting: 'bg-warn animate-pulse',
  running: 'bg-accent',
  stopping: 'bg-warn animate-pulse',
  crashed: 'bg-danger'
}
```

3. Append:

```ts
/** "45s", "2m 5s", "1h 2m", "1d 1h". */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export const AVATAR_COLORS = [
  '#6FA8F5',
  '#F2B84B',
  '#C792EA',
  '#8BE36B',
  '#F2958A',
  '#5FD3C6'
] as const

/** A stable colour for a player's letter avatar. */
export function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

/** The address players use: the playit address when shared, otherwise localhost. */
export function serverAddress(server: Pick<ServerView, 'port' | 'tunnel'>): string {
  const tunnel = server.tunnel
  return tunnel?.enabled && tunnel.address ? tunnel.address : `localhost:${server.port}`
}

export function javaLabel(javaPath?: string): string {
  if (!javaPath) return 'Java auto'
  return javaPath.split(/[\\/]/).pop() || javaPath
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/lib`
Expected: PASS. Then `npm run typecheck && npm test && npm run build` pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib
git commit -m "feat: add section, log level, uptime and address helpers for the restyle"
```

---

### Task 3: Component kit and icons

**Files:**

- Modify (rewrite): `src/renderer/src/components/ui.tsx`
- Create: `src/renderer/src/components/icons.tsx`

**Interfaces:**

- Consumes: `STATUS_DOT`, `STATUS_LABEL`, `avatarColor` from `lib/format`.
- Produces (all exported from `components/ui.tsx`):
  - `Button(props & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' })`
  - `inputClass: string`, `Field({ label, hint?, children })`, `ErrorText({ children })`
  - `Notice({ tone: 'ok' | 'warn' | 'info'; children })`
  - `Card({ title?, description?, actions?, className?, children })`
  - `StatusPill({ status })`, `StatusBadge` (alias of `StatusPill`)
  - `Badge({ tone?: 'neutral' | 'accent' | 'warn' | 'danger'; mono?: boolean; children })`, `TypeBadge({ server })`
  - `Switch({ checked, onChange, disabled?, label })`
  - `Segmented<T extends string>({ label, options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void })`
  - `Table({ children })`, `Th`, `Td` (spread `th`/`td` attributes), `trClass: string`
  - `type MenuEntry`, `Menu({ label, button, buttonClassName?, items, align? })`
  - `Avatar({ name, size? })`, `TextLink({ onClick, children })`, `pageClass: string`
  - From `components/icons.tsx`: `OverviewIcon`, `ConsoleIcon`, `PlayersIcon`, `ContentIcon`, `PropertiesIcon`, `ConnectIcon`, `SettingsIcon`, `ServersIcon`, `PlusIcon`, `ChevronDownIcon`, `MoreIcon`, `CopyIcon`, `Logo` — each `(props: SVGProps<SVGSVGElement>) => JSX`.

Existing call sites keep compiling: `Button` keeps its props (`size` is optional, default `md`), `StatusBadge`, `TypeBadge`, `Field`, `inputClass`, `ErrorText` keep their names and props.

- [ ] **Step 1: Write `src/renderer/src/components/icons.tsx`**

```tsx
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const OverviewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
)

export const ConsoleIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </Icon>
)

export const PlayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2" />
  </Icon>
)

export const ContentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
  </Icon>
)

export const PropertiesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
)

export const ConnectIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Icon>
)

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </Icon>
)

export const ServersIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
)

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Icon>
)

const LOGO_OPACITY = [1, 0.55, 1, 0.55, 1, 0.55, 1, 0.55, 1]

/** The Blockhost mark: a 3×3 grid of blocks. */
export function Logo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {LOGO_OPACITY.map((opacity, i) => (
        <rect
          key={i}
          x={1 + (i % 3) * 8}
          y={1 + Math.floor(i / 3) * 8}
          width="6"
          height="6"
          rx="1.5"
          className="fill-accent"
          opacity={opacity}
        />
      ))}
    </svg>
  )
}
```

- [ ] **Step 2: Rewrite `src/renderer/src/components/ui.tsx`**

```tsx
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes
} from 'react'
import { SERVER_TYPE_LABELS, type ServerStatus, type ServerView } from '../../../shared/types'
import { avatarColor, STATUS_DOT, STATUS_LABEL } from '../lib/format'

/** Padding and max width shared by every page. */
export const pageClass = 'mx-auto w-full max-w-[1200px] px-8 py-7'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent font-semibold text-accent-ink hover:brightness-110',
  secondary: 'border border-border-strong bg-panel-2 text-text hover:bg-nav-active',
  danger: 'border border-stop-border bg-stop-bg text-stop-text hover:brightness-125',
  ghost: 'text-text-2 hover:bg-panel-2 hover:text-text'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-btn font-medium transition disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-btn border border-border-strong bg-sidebar px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-50'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-text-2">{label}</div>
      {children}
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-btn border border-bad-border bg-bad-bg px-3 py-2 text-sm text-danger">
      {children}
    </p>
  )
}

const NOTICE_TONES = {
  ok: 'border-ok-border bg-ok-bg text-ok-text',
  warn: 'border-warn-border bg-warn-bg text-warn',
  info: 'border-border-strong bg-panel-2 text-text-2'
} as const

export function Notice({
  tone,
  children
}: {
  tone: keyof typeof NOTICE_TONES
  children: ReactNode
}) {
  return (
    <div className={`rounded-btn border px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}>{children}</div>
  )
}

export function Card({
  title,
  description,
  actions,
  className = '',
  children
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={`rounded-card border border-border bg-panel p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

const PILL_TONES: Record<ServerStatus, string> = {
  running: 'border-ok-border bg-ok-bg text-ok-text',
  starting: 'border-warn-border bg-warn-bg text-warn',
  stopping: 'border-warn-border bg-warn-bg text-warn',
  stopped: 'border-bad-border bg-bad-bg text-danger',
  crashed: 'border-bad-border bg-bad-bg text-danger'
}

export function StatusPill({ status }: { status: ServerStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export const StatusBadge = StatusPill

const BADGE_TONES = {
  neutral: 'border-border-strong bg-panel-2 text-text-2',
  accent: 'border-ok-border bg-ok-bg text-ok-text',
  warn: 'border-warn-border bg-warn-bg text-warn',
  danger: 'border-bad-border bg-bad-bg text-danger'
} as const

export function Badge({
  tone = 'neutral',
  mono = false,
  children
}: {
  tone?: keyof typeof BADGE_TONES
  mono?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs ${mono ? 'font-mono' : ''} ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function TypeBadge({ server }: { server: Pick<ServerView, 'type' | 'mcVersion'> }) {
  return (
    <Badge mono>
      {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
    </Badge>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-accent bg-accent' : 'border-border-strong bg-panel-2'
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? 'translate-x-[18px] bg-accent-ink' : 'translate-x-[2px] bg-muted'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-btn border border-border bg-sidebar p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-3 py-1 text-[13px] font-medium transition-colors ${
            o.value === value ? 'bg-nav-active text-text' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-btn border border-border-soft">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function Th({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-border-soft bg-sidebar px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted ${className}`}
      {...props}
    />
  )
}

export function Td({ className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b border-border-soft px-3 py-2.5 text-text-2 ${className}`} {...props} />
  )
}

/** Row class: hover tint and no border under the last row. */
export const trClass = 'transition-colors hover:bg-panel-2/60 [&:last-child>td]:border-b-0'

export type MenuEntry =
  | 'divider'
  | {
      label: string
      onSelect: () => void
      icon?: ReactNode
      hint?: ReactNode
      disabled?: boolean
      danger?: boolean
      selected?: boolean
    }

export function Menu({
  label,
  button,
  buttonClassName = '',
  items,
  align = 'left'
}: {
  label: string
  button: ReactNode
  buttonClassName?: string
  items: MenuEntry[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-20 mt-1 min-w-[220px] rounded-btn border border-border-strong bg-panel p-1 shadow-xl shadow-black/40 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item, i) =>
            item === 'divider' ? (
              <div key={`divider-${i}`} role="separator" className="my-1 h-px bg-border-soft" />
            ) : (
              <button
                key={`${i}-${item.label}`}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                  item.danger ? 'text-stop-text' : item.selected ? 'text-text' : 'text-text-2'
                }`}
              >
                {item.icon && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.hint && (
                    <span className="block truncate text-xs text-faint">{item.hint}</span>
                  )}
                </span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

/** A letter avatar for a player (no skin images, so no CSP change). */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-sm font-mono text-xs font-semibold text-accent-ink"
      style={{ width: size, height: size, backgroundColor: avatarColor(name) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-medium text-link hover:underline"
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass (existing screens still compile against the same exported names).
Run: `grep -nE "(zinc|emerald|red|amber|sky)-[0-9]" src/renderer/src/components/ui.tsx src/renderer/src/components/icons.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ui.tsx src/renderer/src/components/icons.tsx
git commit -m "style: restyle the component kit and add cards, pills, switches, menus and icons"
```

---

### Task 4: App shell, routing, server header and section move

**Files:**

- Create: `src/renderer/src/components/AppShell.tsx`
- Create: `src/renderer/src/hooks/useOnlinePlayers.ts`, `src/renderer/src/hooks/useCopy.ts`
- Modify: `src/renderer/src/hooks/useServers.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/UpdateBanner.tsx`
- Rename + modify: `src/renderer/src/pages/ServerDetail.tsx` → `src/renderer/src/pages/ServerPage.tsx`
- Rename: `src/renderer/src/pages/tabs/*Tab.tsx` → `src/renderer/src/pages/sections/*Section.tsx`

**Interfaces:**

- Consumes: Task 2 `Section`, `sectionsFor`, `resolveSection`, `nextRunningSince`, `serverAddress`, `javaLabel`, `formatRam`; Task 3 kit and icons.
- Produces:
  - `useOnlinePlayers(serverId: string | undefined, status: ServerStatus | undefined): string[]`
  - `useCopy(): { copied: boolean; copy: (text: string) => void }`
  - `useServers()` now also returns `runningSince: Record<string, number>`
  - `ServerPage({ server, section, online, runningSince, onSection, onChanged, onDeleted })` in `pages/ServerPage.tsx`
  - Section components: `ConsoleSection({ server })`, `PlayersSection({ server })`, `ContentSection({ server })`, `PropertiesSection({ server, onChanged })`, `SettingsSection({ server, onChanged, onDeleted })`, `ConnectSection({ server, onChanged })` in `pages/sections/`
  - In `ServerPage.tsx`, the Overview slot renders `<p className="text-muted">Overview is coming in the next task.</p>` until Task 6 replaces it — this placeholder must be gone after Task 6.

- [ ] **Step 1: Move the tab files**

```bash
mkdir -p src/renderer/src/pages/sections
git mv src/renderer/src/pages/tabs/ConsoleTab.tsx src/renderer/src/pages/sections/ConsoleSection.tsx
git mv src/renderer/src/pages/tabs/PlayersTab.tsx src/renderer/src/pages/sections/PlayersSection.tsx
git mv src/renderer/src/pages/tabs/ContentTab.tsx src/renderer/src/pages/sections/ContentSection.tsx
git mv src/renderer/src/pages/tabs/PropertiesTab.tsx src/renderer/src/pages/sections/PropertiesSection.tsx
git mv src/renderer/src/pages/tabs/SettingsTab.tsx src/renderer/src/pages/sections/SettingsSection.tsx
git mv src/renderer/src/pages/tabs/ConnectTab.tsx src/renderer/src/pages/sections/ConnectSection.tsx
git mv src/renderer/src/pages/ServerDetail.tsx src/renderer/src/pages/ServerPage.tsx
```

In each moved section file rename only the exported component (`ConsoleTab` → `ConsoleSection`, `PlayersTab` → `PlayersSection`, `ContentTab` → `ContentSection`, `PropertiesTab` → `PropertiesSection`, `SettingsTab` → `SettingsSection`, `ConnectTab` → `ConnectSection`). Relative imports are unchanged because `sections/` sits at the same depth as `tabs/`. Do not change anything else in these files in this task.

- [ ] **Step 2: Write `src/renderer/src/hooks/useOnlinePlayers.ts`**

```ts
import { useEffect, useState } from 'react'
import type { ServerStatus } from '../../../shared/types'
import { api } from '../lib/api'

/** Names of the players online on a running server, kept up to date. */
export function useOnlinePlayers(
  serverId: string | undefined,
  status: ServerStatus | undefined
): string[] {
  const [online, setOnline] = useState<string[]>([])

  useEffect(() => {
    setOnline([])
    if (!serverId || status !== 'running') return
    let alive = true
    const load = () =>
      api
        .getPlayers(serverId)
        .then((lists) => {
          if (alive) setOnline(lists.online)
        })
        .catch(() => {})
    void load()
    const off = api.on('players:changed', (event) => {
      if (event.serverId === serverId) void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [serverId, status])

  return online
}
```

- [ ] **Step 3: Write `src/renderer/src/hooks/useCopy.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

/** Copies text to the clipboard; `copied` is true for 1.5 s afterwards. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [])

  return { copied, copy }
}
```

- [ ] **Step 4: Track running-since in `src/renderer/src/hooks/useServers.ts`**

Add `import { nextRunningSince } from '../lib/uptime'`, a state `const [runningSince, setRunningSince] = useState<Record<string, number>>({})`, and inside the existing `server:status` listener (alongside the existing `setServers` call) add:

```ts
setRunningSince((prev) => nextRunningSince(prev, event.serverId, event.status, Date.now()))
```

The listener body becomes a block with both calls. Return `{ servers, loaded, error, refresh, runningSince }`.

- [ ] **Step 5: Restyle `src/renderer/src/components/UpdateBanner.tsx` for the sidebar**

Keep `useUpdateStatus`, the dismiss logic and every message string. Replace the four returned elements so each is a compact sidebar card: the outer element is `<div className="space-y-2 rounded-btn border px-3 py-2.5 text-xs ...">` with tone classes `border-ok-border bg-ok-bg text-ok-text` for available/downloading/ready and `border-border-strong bg-panel text-muted` for error; buttons inside use `<Button size="sm" variant="primary" className="w-full">Restart to update</Button>` and `<Button size="sm" variant="ghost" className="w-full">Dismiss</Button>`, placed under the text (stacked, not side by side). The install error line uses `text-danger`.

- [ ] **Step 6: Write `src/renderer/src/components/AppShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { STATUS_DOT } from '../lib/format'
import { sectionsFor, type Section } from '../lib/routes'
import {
  ChevronDownIcon,
  ConnectIcon,
  ConsoleIcon,
  ContentIcon,
  Logo,
  OverviewIcon,
  PlayersIcon,
  PlusIcon,
  PropertiesIcon,
  ServersIcon,
  SettingsIcon
} from './icons'
import { Menu, type MenuEntry } from './ui'
import { UpdateBanner } from './UpdateBanner'

const SECTION_ICONS: Record<Section, ReactNode> = {
  overview: <OverviewIcon />,
  console: <ConsoleIcon />,
  players: <PlayersIcon />,
  content: <ContentIcon />,
  properties: <PropertiesIcon />,
  connect: <ConnectIcon />,
  settings: <SettingsIcon />
}

interface Props {
  servers: ServerView[]
  active: 'list' | 'new' | 'server'
  current?: ServerView
  section?: Section
  onlineCount: number
  version?: string
  offline: boolean
  onSection: (section: Section) => void
  onOpenServer: (id: string) => void
  onAllServers: () => void
  onNewServer: () => void
  children: ReactNode
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick
}: {
  icon: ReactNode
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-3 rounded-btn px-3 text-sm font-medium transition-colors ${
        active
          ? 'bg-nav-active text-text ring-1 ring-inset ring-ring'
          : 'text-nav hover:bg-panel hover:text-text'
      }`}
    >
      <span className="h-[18px] w-[18px] shrink-0 [&>svg]:h-full [&>svg]:w-full">{icon}</span>
      <span className="hidden flex-1 truncate text-left min-[1000px]:inline">{label}</span>
      {badge !== undefined && (
        <span className="hidden rounded-sm bg-panel-2 px-1.5 font-mono text-[11px] text-text-2 min-[1000px]:inline">
          {badge}
        </span>
      )}
    </button>
  )
}

function ServerSwitcher({
  servers,
  current,
  onOpenServer,
  onAllServers,
  onNewServer
}: {
  servers: ServerView[]
  current: ServerView
  onOpenServer: (id: string) => void
  onAllServers: () => void
  onNewServer: () => void
}) {
  const items: MenuEntry[] = [
    ...servers.map((s): MenuEntry => ({
      label: s.name,
      hint: `${SERVER_TYPE_LABELS[s.type]} ${s.mcVersion}`,
      icon: <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} />,
      selected: s.id === current.id,
      onSelect: () => onOpenServer(s.id)
    })),
    'divider',
    { label: 'New server', icon: <PlusIcon />, onSelect: onNewServer },
    { label: 'All servers', icon: <ServersIcon />, onSelect: onAllServers }
  ]
  return (
    <Menu
      label={`Switch server (current: ${current.name})`}
      items={items}
      buttonClassName="flex h-11 w-full items-center gap-2.5 rounded-btn border border-border bg-panel px-3 text-left transition-colors hover:border-border-strong"
      button={
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[current.status]}`} />
          <span className="hidden min-w-0 flex-1 truncate text-sm font-medium text-text min-[1000px]:block">
            {current.name}
          </span>
          <ChevronDownIcon className="hidden h-4 w-4 shrink-0 text-muted min-[1000px]:block" />
        </>
      }
    />
  )
}

export function AppShell({
  servers,
  active,
  current,
  section,
  onlineCount,
  version,
  offline,
  onSection,
  onOpenServer,
  onAllServers,
  onNewServer,
  children
}: Props) {
  return (
    <div className="flex h-screen bg-bg text-text">
      <aside className="flex w-16 shrink-0 flex-col border-r border-border bg-sidebar min-[1000px]:w-[248px]">
        <button
          type="button"
          onClick={onAllServers}
          className="flex h-16 shrink-0 items-center gap-2.5 px-5"
          title="All servers"
        >
          <Logo className="h-6 w-6 shrink-0" />
          <span className="hidden text-[15px] font-bold tracking-tight min-[1000px]:inline">
            Blockhost
          </span>
        </button>

        {current && (
          <div className="px-3">
            <ServerSwitcher
              servers={servers}
              current={current}
              onOpenServer={onOpenServer}
              onAllServers={onAllServers}
              onNewServer={onNewServer}
            />
          </div>
        )}

        <nav
          aria-label="Sections"
          className="mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3"
        >
          {current && section ? (
            sectionsFor(current.type).map((s) => (
              <NavItem
                key={s.id}
                icon={SECTION_ICONS[s.id]}
                label={s.label}
                active={section === s.id}
                badge={s.id === 'players' && onlineCount > 0 ? onlineCount : undefined}
                onClick={() => onSection(s.id)}
              />
            ))
          ) : (
            <>
              <NavItem
                icon={<ServersIcon />}
                label="All servers"
                active={active === 'list'}
                onClick={onAllServers}
              />
              <NavItem
                icon={<PlusIcon />}
                label="New server"
                active={active === 'new'}
                onClick={onNewServer}
              />
            </>
          )}
        </nav>

        <div className="hidden space-y-3 p-3 min-[1000px]:block">
          <UpdateBanner />
          {version && (
            <div className="px-2 font-mono text-[11px] text-faint">Blockhost v{version}</div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {offline && (
          <div className="border-b border-warn-border bg-warn-bg px-8 py-1.5 text-[13px] text-warn">
            You seem to be offline. Version lists may be out of date.
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 7: Rewrite `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorText, pageClass } from './components/ui'
import { useUpdateStatus } from './components/UpdateBanner'
import { useOnlinePlayers } from './hooks/useOnlinePlayers'
import { useServers } from './hooks/useServers'
import { api } from './lib/api'
import { resolveSection, type Section } from './lib/routes'
import { NewServerWizard } from './pages/NewServerWizard'
import { ServerList } from './pages/ServerList'
import { ServerPage } from './pages/ServerPage'

type Route = { name: 'list' } | { name: 'new' } | { name: 'server'; id: string; section: Section }

export default function App() {
  const { servers, loaded, error, refresh, runningSince } = useServers()
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [offline, setOffline] = useState(false)
  const lastSection = useRef(new Map<string, Section>())
  const updateStatus = useUpdateStatus()

  useEffect(() => api.on('net:offline', () => setOffline(true)), [])

  const current = route.name === 'server' ? servers.find((s) => s.id === route.id) : undefined
  const online = useOnlinePlayers(current?.id, current?.status)

  const goList = () => setRoute({ name: 'list' })
  const goNew = () => setRoute({ name: 'new' })
  const openServer = (id: string) => {
    const server = servers.find((s) => s.id === id)
    const remembered = lastSection.current.get(id)
    const section = server ? resolveSection(server.type, remembered) : 'overview'
    setRoute({ name: 'server', id, section })
  }
  const setSection = (section: Section) => {
    if (route.name !== 'server') return
    lastSection.current.set(route.id, section)
    setRoute({ ...route, section })
  }

  return (
    <AppShell
      servers={servers}
      active={route.name}
      current={current}
      section={route.name === 'server' ? route.section : undefined}
      onlineCount={online.length}
      version={updateStatus?.currentVersion}
      offline={offline}
      onSection={setSection}
      onOpenServer={openServer}
      onAllServers={goList}
      onNewServer={goNew}
    >
      {error && (
        <div className={`${pageClass} pb-0`}>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {route.name === 'list' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <ServerList servers={servers} loaded={loaded} onOpen={openServer} onNew={goNew} />
        </div>
      )}
      {route.name === 'new' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <NewServerWizard
            servers={servers}
            onCancel={goList}
            onCreated={() => void refresh()}
            onOpen={openServer}
          />
        </div>
      )}
      {route.name === 'server' &&
        (current ? (
          <ServerPage
            server={current}
            section={route.section}
            online={online}
            runningSince={runningSince[current.id]}
            onSection={setSection}
            onChanged={() => void refresh()}
            onDeleted={() => {
              void refresh()
              goList()
            }}
          />
        ) : (
          <p className={`${pageClass} text-muted`}>This server no longer exists.</p>
        ))}
    </AppShell>
  )
}
```

- [ ] **Step 8: Rewrite `src/renderer/src/pages/ServerPage.tsx`**

Keep the existing `run()`, `missingJava`, `showKill`/`FORCE_KILL_AFTER_MS` and InstallPanel logic exactly; remove `TABS`, the tab state, the Back button and the tab nav.

```tsx
import { useEffect, useState } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { CopyIcon, MoreIcon } from '../components/icons'
import { Badge, Button, ErrorText, Menu, pageClass, StatusPill } from '../components/ui'
import { useCopy } from '../hooks/useCopy'
import { api, ApiCallError, errorMessage } from '../lib/api'
import { formatRam, javaLabel, serverAddress } from '../lib/format'
import type { Section } from '../lib/routes'
import { ConnectSection } from './sections/ConnectSection'
import { ConsoleSection } from './sections/ConsoleSection'
import { ContentSection } from './sections/ContentSection'
import { PlayersSection } from './sections/PlayersSection'
import { PropertiesSection } from './sections/PropertiesSection'
import { SettingsSection } from './sections/SettingsSection'

const FORCE_KILL_AFTER_MS = 30_000

interface Props {
  server: ServerView
  section: Section
  online: string[]
  runningSince?: number
  onSection: (section: Section) => void
  onChanged: () => void
  onDeleted: () => void
}

export function ServerPage(props: Props) {
  // `online`, `runningSince` and `onSection` are read by the Overview (Task 6).
  const { server, section, onChanged, onDeleted } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingJava, setMissingJava] = useState<number | null>(null)
  const [showKill, setShowKill] = useState(false)
  const { copied, copy } = useCopy()

  useEffect(() => {
    setShowKill(false)
    if (server.status !== 'stopping') return
    const timer = setTimeout(() => setShowKill(true), FORCE_KILL_AFTER_MS)
    return () => clearTimeout(timer)
  }, [server.status])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMissingJava(null)
    try {
      await action()
    } catch (err) {
      const major =
        err instanceof ApiCallError && err.code === 'JAVA_MISSING' ? err.details?.major : undefined
      if (typeof major === 'number') setMissingJava(major)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = server.installState === 'ready'
  const up = server.status === 'starting' || server.status === 'running'
  const address = serverAddress(server)
  const isConsole = ready && section === 'console'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${pageClass} space-y-4 pb-0`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-[26px] font-bold leading-tight tracking-tight">
                {server.name}
              </h1>
              {ready ? (
                <StatusPill status={server.status} />
              ) : (
                <Badge tone={server.installState === 'failed' ? 'danger' : 'warn'}>
                  {server.installState === 'failed' ? 'Install failed' : 'Installing…'}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[13px] text-muted">
              <button
                type="button"
                title="Copy address"
                onClick={() => copy(address)}
                className="inline-flex items-center gap-1.5 text-text-2 transition-colors hover:text-text"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? 'Copied' : address}
              </button>
              <span className="text-faint">·</span>
              <span>
                {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
              </span>
              <span className="text-faint">·</span>
              <span>{javaLabel(server.javaPath)}</span>
              <span className="text-faint">·</span>
              <span>{formatRam(server.ramMb)}</span>
            </div>
          </div>

          {ready && (
            <div className="flex items-center gap-2">
              {!up && server.status !== 'stopping' && (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void run(() => api.start(server.id))}
                >
                  Start
                </Button>
              )}
              {up && (
                <>
                  <Button
                    disabled={busy || server.status !== 'running'}
                    onClick={() => void run(() => api.restart(server.id))}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void run(() => api.stop(server.id))}
                  >
                    Stop
                  </Button>
                </>
              )}
              {server.status === 'stopping' && (
                <Button variant="danger" disabled>
                  Stopping…
                </Button>
              )}
              <Menu
                label="More actions"
                align="right"
                buttonClassName="inline-flex h-9 w-9 items-center justify-center rounded-btn border border-border-strong bg-panel-2 text-text-2 transition-colors hover:bg-nav-active"
                button={<MoreIcon className="h-4 w-4" />}
                items={[
                  {
                    label: 'Force kill',
                    hint: 'Available after 30 s of stopping',
                    danger: true,
                    disabled: !(server.status === 'stopping' && showKill),
                    onSelect: () => void run(() => api.kill(server.id))
                  }
                ]}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="space-y-2">
            <ErrorText>{error}</ErrorText>
            {missingJava !== null && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.installJava(missingJava)
                    await api.start(server.id)
                  })
                }
              >
                {busy ? `Installing Java ${missingJava}…` : `Install Java ${missingJava} and start`}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className={`min-h-0 flex-1 ${isConsole ? 'overflow-hidden' : 'overflow-auto'}`}>
        <div className={`${pageClass} pt-6 ${isConsole ? 'h-full' : ''}`}>
          {!ready ? (
            <InstallPanel
              key={server.installState}
              serverId={server.id}
              initialState={server.installState}
              actions={(state) =>
                state === 'error' ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.retryInstall(server.id)
                          onChanged()
                        })
                      }
                    >
                      Retry install
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.removeServer(server.id, false)
                          onDeleted()
                        })
                      }
                    >
                      Delete
                    </Button>
                  </>
                ) : null
              }
            />
          ) : (
            <>
              {section === 'overview' && (
                <p className="text-muted">Overview is coming in the next task.</p>
              )}
              {section === 'console' && <ConsoleSection server={server} />}
              {section === 'players' && <PlayersSection server={server} />}
              {section === 'content' && <ContentSection server={server} />}
              {section === 'properties' && (
                <PropertiesSection server={server} onChanged={onChanged} />
              )}
              {section === 'settings' && (
                <SettingsSection server={server} onChanged={onChanged} onDeleted={onDeleted} />
              )}
              {section === 'connect' && <ConnectSection server={server} onChanged={onChanged} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

`ServerPage` takes `props: Props` and destructures only what it uses, so the props the Overview needs later (`online`, `runningSince`, `onSection`) do not trip unused-variable checks in this task.

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky)-[0-9]" src/renderer/src/App.tsx src/renderer/src/components/AppShell.tsx src/renderer/src/components/UpdateBanner.tsx src/renderer/src/pages/ServerPage.tsx`
Expected: no output.
Run: `git grep -n "ServerDetail\|pages/tabs\|Tab }" -- src/renderer`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add -A src/renderer/src
git commit -m "feat: add the sidebar shell with server switcher, section routing and server header"
```

---

### Task 5: Console section

**Files:**

- Create: `src/renderer/src/components/LogLine.tsx`
- Modify (rewrite): `src/renderer/src/pages/sections/ConsoleSection.tsx`

**Interfaces:**

- Consumes: `parseLogLevel`, `matchesFilter`, `LEVEL_TEXT`, `LogFilter`, `ParsedLine` (Task 2); `Button`, `ErrorText`, `Segmented` (Task 3).
- Produces: `LogLine({ text, level, tagEnd })` (memoised) in `components/LogLine.tsx`, used by the Overview in Task 6; `ConsoleSection({ server })`.

- [ ] **Step 1: Write `src/renderer/src/components/LogLine.tsx`**

```tsx
import { memo } from 'react'
import { LEVEL_TEXT, type ParsedLine } from '../lib/logLevel'

/** One console line: the level prefix in the level's colour, the message after it. */
export const LogLine = memo(function LogLine({
  text,
  level,
  tagEnd
}: ParsedLine & { text: string }) {
  if (tagEnd === 0) {
    return <div className={`whitespace-pre-wrap break-all ${LEVEL_TEXT[level]}`}>{text}</div>
  }
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className={LEVEL_TEXT[level]}>{text.slice(0, tagEnd)}</span>
      <span className={level === 'chat' ? 'text-text' : 'text-text-2'}>{text.slice(tagEnd)}</span>
    </div>
  )
})
```

- [ ] **Step 2: Rewrite `src/renderer/src/pages/sections/ConsoleSection.tsx`**

The log backfill/subscribe effect, the `MAX_LINES` cap, the send logic and the ↑/↓ walk are the existing ones; history moves to a per-server module map capped at 50.

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ServerView } from '../../../../shared/types'
import { LogLine } from '../../components/LogLine'
import { Button, ErrorText, Segmented } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { matchesFilter, parseLogLevel, type LogFilter, type ParsedLine } from '../../lib/logLevel'

interface Line extends ParsedLine {
  id: number
  text: string
}

const MAX_LINES = 5000
const MAX_HISTORY = 50

/** Sent commands per server, kept for the app session. */
const histories = new Map<string, string[]>()

function historyFor(serverId: string): string[] {
  let history = histories.get(serverId)
  if (!history) {
    history = []
    histories.set(serverId, history)
  }
  return history
}

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warnings', label: 'Warnings' },
  { value: 'chat', label: 'Chat' }
]

export function ConsoleSection({ server }: { server: ServerView }) {
  const [lines, setLines] = useState<Line[]>([])
  const [filter, setFilter] = useState<LogFilter>('all')
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const nextId = useRef(0)
  const historyIndex = useRef(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    historyIndex.current = -1
    setCommand('')
  }, [server.id])

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const toLines = (texts: string[]): Line[] =>
      texts.map((text) => ({ id: nextId.current++, text, ...parseLogLevel(text) }))
    const off = api.on('server:log', (event) => {
      if (!ready || event.serverId !== server.id) return
      setLines((prev) => {
        const next = prev.concat(toLines(event.lines))
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      })
    })
    api
      .getLog(server.id)
      .then((log) => setLines(toLines(log)))
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return off
  }, [server.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines, filter])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stickToBottom.current = bottom
    setAtBottom(bottom)
  }

  function jumpToLatest() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickToBottom.current = true
    setAtBottom(true)
  }

  const canSend = server.status === 'running' || server.status === 'starting'

  async function send() {
    const cmd = command.trim().replace(/^\//, '')
    if (!cmd) return
    setError(null)
    try {
      await api.sendCommand(server.id, cmd)
      const history = historyFor(server.id)
      history.push(cmd)
      if (history.length > MAX_HISTORY) history.shift()
      historyIndex.current = -1
      setCommand('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void send()
      return
    }
    const h = historyFor(server.id)
    if (h.length === 0) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      historyIndex.current =
        historyIndex.current < 0 ? h.length - 1 : Math.max(0, historyIndex.current - 1)
      setCommand(h[historyIndex.current]!)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex.current < 0) return
      historyIndex.current += 1
      if (historyIndex.current >= h.length) {
        historyIndex.current = -1
        setCommand('')
      } else {
        setCommand(h[historyIndex.current]!)
      }
    }
  }

  const shown = filter === 'all' ? lines : lines.filter((l) => matchesFilter(l.level, filter))

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Segmented label="Filter console" options={FILTERS} value={filter} onChange={setFilter} />
        <span className="font-mono text-xs text-faint">{lines.length} lines</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-auto rounded-card border border-border bg-console p-4 font-mono text-[13px] leading-6"
        >
          {lines.length === 0 ? (
            <div className="text-faint">No output yet. Start the server to see its console.</div>
          ) : shown.length === 0 ? (
            <div className="text-faint">No lines match this filter.</div>
          ) : (
            shown.map((line) => (
              <LogLine key={line.id} text={line.text} level={line.level} tagEnd={line.tagEnd} />
            ))
          )}
        </div>
        {!atBottom && (
          <Button size="sm" className="absolute bottom-3 right-5 shadow-lg" onClick={jumpToLatest}>
            Jump to latest ↓
          </Button>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex items-center gap-2 rounded-btn border border-border-strong bg-sidebar pl-3 transition-colors focus-within:border-accent">
        <span className="font-mono text-sm text-accent">&gt;</span>
        <input
          className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none placeholder:text-faint disabled:opacity-50"
          placeholder={
            canSend ? 'Type a command, e.g. op YourName' : 'Start the server to send commands'
          }
          aria-label="Console command"
          disabled={!canSend}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          size="sm"
          className="mr-1"
          disabled={!canSend || !command.trim()}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky)-[0-9]" src/renderer/src/pages/sections/ConsoleSection.tsx src/renderer/src/components/LogLine.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/LogLine.tsx src/renderer/src/pages/sections/ConsoleSection.tsx
git commit -m "feat: restyle the console with level colours, filters and per-server command history"
```

---

### Task 6: Overview section

**Files:**

- Create: `src/renderer/src/hooks/useLogTail.ts`
- Create: `src/renderer/src/pages/sections/OverviewSection.tsx`
- Modify: `src/renderer/src/pages/ServerPage.tsx` (replace the Overview placeholder)

**Interfaces:**

- Consumes: `LogLine` (Task 5); `parseLogLevel` (Task 2); `formatUptime`, `serverAddress` (Task 2); `Card`, `Avatar`, `Button`, `TextLink` (Task 3); `useCopy` (Task 4); `Section` (Task 2).
- Produces: `useLogTail(serverId: string, max: number): string[]`; `OverviewSection({ server, online, runningSince, onSection })`.

- [ ] **Step 1: Write `src/renderer/src/hooks/useLogTail.ts`**

```ts
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/** The last `max` console lines of a server, kept up to date. */
export function useLogTail(serverId: string, max: number): string[] {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    let alive = true
    setLines([])
    const off = api.on('server:log', (event) => {
      if (!ready || event.serverId !== serverId) return
      setLines((prev) => prev.concat(event.lines).slice(-max))
    })
    api
      .getLog(serverId)
      .then((log) => {
        if (alive) setLines(log.slice(-max))
      })
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return () => {
      alive = false
      off()
    }
  }, [serverId, max])

  return lines
}
```

- [ ] **Step 2: Write `src/renderer/src/pages/sections/OverviewSection.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import {
  CONTENT_LABELS,
  type InstalledContentList,
  type ServerView
} from '../../../../shared/types'
import { CopyIcon } from '../../components/icons'
import { LogLine } from '../../components/LogLine'
import { Avatar, Button, Card, TextLink } from '../../components/ui'
import { useCopy } from '../../hooks/useCopy'
import { useLogTail } from '../../hooks/useLogTail'
import { api } from '../../lib/api'
import { formatUptime, serverAddress, STATUS_LABEL } from '../../lib/format'
import { parseLogLevel } from '../../lib/logLevel'
import type { Section } from '../../lib/routes'

const PREVIEW_LINES = 12
const MAX_AVATARS = 8

interface Props {
  server: ServerView
  online: string[]
  runningSince?: number
  onSection: (section: Section) => void
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-text">{children}</dd>
    </div>
  )
}

export function OverviewSection({ server, online, runningSince, onSection }: Props) {
  const tail = useLogTail(server.id, PREVIEW_LINES)
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null)
  const [content, setContent] = useState<InstalledContentList | null>(null)
  const [contentFailed, setContentFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { copied, copy } = useCopy()
  const contentLabel = CONTENT_LABELS[server.type]
  const address = serverAddress(server)
  const running = server.status === 'running'

  useEffect(() => {
    let alive = true
    api
      .readProperties(server.id)
      .then((entries) => {
        const raw = entries.find((e) => e.key === 'max-players')?.value
        const n = raw === undefined ? Number.NaN : Number(raw)
        if (alive) setMaxPlayers(Number.isInteger(n) ? n : null)
      })
      .catch(() => {
        if (alive) setMaxPlayers(null)
      })
    return () => {
      alive = false
    }
  }, [server.id])

  useEffect(() => {
    if (!contentLabel) return
    let alive = true
    setContent(null)
    setContentFailed(false)
    api
      .contentInstalled(server.id)
      .then((list) => {
        if (alive) setContent(list)
      })
      .catch(() => {
        if (alive) setContentFailed(true)
      })
    return () => {
      alive = false
    }
  }, [server.id, contentLabel])

  useEffect(() => {
    if (!running || runningSince === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, runningSince])

  const uptime = running && runningSince !== undefined ? formatUptime(now - runningSince) : '—'
  const updates = content?.items.filter((i) => i.update).length ?? 0

  return (
    <div className="grid gap-4 min-[1000px]:grid-cols-2">
      <Card title="Status">
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="State">{STATUS_LABEL[server.status]}</Stat>
          <Stat label="Uptime">{uptime}</Stat>
          <Stat label="Port">{server.port}</Stat>
          <Stat label="Sharing">{server.tunnel?.enabled ? 'Shared via playit' : 'Not shared'}</Stat>
        </dl>
      </Card>

      <Card
        title="Players"
        description={
          maxPlayers === null
            ? `${online.length} online`
            : `${online.length} / ${maxPlayers} online`
        }
        actions={<TextLink onClick={() => onSection('players')}>Manage players →</TextLink>}
      >
        {online.length === 0 ? (
          <p className="text-sm text-faint">No one online</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {online.slice(0, MAX_AVATARS).map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-btn border border-border-soft bg-sidebar py-1 pl-1 pr-3"
              >
                <Avatar name={name} size={24} />
                <span className="text-sm text-text-2">{name}</span>
              </li>
            ))}
            {online.length > MAX_AVATARS && (
              <li className="self-center text-sm text-faint">
                +{online.length - MAX_AVATARS} more
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card
        title="Console"
        className="min-[1000px]:col-span-2"
        actions={<TextLink onClick={() => onSection('console')}>Open console →</TextLink>}
      >
        <div className="rounded-btn border border-border-soft bg-console p-3 font-mono text-xs leading-5">
          {tail.length === 0 ? (
            <div className="text-faint">Server hasn&apos;t run yet</div>
          ) : (
            tail.map((text, i) => <LogLine key={i} text={text} {...parseLogLevel(text)} />)
          )}
        </div>
      </Card>

      {contentLabel && (
        <Card
          title={contentLabel}
          actions={
            <TextLink onClick={() => onSection('content')}>
              Manage {contentLabel.toLowerCase()} →
            </TextLink>
          }
        >
          {contentFailed ? (
            <p className="text-sm text-faint">
              Couldn&apos;t read the {contentLabel.toLowerCase()} folder.
            </p>
          ) : content === null ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Installed">{content.items.length}</Stat>
              {!content.offline && <Stat label="Updates">{updates}</Stat>}
            </dl>
          )}
        </Card>
      )}

      <Card
        title="Connect"
        className={contentLabel ? '' : 'min-[1000px]:col-span-2'}
        actions={<TextLink onClick={() => onSection('connect')}>Connect settings →</TextLink>}
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-btn border border-border-soft bg-sidebar px-3 py-2 font-mono text-sm text-text">
            {address}
          </code>
          <Button onClick={() => copy(address)}>
            <CopyIcon className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `src/renderer/src/pages/ServerPage.tsx`**

Add `import { OverviewSection } from './sections/OverviewSection'` and replace the placeholder line `{section === 'overview' && (<p …>Overview is coming in the next task.</p>)}` with:

```tsx
{
  section === 'overview' && (
    <OverviewSection
      server={server}
      online={online}
      runningSince={runningSince}
      onSection={onSection}
    />
  )
}
```

Then change the destructuring at the top of `ServerPage` to
`const { server, section, online, runningSince, onSection, onChanged, onDeleted } = props`
and delete the comment above it.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `git grep -n "coming in the next task" -- src`
Expected: no output.
Run: `grep -nE "(zinc|emerald|red|amber|sky)-[0-9]" src/renderer/src/pages/sections/OverviewSection.tsx src/renderer/src/hooks/useLogTail.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useLogTail.ts src/renderer/src/pages/sections/OverviewSection.tsx src/renderer/src/pages/ServerPage.tsx
git commit -m "feat: add the server Overview with status, players, console, content and connect cards"
```

---

### Task 7: Players section restyle

**Files:**

- Modify: `src/renderer/src/pages/sections/PlayersSection.tsx`

**Interfaces:**

- Consumes: `Card`, `Table`, `Th`, `Td`, `trClass`, `Segmented`, `Switch`, `Avatar`, `Badge`, `Button`, `inputClass`, `ErrorText`, `Notice` (Task 3).
- Produces: nothing new; `PlayersSection({ server })` keeps its signature.

- [ ] **Step 1: Restyle**

Rules (state, effects, `api.*` calls, validation, confirmations and strings unchanged):

1. The local section wrapper component (currently a `<section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">` with an `<h3>` title) becomes a thin wrapper around `Card`, passing its title (and any description/actions it already has) through.
2. Every list of players or bans (online, operators, whitelist, banned players, banned IPs) renders as `Table` with `Th` headers and `Td` cells, one `<tr className={trClass}>` per entry; the first column of player rows shows `<Avatar name={name} size={24} />` next to the name. Row action buttons use `<Button size="sm">` (`variant="danger"` for Kick/Ban/Remove/Pardon, secondary otherwise). Empty lists keep their existing empty text, rendered as `<p className="text-sm text-faint">`.
3. The existing `banView` two-button switch (players / IPs) becomes `<Segmented label="Ban list" options={[{ value: 'players', label: <existing label> }, { value: 'ips', label: <existing label> }]} value={banView} onChange={setBanView} />`.
4. The whitelist on/off control: if it is an `<input type="checkbox">`, replace it with `<Switch checked={…} onChange={…} disabled={…} label="<existing label text>" />` keeping the same handler and disabled condition; keep the visible label text next to it.
5. Inputs use `inputClass`; inline hints use `text-faint` or `text-danger` for invalid input; notices (e.g. the "paused while starting/stopping" note) use `<Notice tone="warn">`, success notes `<Notice tone="ok">`.
6. Lay the cards out with `className="space-y-4"` on the root; Online and Operators may sit in `grid gap-4 min-[1000px]:grid-cols-2`.
7. Apply the class mapping table from Global Constraints to anything left.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow)-[0-9]" src/renderer/src/pages/sections/PlayersSection.tsx`
Expected: no output.
Run: `git diff --stat HEAD -- src/main src/shared src/preload`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/sections/PlayersSection.tsx
git commit -m "style: restyle the Players section"
```

---

### Task 8: Mods / Plugins section restyle

**Files:**

- Modify: `src/renderer/src/pages/sections/ContentSection.tsx`

**Interfaces:**

- Consumes: `Card`, `Table`, `Th`, `Td`, `trClass`, `Badge`, `Button`, `inputClass`, `ErrorText`, `Notice` (Task 3).
- Produces: nothing new; `ContentSection({ server })` keeps its signature.

- [ ] **Step 1: Restyle**

Rules (state, effects, debounce, `api.*` calls, confirmations and strings unchanged):

1. The local section wrapper becomes a thin wrapper around `Card` (title passed through).
2. **Installed** renders as a `Table` (columns: Name, Version, Source, actions). Version in `font-mono`. Source uses `<Badge tone="accent">from Modrinth</Badge>` / `<Badge>added manually</Badge>` with the existing strings. An available update shows `<Badge tone="warn" mono>→ {versionNumber}</Badge>` next to the version. Update uses `<Button size="sm" variant="primary">`, Remove `<Button size="sm" variant="danger">`; disabled rules unchanged. The "Stop the server to update or remove." note uses `text-faint`.
3. **Browse**: the search input uses `inputClass`; each result is a row inside a `divide-y divide-border-soft` list: icon `h-10 w-10 rounded-btn bg-panel-2` (keep the existing `<img>` and its fallback), title `text-text font-medium`, description `text-[13px] text-muted line-clamp-2`, download count `font-mono text-xs text-faint`; Install `<Button size="sm" variant="primary">`, "Installed" `<Badge tone="accent">`. Load more is `<Button className="w-full">`.
4. The install note and "Restart the server to apply changes." banner use `<Notice tone="ok">` and `<Notice tone="warn">`; "Can't reach Modrinth" with Retry uses `<Notice tone="warn">` with a `<Button size="sm">Retry</Button>` inside.
5. Apply the class mapping table to anything left.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow)-[0-9]" src/renderer/src/pages/sections/ContentSection.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/sections/ContentSection.tsx
git commit -m "style: restyle the Mods and Plugins section"
```

---

### Task 9: Properties section restyle

**Files:**

- Modify: `src/renderer/src/pages/sections/PropertiesSection.tsx`

**Interfaces:**

- Consumes: `Card`, `Switch`, `Button`, `inputClass`, `ErrorText`, `Notice` (Task 3).
- Produces: nothing new; `PropertiesSection({ server, onChanged })` keeps its signature.

- [ ] **Step 1: Restyle**

Rules (state, parsing, save logic and strings unchanged):

1. Wrap each existing group of properties in a `Card` (use the group's existing heading as `title`); if the file has one flat form plus an "all properties" table, use two Cards: the curated form and the full table.
2. Each property row: label `text-sm text-text` with the key in `font-mono text-xs text-faint` beneath it on the left; the control on the right (`flex items-center justify-between gap-4 py-3`, rows separated by `divide-y divide-border-soft`).
3. Boolean properties: replace `<input type="checkbox">` with `<Switch checked={value === 'true'} onChange={(v) => onChange(v ? 'true' : 'false')} disabled={…} label={<the row's label string>} />`, keeping the same change handler semantics the checkbox had.
4. `<select>` and text/number inputs use `inputClass` (selects add `pr-8`); numeric inputs add `font-mono`.
5. The raw table (`<table className="mt-3 w-full text-sm">`) becomes `Table`/`Th`/`Td`/`trClass`; key cells `font-mono text-text-2`.
6. Save/Reset buttons sit in a footer row `flex justify-end gap-2`; Save is `variant="primary"`. Saved and restart notes use `<Notice tone="ok">` / `<Notice tone="warn">`.
7. Apply the class mapping table to anything left.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow)-[0-9]|type=\"checkbox\"" src/renderer/src/pages/sections/PropertiesSection.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/sections/PropertiesSection.tsx
git commit -m "style: restyle the Properties section with switches for true/false settings"
```

---

### Task 10: Connect section restyle

**Files:**

- Modify: `src/renderer/src/pages/sections/ConnectSection.tsx`

**Interfaces:**

- Consumes: `Card`, `Switch`, `Badge`, `Button`, `ErrorText`, `Notice` (Task 3); `CopyIcon` (Task 3).
- Produces: nothing new; `ConnectSection({ server, onChanged })` keeps its signature.

- [ ] **Step 1: Restyle**

Rules (state, effects, tunnel calls, copy logic and strings unchanged):

1. The three address groups ("On this PC", "Same Wi-Fi or home network", "Over the internet") each become a `Card` with that heading as `title`. Addresses render in `<code className="font-mono text-sm text-text rounded-btn border border-border-soft bg-sidebar px-3 py-2">` with the existing copy button beside them as `<Button size="sm"><CopyIcon className="h-3.5 w-3.5" />…existing label…</Button>`.
2. The playit card ("Share over the internet (playit.gg)") becomes a `Card` with that title. The sharing `<input type="checkbox">` becomes `<Switch checked={…} onChange={…} disabled={…} label="Share over the internet" />` with the same handler and disabled condition; keep its visible label text.
3. Tunnel state shows as a `Badge`: online → `tone="accent"`, connecting/downloading → `tone="warn"`, error/needs-setup → `tone="danger"`, off → neutral, with the existing state strings. A download percentage shows as a thin bar: `<div className="h-1.5 rounded-full bg-panel-2"><div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} /></div>`.
4. Link / Unlink / Cancel / Retry / "Open playit.gg" buttons keep their handlers; Link is `variant="primary"`, Unlink `variant="danger"`, others secondary or ghost as today.
5. Apply the class mapping table to anything left.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow)-[0-9]|type=\"checkbox\"" src/renderer/src/pages/sections/ConnectSection.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/sections/ConnectSection.tsx
git commit -m "style: restyle the Connect section"
```

---

### Task 11: Settings section restyle

**Files:**

- Modify: `src/renderer/src/pages/sections/SettingsSection.tsx`

**Interfaces:**

- Consumes: `Card`, `Field`, `Button`, `inputClass`, `ErrorText`, `Notice` (Task 3).
- Produces: nothing new; `SettingsSection({ server, onChanged, onDeleted })` keeps its signature.

- [ ] **Step 1: Restyle**

Rules (state, validation, save/delete logic and strings unchanged):

1. Group the fields into Cards: **General** (name, port), **Memory & Java** (RAM slider/input, Java path with its pick/reset buttons, JVM args), with the existing labels. Inputs use `inputClass`; port, RAM and JVM args add `font-mono`; the RAM range input uses `accent-accent w-full`.
2. Save sits in a footer `flex justify-end` as `variant="primary"`. Saved notice → `<Notice tone="ok">`, warning → `<Notice tone="warn">`, error → `ErrorText`.
3. The "Delete server" `<section className="… border-red-900/60 …">` becomes `<section className="rounded-card border border-bad-border bg-bad-bg/40 p-5 space-y-3">` with heading `text-[15px] font-semibold text-danger`. Its keep-files `<input type="checkbox">` stays a checkbox (it is a one-off confirmation option) with `className="accent-accent"`. The delete button is `variant="danger"`.
4. "Open server folder" (if present) is a secondary button in the General card's `actions`.
5. Apply the class mapping table to anything left.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -nE "(zinc|emerald|red|amber|sky|green|blue|yellow)-[0-9]" src/renderer/src/pages/sections/SettingsSection.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/sections/SettingsSection.tsx
git commit -m "style: restyle the Settings section"
```

---

### Task 12: All servers, New server wizard and install panel

**Files:**

- Modify (rewrite): `src/renderer/src/pages/ServerList.tsx`
- Modify: `src/renderer/src/pages/NewServerWizard.tsx`
- Modify: `src/renderer/src/components/InstallPanel.tsx`

**Interfaces:**

- Consumes: `useOnlinePlayers` (Task 4); kit and `Logo`, `PlusIcon` (Task 3); `TYPE_BLURB`, `formatRam` (`lib/format`).
- Produces: `ServerList({ servers, loaded, onOpen, onNew })` (same signature).

- [ ] **Step 1: Rewrite `src/renderer/src/pages/ServerList.tsx`**

```tsx
import { useState } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { Logo, PlusIcon } from '../components/icons'
import { Badge, Button, ErrorText, pageClass, StatusPill } from '../components/ui'
import { useOnlinePlayers } from '../hooks/useOnlinePlayers'
import { api, errorMessage } from '../lib/api'
import { formatRam } from '../lib/format'

interface Props {
  servers: ServerView[]
  loaded: boolean
  onOpen: (id: string) => void
  onNew: () => void
}

const isUp = (s: ServerView): boolean => s.status === 'running' || s.status === 'starting'

function ServerCard({
  server,
  busy,
  onOpen,
  onToggle
}: {
  server: ServerView
  busy: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const online = useOnlinePlayers(server.id, server.status)
  const ready = server.installState === 'ready'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className="cursor-pointer space-y-4 rounded-card border border-border bg-panel p-5 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{server.name}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted">
            {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
          </p>
        </div>
        {ready ? (
          <StatusPill status={server.status} />
        ) : (
          <Badge tone={server.installState === 'failed' ? 'danger' : 'warn'}>
            {server.installState === 'installing' ? 'Installing…' : 'Install failed'}
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-faint">
          :{server.port} · {formatRam(server.ramMb)}
          {server.status === 'running' && ` · ${online.length} online`}
        </p>
        {ready && (
          <Button
            size="sm"
            variant={isUp(server) ? 'danger' : 'primary'}
            disabled={busy || server.status === 'stopping'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {isUp(server) ? 'Stop' : 'Start'}
          </Button>
        )}
      </div>
    </div>
  )
}

export function ServerList({ servers, loaded, onOpen, onNew }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(server: ServerView) {
    setBusyId(server.id)
    setError(null)
    try {
      if (isUp(server)) await api.stop(server.id)
      else await api.start(server.id)
    } catch (err) {
      setError(`${server.name}: ${errorMessage(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={`${pageClass} space-y-6`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Servers</h1>
          <p className="mt-1 text-sm text-muted">
            Every Minecraft server Blockhost runs on this PC.
          </p>
        </div>
        <Button variant="primary" onClick={onNew}>
          <PlusIcon className="h-4 w-4" />
          New server
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loaded && servers.length === 0 && (
        <div className="mx-auto max-w-md space-y-4 rounded-card border border-border bg-panel p-10 text-center">
          <Logo className="mx-auto h-10 w-10" />
          <p className="text-sm text-muted">No servers yet. Create one in a few clicks.</p>
          <Button variant="primary" onClick={onNew}>
            Create your first server
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            busy={busyId === server.id}
            onOpen={() => onOpen(server.id)}
            onToggle={() => void toggle(server)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Restyle `src/renderer/src/pages/NewServerWizard.tsx`**

Rules (state, steps, API calls, validation and strings unchanged):

1. The root becomes `<div className="mx-auto w-full max-w-[720px] space-y-6 px-8 py-7">` with the existing "New server" heading as `text-[26px] font-bold tracking-tight` and Cancel as a ghost button on its right.
2. Above the step content add a step indicator for the existing three steps: an `<ol className="flex items-center gap-2 text-[13px]">` with items "1 Type & version", "2 Settings", "3 Install"; the current step's number sits in an `h-6 w-6 rounded-full bg-accent text-accent-ink font-mono text-xs` circle and its label `text-text`; completed steps `bg-ok-bg text-ok-text` circles; later steps `bg-panel-2 text-faint` circles and `text-faint` labels; items joined by `h-px w-8 bg-border-strong` lines.
3. Each step's content goes in one `Card`.
4. Step 1: replace the server-type picker (whatever control it is today — a `<select>` or buttons) with a tile grid `grid gap-3 sm:grid-cols-2 lg:grid-cols-3` of `<button type="button" aria-pressed={type === t}>` tiles calling the same setter the picker called. Tile: `rounded-btn border p-3 text-left`, selected `border-accent bg-ok-bg/40`, otherwise `border-border-strong bg-sidebar hover:border-muted`; content: `SERVER_TYPE_LABELS[t]` in `text-sm font-semibold text-text` and `TYPE_BLURB[t]` in `text-xs text-muted`. Keep the tile order the picker used. Version and build `<select>`s use `inputClass`.
5. Checkboxes (e.g. EULA, snapshots) stay checkboxes with `className="accent-accent"`; RAM range `accent-accent`; port input `font-mono`; port-in-use hint `text-danger`, free hint `text-ok-text`.
6. Back/Next/Create buttons in a footer `flex justify-between`; the forward button is `variant="primary"`.
7. Apply the class mapping table to anything left.

- [ ] **Step 3: Restyle `src/renderer/src/components/InstallPanel.tsx`**

Rules (events and logic unchanged): wrap it in a `Card` titled with its existing heading; the step list shows each step as a row with a status circle (done `bg-ok-bg text-ok-text` ✓, current `bg-warn-bg text-warn` with `animate-pulse`, pending `bg-panel-2 text-faint`, error `bg-bad-bg text-danger`); the percentage bar uses `h-1.5 rounded-full bg-panel-2` with an inner `bg-accent` fill; the log box uses `rounded-btn border border-border-soft bg-console p-3 font-mono text-xs leading-5 text-text-2`. Apply the class mapping table to anything left.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.
Run: `grep -rnE "(zinc|emerald|red|amber|sky|green|blue|yellow|gray|slate|neutral)-[0-9]" src/renderer/src`
Expected: no output (this is the last screen task; the whole renderer must now be on tokens).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/ServerList.tsx src/renderer/src/pages/NewServerWizard.tsx src/renderer/src/components/InstallPanel.tsx
git commit -m "style: restyle All servers, the New server wizard and the install panel"
```

---

### Task 13: Smoke checklist

**Files:**

- Modify: `docs/smoke-test.md`

- [ ] **Step 1: Add the restyle items**

Insert these lines before the final "Uninstall via Windows Settings…" item:

```markdown
- [ ] Restyle: Overview, Console, Players, Properties, Connect and Settings render for a Vanilla, a Paper and a Fabric server; Mods shows for Fabric, Plugins for Paper, neither for Vanilla
- [ ] Restyle: the sidebar switcher lists every server, switches to another server, and "+ New server" / "All servers" work; going back to a server reopens the section it was on
- [ ] Restyle: the Players badge in the sidebar shows the online count while someone is connected
- [ ] Restyle: Console filters (All / Warnings / Chat) work, ↑/↓ recall earlier commands, and "Jump to latest" appears after scrolling up
- [ ] Restyle: Overview uptime counts up after starting a server; the address copy button copies the playit address when shared and `localhost:<port>` otherwise
- [ ] Restyle: with the network disconnected, the Geist and JetBrains Mono fonts still render (no fallback fonts)
- [ ] Restyle: at the 860px minimum width the layout has no horizontal scroll and the sidebar is an icon rail; at 1000px and wider it shows labels
- [ ] Restyle: Force kill appears in the "⋯" menu only after the server has been stopping for 30 seconds
```

- [ ] **Step 2: Verify and commit**

Run: `npm test && npm run build`
Expected: all pass.

```bash
git add docs/smoke-test.md
git commit -m "docs: add restyle items to the smoke checklist"
```
