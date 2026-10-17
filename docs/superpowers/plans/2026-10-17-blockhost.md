# Blockhost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Blockhost, a Windows Electron app that creates, runs and manages Minecraft Java servers (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge) with automatic Java, a live console and a properties editor.

**Architecture:** All side effects (HTTP, downloads, Java management, child processes, file system) live in the Electron main process as small, independently tested modules composed in `src/main/services.ts`. A sandboxed preload exposes one generic, allow-listed `invoke`/`on` bridge; the React renderer wraps it in a typed client. Every IPC input is validated with zod, and every result crosses as `Result<T>` (`{ ok, data } | { ok: false, error: { code, message, details } }`).

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, React 19, TypeScript, Tailwind CSS 4, zod 4, extract-zip, Vitest, electron-builder (NSIS).

**Spec:** `docs/superpowers/specs/2026-10-17-minecraft-server-manager-design.md`

## Global Constraints

- Target: Windows 10/11 x64. The code stays portable, but only Windows is built or tested.
- Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer reaches main only through `window.blockhost` (`invoke` on the channels in `INVOKE_CHANNELS`, `on` for the channels in `EVENT_CHANNELS`).
- Every IPC handler validates its arguments with zod. Errors cross as `ApiError { code, message, details? }`. Main code throws `AppError(code, message, details?)`.
- A custom Java path is accepted only if it came from the main-process file picker in this session (or is unchanged).
- Data dir: `%APPDATA%/Blockhost/` (`servers.json`, `java/temurin-<major>/`, `cache/`). Default server folder: `Documents/MinecraftServers/<name>`.
- Java: Eclipse Temurin JRE (windows, x64, hotspot) from the Adoptium API. Managed majors: 8, 17, 21, 25.
- EULA: the user must tick an explicit checkbox linking to `https://aka.ms/MinecraftEULA`, and `eula.txt` is written only after that.
- Limits: log ring buffer 5,000 lines per server; log batching 50 ms; graceful stop timeout 30 s (Force kill offered after that); API cache TTL 1 h; download retries 3 with exponential backoff.
- Spawn command: `<java> -Xms<ram/2>M -Xmx<ram>M -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 <jvmArgs> <launch.args> nogui`, cwd = server dir, `windowsHide: true`.
- App id `com.blockhost.app`, product name `Blockhost`.
- Code style: Prettier from the scaffold (single quotes, no semicolons, printWidth 100, no trailing commas). Do **not** use TypeScript constructor parameter properties; declare fields explicitly. Use `import type` for type-only imports (`isolatedModules` is on). tsconfig has `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns`, so prefix intentionally unused parameters with `_`.
- Tests live next to the code as `*.test.ts`. Integration tests are `*.integration.test.ts` and run only via `npm run test:integration`.

## File Map

```
electron.vite.config.ts, vitest.config.ts, vitest.integration.config.ts, electron-builder.yml
src/shared/types.ts            domain types + SERVER_TYPES/labels (pure, used by main+renderer)
src/shared/api.ts              IPC channel lists, event payload map, Bridge interface
src/main/errors.ts             AppError, toApiError
src/main/test-utils.ts         tempDir, fakeHttp, fakeDownload, fakeProviderDeps, installOpts
src/main/util/mcVersion.ts     parse/compare Minecraft versions
src/main/util/lines.ts         LineSplitter
src/main/util/batcher.ts       Batcher<T>
src/main/util/ansi.ts          stripAnsi
src/main/util/fs.ts            writeFileAtomic, pathExists, isEmptyOrMissingDir
src/main/cache.ts              JsonCache (disk, TTL)
src/main/net/http.ts           HttpClient (JSON w/ cache + offline fallback, text)
src/main/net/download.ts       downloadFile (stream, hash, retries, .part)
src/main/net/port.ts           isPortFree
src/main/net/ip.ts             lanIps, publicIp
src/main/java/requirements.ts  JAVA_MAJORS, normalizeJavaMajor, fallbackJavaMajor
src/main/java/detect.ts        parseJavaVersionOutput, probeJava
src/main/java/run.ts           runJava (spawn + line streaming)
src/main/java/manager.ts       JavaManager (Temurin download/extract)
src/main/java/resolver.ts      JavaResolver (which Java for install/start)
src/main/providers/types.ts    ServerProvider, ProviderDeps, ProviderInstallOptions
src/main/providers/vanilla.ts | paper.ts | purpur.ts | fabric.ts
src/main/providers/modloader.ts parseRunBat, resolveLaunchSpec, runModLoaderInstaller
src/main/providers/forge.ts | neoforge.ts
src/main/providers/index.ts    createProviders
src/main/servers/properties.ts server.properties parse/serialize/read/write/update
src/main/servers/store.ts      ServerStore (servers.json)
src/main/servers/installer.ts  ServerInstaller
src/main/servers/process.ts    ProcessManager, buildJavaArgs
src/main/servers/service.ts    ServerService (operations used by IPC)
src/main/schemas.ts            zod schemas for IPC
src/main/services.ts           composition root
src/main/ipc.ts                IPC handler registration
src/main/index.ts              app lifecycle, window, quit handling
src/preload/index.ts           bridge
src/renderer/src/lib/api.ts | lib/format.ts
src/renderer/src/components/ui.tsx | components/InstallPanel.tsx
src/renderer/src/hooks/useServers.ts
src/renderer/src/pages/ServerList.tsx | NewServerWizard.tsx | ServerDetail.tsx
src/renderer/src/pages/tabs/ConsoleTab.tsx | PropertiesTab.tsx | SettingsTab.tsx | ConnectTab.tsx
src/renderer/src/App.tsx
```

---

### Task 1: Scaffold the Electron + React + Tailwind + Vitest project

**Files:**
- Create (from template): `package.json`, `package-lock.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`, `.editorconfig`, `.prettierrc.yaml`, `.prettierignore`, `build/icon.ico`, `build/icon.png`, `resources/icon.png`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/env.d.ts`
- Create: `vitest.config.ts`
- Overwrite: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**
- Produces: `npm run dev`, `npm run typecheck`, `npm run build`, `npm test`, `npm run build:win`. Every later task relies on these scripts.

- [ ] **Step 1: Generate the official electron-vite React/TS template and copy it into the repo root**

Run in Git Bash from the repo root:
```bash
TMPL="$(mktemp -d)"
(cd "$TMPL" && npm create @quick-start/electron@latest app -- --template react-ts --skip)
cp -r "$TMPL/app/." .
rm -rf "$TMPL"
rm -rf README.md .vscode eslint.config.mjs build/entitlements.mac.plist build/icon.icns \
  src/renderer/src/components src/renderer/src/assets/electron.svg \
  src/renderer/src/assets/wavy-lines.svg src/renderer/src/assets/base.css src/preload/index.d.ts
```
Expected: `package.json`, `electron.vite.config.ts` and `src/` exist in the repo root.

- [ ] **Step 2: Install dependencies and adjust package.json**

```bash
npm install
npm uninstall eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-refresh \
  @electron-toolkit/eslint-config-prettier @electron-toolkit/eslint-config-ts @electron-toolkit/preload
npm install zod extract-zip
npm install -D tailwindcss @tailwindcss/vite vitest
npm pkg set name=blockhost version=0.1.0 description="Easy Minecraft server manager for Windows" author=ToMeXaS
npm pkg delete scripts.lint "scripts.build:mac" "scripts.build:linux"
npm pkg set scripts.test="vitest run" "scripts.test:watch=vitest" "scripts.test:integration=vitest run --config vitest.integration.config.ts"
```
Expected: `package.json` lists `zod`, `extract-zip` and `@electron-toolkit/utils` in `dependencies`, and `vitest`, `tailwindcss`, `@tailwindcss/vite`, `electron`, `electron-vite` in `devDependencies`.

- [ ] **Step 3: Write the build/test configuration**

`electron.vite.config.ts`:
```ts
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**']
  }
})
```

`tsconfig.node.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": [
    "electron.vite.config.*",
    "vitest.config.ts",
    "vitest.integration.config.ts",
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node"]
  }
}
```

`tsconfig.web.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": [
    "src/renderer/src/env.d.ts",
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"]
    }
  }
}
```

`electron-builder.yml` (replace the whole file):
```yaml
appId: com.blockhost.app
productName: Blockhost
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!docs/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!vitest*.config.ts'
  - '!{.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}'
  - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
  - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
asarUnpack:
  - resources/**
win:
  executableName: Blockhost
  target: nsis
nsis:
  artifactName: Blockhost-${version}-setup.${ext}
  oneClick: true
  perMachine: false
  shortcutName: Blockhost
  uninstallDisplayName: Blockhost
  createDesktopShortcut: always
npmRebuild: false
```

- [ ] **Step 4: Replace the template app code with a minimal secure shell**

`src/main/index.ts`:
```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Blockhost',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.blockhost.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
})

app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
export {}
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/renderer/src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <h1 className="text-2xl font-semibold">Blockhost</h1>
    </div>
  )
}
```

`src/renderer/src/assets/main.css`:
```css
@import 'tailwindcss';

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: #09090b;
  color-scheme: dark;
}
```

In `src/renderer/index.html`, change `<title>Electron</title>` to `<title>Blockhost</title>` and leave the CSP meta tag as it is.

- [ ] **Step 5: Verify the toolchain**

Run: `npm run typecheck && npx electron-vite build && npx vitest run --passWithNoTests`
Expected: typecheck passes, the build writes `out/main/index.js`, `out/preload/index.js` and `out/renderer/index.html`, and vitest reports "No test files found" with exit 0.

Run: `npm run dev`
Expected: a dark window titled "Blockhost" shows the centered heading "Blockhost". Close it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + React + Tailwind + Vitest project"
```

---

### Task 2: Shared types, AppError, Minecraft version utils, Java requirements

**Files:**
- Create: `src/shared/types.ts`, `src/main/errors.ts`, `src/main/util/mcVersion.ts`, `src/main/java/requirements.ts`
- Test: `src/main/errors.test.ts`, `src/main/util/mcVersion.test.ts`, `src/main/java/requirements.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `src/shared/types.ts`: all of the types below, plus `SERVER_TYPES`, `SERVER_TYPE_LABELS`, `TYPES_WITH_BUILDS`
  - `AppError(code: string, message: string, details?: Record<string, unknown>)` with readonly `code` and `details`; `toApiError(err: unknown): ApiError`
  - `parseMcVersion(v: string): number[] | null`, `compareMcVersions(a: string, b: string): number`
  - `JAVA_MAJORS: readonly [8, 17, 21, 25]`, `normalizeJavaMajor(major: number): number`, `fallbackJavaMajor(mcVersion: string): number`

- [ ] **Step 1: Write the shared types (pure declarations, no runtime logic to test)**

`src/shared/types.ts`:
```ts
export const SERVER_TYPES = ['vanilla', 'paper', 'purpur', 'fabric', 'forge', 'neoforge'] as const
export type ServerType = (typeof SERVER_TYPES)[number]

export const SERVER_TYPE_LABELS: Record<ServerType, string> = {
  vanilla: 'Vanilla',
  paper: 'Paper',
  purpur: 'Purpur',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** Server types whose provider offers a build picker. */
export const TYPES_WITH_BUILDS: readonly ServerType[] = ['paper', 'purpur']

export interface VersionInfo {
  id: string
  stable: boolean
}

/** Arguments placed after the JVM memory/extra args and before `nogui`. */
export interface LaunchSpec {
  args: string[]
}

export type InstallState = 'installing' | 'ready' | 'failed'
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export interface ServerRecord {
  id: string
  name: string
  type: ServerType
  mcVersion: string
  build?: string
  dir: string
  ramMb: number
  port: number
  javaPath?: string
  jvmArgs: string[]
  launch?: LaunchSpec
  installState: InstallState
  createdAt: string
}

export interface ServerView extends ServerRecord {
  status: ServerStatus
}

export interface CreateServerInput {
  name: string
  type: ServerType
  mcVersion: string
  build?: string
  dir: string
  ramMb: number
  port: number
  eulaAccepted: boolean
}

export interface ServerPatch {
  name?: string
  ramMb?: number
  port?: number
  /** `null` switches back to the automatically managed Java. */
  javaPath?: string | null
  jvmArgs?: string[]
}

export interface UpdateResult {
  server: ServerView
  warning?: string
}

export type InstallStep = 'java' | 'server' | 'installer' | 'config' | 'done' | 'error'

export interface InstallProgress {
  serverId: string
  step: InstallStep
  message: string
  percent?: number
}

export interface ServerStatusEvent {
  serverId: string
  status: ServerStatus
}

export interface ServerLogEvent {
  serverId: string
  lines: string[]
}

export interface PropertyEntry {
  key: string
  value: string
}

export interface SystemInfo {
  totalRamMb: number
  defaultServersDir: string
}

export interface NetInfo {
  lanIps: string[]
  publicIp: string | null
  port: number
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError }
```

- [ ] **Step 2: Write the failing tests**

`src/main/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, toApiError } from './errors'

describe('toApiError', () => {
  it('converts AppError with details', () => {
    expect(toApiError(new AppError('PORT_IN_USE', 'Port busy', { port: 25565 }))).toEqual({
      code: 'PORT_IN_USE',
      message: 'Port busy',
      details: { port: 25565 }
    })
  })

  it('converts ZodError into INVALID_INPUT naming the field', () => {
    const result = z.object({ port: z.number() }).safeParse({ port: 'x' })
    const apiError = toApiError(result.error)
    expect(apiError.code).toBe('INVALID_INPUT')
    expect(apiError.message).toContain('port')
  })

  it('converts unknown errors into INTERNAL', () => {
    expect(toApiError(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' })
    expect(toApiError('weird')).toEqual({ code: 'INTERNAL', message: 'weird' })
  })
})
```

`src/main/util/mcVersion.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { compareMcVersions, parseMcVersion } from './mcVersion'

describe('parseMcVersion', () => {
  it('parses legacy and new-style versions', () => {
    expect(parseMcVersion('1.21.4')).toEqual([1, 21, 4])
    expect(parseMcVersion('26.1.2')).toEqual([26, 1, 2])
    expect(parseMcVersion('26.4-snapshot-4')).toEqual([26, 4])
  })

  it('returns null for non-numeric versions', () => {
    expect(parseMcVersion('craftmine')).toBeNull()
  })
})

describe('compareMcVersions', () => {
  it('orders versions numerically', () => {
    expect(compareMcVersions('1.21.10', '1.21.9')).toBeGreaterThan(0)
    expect(compareMcVersions('1.21', '1.21.0')).toBe(0)
    expect(compareMcVersions('26.1', '1.21.11')).toBeGreaterThan(0)
    expect(compareMcVersions('1.20.4', '1.20.5')).toBeLessThan(0)
  })

  it('sorts newest first', () => {
    const sorted = ['1.20.1', '26.3', '1.21.4', '26.1.2'].sort((a, b) => compareMcVersions(b, a))
    expect(sorted).toEqual(['26.3', '26.1.2', '1.21.4', '1.20.1'])
  })
})
```

`src/main/java/requirements.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fallbackJavaMajor, normalizeJavaMajor } from './requirements'

describe('normalizeJavaMajor', () => {
  it.each([
    [8, 8],
    [16, 17],
    [17, 17],
    [21, 21],
    [22, 25],
    [25, 25],
    [27, 27]
  ])('Java %i -> %i', (input, expected) => {
    expect(normalizeJavaMajor(input)).toBe(expected)
  })
})

describe('fallbackJavaMajor', () => {
  it.each([
    ['26.3', 25],
    ['26.1.2', 25],
    ['1.21.11', 21],
    ['1.20.5', 21],
    ['1.20.4', 17],
    ['1.17', 17],
    ['1.16.5', 8],
    ['1.12.2', 8],
    ['nonsense', 25]
  ])('Minecraft %s -> Java %i', (version, expected) => {
    expect(fallbackJavaMajor(version)).toBe(expected)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/errors.test.ts src/main/util/mcVersion.test.ts src/main/java/requirements.test.ts`
Expected: FAIL. All three files report "Failed to resolve import" for `./errors`, `./mcVersion` and `./requirements`.

- [ ] **Step 4: Implement**

`src/main/errors.ts`:
```ts
import { z } from 'zod'
import type { ApiError } from '../shared/types'

export class AppError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details }
  if (err instanceof z.ZodError) {
    const message = err.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ')
    return { code: 'INVALID_INPUT', message }
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }
}
```

`src/main/util/mcVersion.ts`:
```ts
/** Leading numeric part of a Minecraft version: "1.21.4" -> [1,21,4], "26.4-snapshot-4" -> [26,4]. */
export function parseMcVersion(version: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(version)
  return match ? match[1].split('.').map(Number) : null
}

/** Negative if a < b, positive if a > b, 0 if equal (missing parts count as 0). */
export function compareMcVersions(a: string, b: string): number {
  const pa = parseMcVersion(a) ?? []
  const pb = parseMcVersion(b) ?? []
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
```

`src/main/java/requirements.ts`:
```ts
import { compareMcVersions, parseMcVersion } from '../util/mcVersion'

/** Temurin LTS majors Blockhost installs. */
export const JAVA_MAJORS = [8, 17, 21, 25] as const

/** Maps a required Java major (e.g. Mojang's 16 for 1.17) to the LTS that satisfies it. */
export function normalizeJavaMajor(major: number): number {
  for (const lts of JAVA_MAJORS) if (major <= lts) return lts
  return major
}

/** Used when the Mojang version metadata is unavailable (offline or unknown version). */
export function fallbackJavaMajor(mcVersion: string): number {
  const parts = parseMcVersion(mcVersion)
  if (!parts || parts[0] !== 1) return 25
  if (compareMcVersions(mcVersion, '1.20.5') >= 0) return 21
  if (compareMcVersions(mcVersion, '1.17') >= 0) return 17
  return 8
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/errors.test.ts src/main/util/mcVersion.test.ts src/main/java/requirements.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add src/shared src/main
git commit -m "feat: add shared types, AppError, version compare and Java requirements"
```

---

### Task 3: Text stream utilities (line splitter, batcher, ANSI stripping)

**Files:**
- Create: `src/main/util/lines.ts`, `src/main/util/batcher.ts`, `src/main/util/ansi.ts`
- Test: `src/main/util/lines.test.ts`, `src/main/util/batcher.test.ts`, `src/main/util/ansi.test.ts`

**Interfaces:**
- Produces:
  - `class LineSplitter { constructor(onLine: (line: string) => void); push(chunk: string): void; flush(): void }`
  - `class Batcher<T> { constructor(ms: number, flush: (items: T[]) => void); push(item: T): void; flush(): void }`
  - `stripAnsi(text: string): string`

- [ ] **Step 1: Write the failing tests**

`src/main/util/lines.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LineSplitter } from './lines'

function collect(): { out: string[]; splitter: LineSplitter } {
  const out: string[] = []
  return { out, splitter: new LineSplitter((line) => out.push(line)) }
}

describe('LineSplitter', () => {
  it('emits complete lines across chunks', () => {
    const { out, splitter } = collect()
    splitter.push('hel')
    splitter.push('lo\nwor')
    splitter.push('ld\r\n')
    expect(out).toEqual(['hello', 'world'])
  })

  it('handles CRLF split across chunks', () => {
    const { out, splitter } = collect()
    splitter.push('a\r')
    splitter.push('\nb\n')
    expect(out).toEqual(['a', 'b'])
  })

  it('flushes a trailing partial line once', () => {
    const { out, splitter } = collect()
    splitter.push('tail')
    splitter.flush()
    splitter.flush()
    expect(out).toEqual(['tail'])
  })
})
```

`src/main/util/batcher.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Batcher } from './batcher'

describe('Batcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('groups items pushed within the window', () => {
    const batches: number[][] = []
    const batcher = new Batcher<number>(50, (items) => batches.push(items))
    batcher.push(1)
    batcher.push(2)
    expect(batches).toEqual([])
    vi.advanceTimersByTime(50)
    expect(batches).toEqual([[1, 2]])
    batcher.push(3)
    vi.advanceTimersByTime(50)
    expect(batches).toEqual([[1, 2], [3]])
  })

  it('flush() emits immediately and does nothing when empty', () => {
    const batches: number[][] = []
    const batcher = new Batcher<number>(50, (items) => batches.push(items))
    batcher.flush()
    batcher.push(7)
    batcher.flush()
    vi.advanceTimersByTime(100)
    expect(batches).toEqual([[7]])
  })
})
```

`src/main/util/ansi.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001b[33mWARN\u001b[0m done')).toBe('WARN done')
    expect(stripAnsi('\u001b[0;33;1mx\u001b[m')).toBe('x')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('[12:00:00 INFO]: Done (3.2s)!')).toBe('[12:00:00 INFO]: Done (3.2s)!')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/util`
Expected: FAIL for `lines`, `batcher` and `ansi` with "Failed to resolve import". The `mcVersion` tests still pass.

- [ ] **Step 3: Implement**

`src/main/util/lines.ts`:
```ts
/** Turns arbitrary text chunks into complete lines (LF or CRLF). */
export class LineSplitter {
  private buffer = ''
  private readonly onLine: (line: string) => void

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine
  }

  push(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    for (const part of parts) this.onLine(part.replace(/\r$/, ''))
  }

  flush(): void {
    if (!this.buffer) return
    const rest = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    this.onLine(rest)
  }
}
```

`src/main/util/batcher.ts`:
```ts
/** Collects items and delivers them in one call at most every `ms` milliseconds. */
export class Batcher<T> {
  private items: T[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly ms: number
  private readonly onFlush: (items: T[]) => void

  constructor(ms: number, onFlush: (items: T[]) => void) {
    this.ms = ms
    this.onFlush = onFlush
  }

  push(item: T): void {
    this.items.push(item)
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.ms)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.items.length === 0) return
    const items = this.items
    this.items = []
    this.onFlush(items)
  }
}
```

`src/main/util/ansi.ts`:
```ts
const ANSI_PATTERN = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/util`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/util
git commit -m "feat: add line splitter, batcher and ANSI stripping utilities"
```

---

### Task 4: File helpers, JSON cache and HTTP client

**Files:**
- Create: `src/main/util/fs.ts`, `src/main/cache.ts`, `src/main/net/http.ts`, `src/main/test-utils.ts`
- Test: `src/main/util/fs.test.ts`, `src/main/cache.test.ts`, `src/main/net/http.test.ts`

**Interfaces:**
- Consumes: `AppError` (Task 2)
- Produces:
  - `writeFileAtomic(file: string, data: string): Promise<void>`, `pathExists(path: string): Promise<boolean>`, `isEmptyOrMissingDir(path: string): Promise<boolean>`
  - `class JsonCache { constructor(dir: string, now?: () => number); getFresh(key: string, maxAgeMs: number): Promise<unknown | undefined>; getStale(key: string): Promise<unknown | undefined>; set(key: string, value: unknown): Promise<void> }`
  - `USER_AGENT: string`; `interface HttpClient { getJson<T>(url: string): Promise<T>; getText(url: string): Promise<string> }`; `createHttpClient(opts?: { cache?: JsonCache; ttlMs?: number; fetchImpl?: typeof fetch; onStale?: (url: string) => void }): HttpClient`
  - Error codes: `NETWORK` (request could not be made), `HTTP` (non-2xx)
  - test helpers: `tempDir(): Promise<string>`, `fakeHttp(routes: Record<string, unknown>): HttpClient & { requested: string[] }`

- [ ] **Step 1: Write the test helpers**

`src/main/test-utils.ts`:
```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from './errors'
import type { HttpClient } from './net/http'

export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'blockhost-test-'))
}

/** HttpClient that answers from a url -> value map and records requested URLs. */
export function fakeHttp(routes: Record<string, unknown>): HttpClient & { requested: string[] } {
  const requested: string[] = []
  const lookup = (url: string): unknown => {
    requested.push(url)
    if (!(url in routes)) throw new AppError('HTTP', `Unexpected URL in test: ${url}`)
    return routes[url]
  }
  return {
    requested,
    async getJson<T>(url: string): Promise<T> {
      return lookup(url) as T
    },
    async getText(url: string): Promise<string> {
      return String(lookup(url))
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/util/fs.test.ts`:
```ts
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { isEmptyOrMissingDir, pathExists, writeFileAtomic } from './fs'

describe('writeFileAtomic', () => {
  it('creates parent folders, replaces content and leaves no temp files', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a', 'b.json')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')
    expect(await readFile(file, 'utf8')).toBe('two')
    expect(await readdir(join(dir, 'a'))).toEqual(['b.json'])
  })
})

describe('pathExists / isEmptyOrMissingDir', () => {
  it('reports existence and emptiness', async () => {
    const dir = await tempDir()
    expect(await pathExists(dir)).toBe(true)
    expect(await pathExists(join(dir, 'nope'))).toBe(false)
    expect(await isEmptyOrMissingDir(join(dir, 'nope'))).toBe(true)
    expect(await isEmptyOrMissingDir(dir)).toBe(true)
    await writeFile(join(dir, 'x.txt'), '')
    expect(await isEmptyOrMissingDir(dir)).toBe(false)
    expect(await isEmptyOrMissingDir(join(dir, 'x.txt'))).toBe(false)
  })
})
```

`src/main/cache.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { JsonCache } from './cache'
import { tempDir } from './test-utils'

describe('JsonCache', () => {
  it('returns fresh values, expires them, and keeps stale copies', async () => {
    let now = 1_000
    const cache = new JsonCache(await tempDir(), () => now)
    await cache.set('https://x.test/a', { a: 1 })
    expect(await cache.getFresh('https://x.test/a', 500)).toEqual({ a: 1 })
    now = 2_000
    expect(await cache.getFresh('https://x.test/a', 500)).toBeUndefined()
    expect(await cache.getStale('https://x.test/a')).toEqual({ a: 1 })
  })

  it('returns undefined for unknown keys', async () => {
    const cache = new JsonCache(await tempDir())
    expect(await cache.getFresh('missing', 1000)).toBeUndefined()
    expect(await cache.getStale('missing')).toBeUndefined()
  })
})
```

`src/main/net/http.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { JsonCache } from '../cache'
import { tempDir } from '../test-utils'
import { createHttpClient, USER_AGENT } from './http'

const URL_A = 'https://x.test/a'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function offlineFetch(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
}

describe('createHttpClient', () => {
  it('fetches JSON with a User-Agent header', async () => {
    const inits: RequestInit[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      inits.push(init)
      return jsonResponse({ ok: 1 })
    }) as unknown as typeof fetch
    const http = createHttpClient({ fetchImpl })
    expect(await http.getJson(URL_A)).toEqual({ ok: 1 })
    expect((inits[0].headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
  })

  it('serves a fresh cache entry without fetching', async () => {
    const cache = new JsonCache(await tempDir())
    await cache.set(URL_A, { cached: true })
    const fetchImpl = vi.fn()
    const http = createHttpClient({ cache, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await http.getJson(URL_A)).toEqual({ cached: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stores fetched JSON in the cache', async () => {
    const cache = new JsonCache(await tempDir())
    const http = createHttpClient({
      cache,
      fetchImpl: (async () => jsonResponse([1, 2])) as unknown as typeof fetch
    })
    await http.getJson(URL_A)
    expect(await cache.getStale(URL_A)).toEqual([1, 2])
  })

  it('falls back to a stale cache entry when offline and reports it', async () => {
    let now = 0
    const cache = new JsonCache(await tempDir(), () => now)
    await cache.set(URL_A, { old: true })
    now = 10_000_000
    const onStale = vi.fn()
    const http = createHttpClient({ cache, ttlMs: 1000, onStale, fetchImpl: offlineFetch() })
    expect(await http.getJson(URL_A)).toEqual({ old: true })
    expect(onStale).toHaveBeenCalledWith(URL_A)
  })

  it('throws NETWORK when offline without a cache entry', async () => {
    const http = createHttpClient({ fetchImpl: offlineFetch() })
    await expect(http.getJson(URL_A)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('throws HTTP on non-2xx responses', async () => {
    const http = createHttpClient({
      fetchImpl: (async () => jsonResponse({}, 404)) as unknown as typeof fetch
    })
    await expect(http.getJson(URL_A)).rejects.toMatchObject({ code: 'HTTP' })
    await expect(http.getText(URL_A)).rejects.toMatchObject({ code: 'HTTP' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/util/fs.test.ts src/main/cache.test.ts src/main/net/http.test.ts`
Expected: FAIL with "Failed to resolve import" for `./fs`, `./cache` and `./http`.

- [ ] **Step 4: Implement**

`src/main/util/fs.ts`:
```ts
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes to a temp file next to the target, then renames it over the target. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data, 'utf8')
  await rename(tmp, file)
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** True if the folder does not exist or contains nothing. False for files or non-empty folders. */
export async function isEmptyOrMissingDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
```

`src/main/cache.ts`:
```ts
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './util/fs'

interface CacheEntry {
  savedAt: number
  value: unknown
}

/** Small on-disk JSON cache keyed by string (we use URLs). */
export class JsonCache {
  private readonly dir: string
  private readonly now: () => number

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir
    this.now = now
  }

  async getFresh(key: string, maxAgeMs: number): Promise<unknown | undefined> {
    const entry = await this.read(key)
    return entry && this.now() - entry.savedAt <= maxAgeMs ? entry.value : undefined
  }

  async getStale(key: string): Promise<unknown | undefined> {
    return (await this.read(key))?.value
  }

  async set(key: string, value: unknown): Promise<void> {
    const entry: CacheEntry = { savedAt: this.now(), value }
    await writeFileAtomic(this.file(key), JSON.stringify(entry))
  }

  private file(key: string): string {
    return join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`)
  }

  private async read(key: string): Promise<CacheEntry | undefined> {
    try {
      return JSON.parse(await readFile(this.file(key), 'utf8')) as CacheEntry
    } catch {
      return undefined
    }
  }
}
```

`src/main/net/http.ts`:
```ts
import type { JsonCache } from '../cache'
import { AppError } from '../errors'

export const USER_AGENT = 'Blockhost/0.1.0 (Minecraft server manager)'

export interface HttpClient {
  getJson<T>(url: string): Promise<T>
  getText(url: string): Promise<string>
}

export interface HttpClientOptions {
  cache?: JsonCache
  ttlMs?: number
  fetchImpl?: typeof fetch
  /** Called when a stale cache entry is served because the network failed. */
  onStale?: (url: string) => void
}

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000

  async function request(url: string): Promise<Response> {
    const host = new URL(url).host
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
    } catch (err) {
      throw new AppError('NETWORK', `Could not reach ${host}: ${(err as Error).message}`)
    }
    if (!res.ok) throw new AppError('HTTP', `${host} returned HTTP ${res.status}`)
    return res
  }

  return {
    async getJson<T>(url: string): Promise<T> {
      const { cache } = opts
      if (cache) {
        const fresh = await cache.getFresh(url, ttlMs)
        if (fresh !== undefined) return fresh as T
      }
      try {
        const value = (await (await request(url)).json()) as T
        await cache?.set(url, value)
        return value
      } catch (err) {
        if (cache && err instanceof AppError && err.code === 'NETWORK') {
          const stale = await cache.getStale(url)
          if (stale !== undefined) {
            opts.onStale?.(url)
            return stale as T
          }
        }
        throw err
      }
    },

    async getText(url: string): Promise<string> {
      return (await request(url)).text()
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/util/fs.test.ts src/main/cache.test.ts src/main/net/http.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main
git commit -m "feat: add atomic file helpers, JSON cache and HTTP client with offline fallback"
```

---

### Task 5: Streaming downloader with hash verification and retries

**Files:**
- Create: `src/main/net/download.ts`
- Modify: `src/main/test-utils.ts` (add `fakeDownload`)
- Test: `src/main/net/download.test.ts`

**Interfaces:**
- Consumes: `AppError` (Task 2), `USER_AGENT` (Task 4)
- Produces:
  - `type HashAlgo = 'sha1' | 'sha256' | 'md5'`
  - `interface DownloadOptions { url: string; dest: string; hash?: { algo: HashAlgo; value: string }; onProgress?: (received: number, total: number | undefined) => void; retries?: number; retryDelayMs?: number; fetchImpl?: typeof fetch }`
  - `type DownloadFn = (opts: DownloadOptions) => Promise<void>`; `downloadFile: DownloadFn`
  - Error codes: `HASH_MISMATCH`, `HTTP`, `NETWORK`, `DOWNLOAD_FAILED`
  - test helper: `fakeDownload(): { calls: DownloadOptions[]; fn: DownloadFn }` (writes `'x'` to `dest`)

- [ ] **Step 1: Add the fake downloader helper**

Append to `src/main/test-utils.ts`. Merge the new imports into the existing import lines at the top of the file, so `node:fs/promises` becomes `{ mkdir, mkdtemp, writeFile }` and `node:path` becomes `{ dirname, join }`:
```ts
import type { DownloadFn, DownloadOptions } from './net/download'

/** DownloadFn that records calls and writes a placeholder file to `dest`. */
export function fakeDownload(): { calls: DownloadOptions[]; fn: DownloadFn } {
  const calls: DownloadOptions[] = []
  const fn: DownloadFn = async (opts) => {
    calls.push(opts)
    await mkdir(dirname(opts.dest), { recursive: true })
    await writeFile(opts.dest, 'x')
  }
  return { calls, fn }
}
```

- [ ] **Step 2: Write the failing test**

`src/main/net/download.test.ts`:
```ts
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pathExists } from '../util/fs'
import { tempDir } from '../test-utils'
import { downloadFile } from './download'

const body = Buffer.from('hello blockhost '.repeat(4096))
const sha256 = createHash('sha256').update(body).digest('hex')
let server: Server
let base: string
let flakyFailures = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/missing') {
      res.statusCode = 404
      res.end()
      return
    }
    if (req.url === '/flaky' && flakyFailures > 0) {
      flakyFailures--
      res.statusCode = 500
      res.end()
      return
    }
    res.setHeader('content-length', String(body.length))
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('downloadFile', () => {
  it('downloads to dest, verifies the hash and reports progress', async () => {
    const dest = join(await tempDir(), 'sub', 'server.jar')
    const progress: number[] = []
    await downloadFile({
      url: `${base}/ok`,
      dest,
      hash: { algo: 'sha256', value: sha256.toUpperCase() },
      onProgress: (received, total) => {
        expect(total).toBe(body.length)
        progress.push(received)
      }
    })
    expect(await readFile(dest)).toEqual(body)
    expect(progress.at(-1)).toBe(body.length)
    expect(await pathExists(`${dest}.part`)).toBe(false)
  })

  it('rejects with HASH_MISMATCH and leaves no files behind', async () => {
    const dest = join(await tempDir(), 'server.jar')
    await expect(
      downloadFile({ url: `${base}/ok`, dest, hash: { algo: 'sha1', value: 'abc' }, retries: 0 })
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(await pathExists(dest)).toBe(false)
    expect(await pathExists(`${dest}.part`)).toBe(false)
  })

  it('retries failed attempts', async () => {
    flakyFailures = 2
    const dest = join(await tempDir(), 'server.jar')
    await downloadFile({ url: `${base}/flaky`, dest, retries: 3, retryDelayMs: 1 })
    expect(await readFile(dest)).toEqual(body)
  })

  it('gives up after the retry budget', async () => {
    const dest = join(await tempDir(), 'server.jar')
    await expect(
      downloadFile({ url: `${base}/missing`, dest, retries: 1, retryDelayMs: 1 })
    ).rejects.toMatchObject({ code: 'HTTP' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/main/net/download.test.ts`
Expected: FAIL with "Failed to resolve import './download'".

- [ ] **Step 4: Implement**

`src/main/net/download.ts`:
```ts
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { AppError } from '../errors'
import { USER_AGENT } from './http'

export type HashAlgo = 'sha1' | 'sha256' | 'md5'

export interface DownloadOptions {
  url: string
  dest: string
  hash?: { algo: HashAlgo; value: string }
  onProgress?: (received: number, total: number | undefined) => void
  retries?: number
  retryDelayMs?: number
  fetchImpl?: typeof fetch
}

export type DownloadFn = (opts: DownloadOptions) => Promise<void>

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const downloadFile: DownloadFn = async (opts) => {
  const retries = opts.retries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 1000
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1))
    try {
      await attemptDownload(opts)
      return
    } catch (err) {
      lastError = err
      await rm(`${opts.dest}.part`, { force: true })
    }
  }
  if (lastError instanceof AppError) throw lastError
  throw new AppError('DOWNLOAD_FAILED', `Download failed: ${(lastError as Error)?.message}`)
}

async function attemptDownload(opts: DownloadOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(opts.url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    throw new AppError('NETWORK', `Could not download ${opts.url}: ${(err as Error).message}`)
  }
  if (!res.ok || !res.body) {
    throw new AppError('HTTP', `Download of ${opts.url} failed with HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || undefined
  const part = `${opts.dest}.part`
  const hash = opts.hash ? createHash(opts.hash.algo) : null
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      hash?.update(chunk)
      opts.onProgress?.(received, total)
      callback(null, chunk)
    }
  })

  await mkdir(dirname(opts.dest), { recursive: true })
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    meter,
    createWriteStream(part)
  )

  if (hash && opts.hash) {
    const actual = hash.digest('hex')
    if (actual.toLowerCase() !== opts.hash.value.toLowerCase()) {
      throw new AppError('HASH_MISMATCH', `Checksum mismatch for ${basename(opts.dest)}`)
    }
  }
  await rename(part, opts.dest)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/net/download.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main
git commit -m "feat: add streaming downloader with checksum verification and retries"
```

---
### Task 6: Java runtime: detection, runner, Temurin manager, resolver

**Files:**
- Create: `src/main/java/detect.ts`, `src/main/java/run.ts`, `src/main/java/manager.ts`, `src/main/java/resolver.ts`
- Test: `src/main/java/detect.test.ts`, `src/main/java/run.test.ts`, `src/main/java/manager.test.ts`, `src/main/java/resolver.test.ts`

**Interfaces:**
- Consumes: `AppError`, `normalizeJavaMajor`, `fallbackJavaMajor` (Task 2); `LineSplitter` (Task 3); `pathExists`, `HttpClient`, `tempDir`, `fakeHttp` (Task 4); `DownloadFn`, `fakeDownload` (Task 5)
- Produces:
  - `parseJavaVersionOutput(output: string): number | null`; `probeJava(javaPath: string): Promise<number | null>`
  - `type RunJava = (javaPath: string, args: string[], cwd: string, onLine: (line: string) => void) => Promise<number>`; `runJava: RunJava` (rejects with `JAVA_SPAWN`)
  - `adoptiumAssetsUrl(major: number): string`
  - `interface JavaManagerDeps { root: string; http: HttpClient; download: DownloadFn; extractZip: (zipPath: string, destDir: string) => Promise<void> }`
  - `class JavaManager { constructor(deps); javaExe(major: number): string; isInstalled(major: number): Promise<boolean>; ensure(major: number, onProgress?: (percent: number) => void): Promise<string> }` (error `JAVA_UNAVAILABLE`, `JAVA_EXTRACT`)
  - `interface JavaResolverDeps { manager: Pick<JavaManager, 'ensure' | 'isInstalled' | 'javaExe'>; mojangJavaMajor: (mcVersion: string) => Promise<number | undefined>; probe: (javaPath: string) => Promise<number | null> }`
  - `class JavaResolver { constructor(deps); requiredMajor(mcVersion: string): Promise<number>; forInstall(server: Pick<ServerRecord, 'mcVersion' | 'javaPath'>, onProgress?: (percent: number) => void): Promise<string>; forStart(server: Pick<ServerRecord, 'mcVersion' | 'javaPath'>): Promise<string> }` (errors `JAVA_INVALID`; `JAVA_MISSING` with `details.major`)

- [ ] **Step 1: Write the failing tests**

`src/main/java/detect.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseJavaVersionOutput, probeJava } from './detect'

describe('parseJavaVersionOutput', () => {
  it.each([
    ['java version "1.8.0_392"\nJava(TM) SE Runtime Environment', 8],
    ['openjdk version "17.0.20.1" 2026-07-21', 17],
    ['java version "25.0.1" 2025-10-21 LTS', 25],
    ['openjdk version "21" 2023-09-19', 21],
    ['garbage', null]
  ])('parses %j', (output, major) => {
    expect(parseJavaVersionOutput(output)).toBe(major)
  })
})

describe('probeJava', () => {
  it('returns null for an executable that is not Java', async () => {
    expect(await probeJava(process.execPath)).toBeNull()
  })

  it('returns null for a missing executable', async () => {
    expect(await probeJava('C:/definitely/not/here/java.exe')).toBeNull()
  })
})
```

`src/main/java/run.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runJava } from './run'

describe('runJava', () => {
  it('streams stdout and stderr lines and resolves with the exit code', async () => {
    const lines: string[] = []
    const code = await runJava(
      process.execPath,
      ['-e', "console.log('one'); console.error('two'); process.exit(3)"],
      process.cwd(),
      (line) => lines.push(line)
    )
    expect(code).toBe(3)
    expect(lines.sort()).toEqual(['one', 'two'])
  })

  it('rejects with JAVA_SPAWN when the executable does not exist', async () => {
    await expect(
      runJava('C:/definitely/not/here/java.exe', [], process.cwd(), () => {})
    ).rejects.toMatchObject({ code: 'JAVA_SPAWN' })
  })
})
```

`src/main/java/manager.test.ts`:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeDownload, fakeHttp, tempDir } from '../test-utils'
import { pathExists } from '../util/fs'
import { adoptiumAssetsUrl, JavaManager } from './manager'

const asset21 = {
  release_name: 'jdk-21.0.12.1+1',
  binary: {
    package: {
      link: 'https://dl.test/jre21.zip',
      checksum: 'abc123',
      name: 'OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip'
    }
  }
}

async function setup() {
  const root = await tempDir()
  const http = fakeHttp({ [adoptiumAssetsUrl(21)]: [asset21], [adoptiumAssetsUrl(8)]: [] })
  const dl = fakeDownload()
  const extractZip = vi.fn(async (_zip: string, dest: string) => {
    const bin = join(dest, 'jdk-21.0.12.1+1-jre', 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'java.exe'), '')
  })
  const manager = new JavaManager({ root, http, download: dl.fn, extractZip })
  return { root, dl, extractZip, manager }
}

describe('JavaManager', () => {
  it('builds the Adoptium query for Windows x64 JREs', () => {
    expect(adoptiumAssetsUrl(25)).toBe(
      'https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jre'
    )
  })

  it('downloads, verifies and extracts a JRE into temurin-<major>', async () => {
    const { root, dl, manager } = await setup()
    const exe = await manager.ensure(21)
    expect(exe).toBe(join(root, 'temurin-21', 'bin', 'java.exe'))
    expect(await pathExists(exe)).toBe(true)
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/jre21.zip',
      hash: { algo: 'sha256', value: 'abc123' }
    })
    expect(await pathExists(join(root, asset21.binary.package.name))).toBe(false)
    expect(await pathExists(join(root, 'temurin-21.staging'))).toBe(false)
  })

  it('does not download again once installed', async () => {
    const { dl, manager } = await setup()
    await manager.ensure(21)
    await manager.ensure(21)
    expect(dl.calls).toHaveLength(1)
    expect(await manager.isInstalled(21)).toBe(true)
  })

  it('deduplicates concurrent installs of the same major', async () => {
    const { dl, manager } = await setup()
    const [a, b] = await Promise.all([manager.ensure(21), manager.ensure(21)])
    expect(a).toBe(b)
    expect(dl.calls).toHaveLength(1)
  })

  it('fails clearly when Adoptium has no build', async () => {
    const { manager } = await setup()
    await expect(manager.ensure(8)).rejects.toMatchObject({ code: 'JAVA_UNAVAILABLE' })
  })
})
```

`src/main/java/resolver.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { JavaResolver } from './resolver'

function fakeManager(installed: number[]) {
  return {
    ensure: vi.fn(async (major: number) => `C:/java/${major}/bin/java.exe`),
    isInstalled: vi.fn(async (major: number) => installed.includes(major)),
    javaExe: (major: number) => `C:/java/${major}/bin/java.exe`
  }
}

describe('JavaResolver', () => {
  it('uses the Mojang Java version, normalized to an LTS', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 16,
      probe: async () => null
    })
    expect(await resolver.requiredMajor('1.17.1')).toBe(17)
  })

  it('falls back to the version table when the lookup fails or is unknown', async () => {
    const failing = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => {
        throw new Error('offline')
      },
      probe: async () => null
    })
    expect(await failing.requiredMajor('26.3')).toBe(25)
    const unknown = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => undefined,
      probe: async () => null
    })
    expect(await unknown.requiredMajor('1.20.4')).toBe(17)
  })

  it('forInstall prefers a custom Java path', async () => {
    const manager = fakeManager([])
    const resolver = new JavaResolver({ manager, mojangJavaMajor: async () => 21, probe: async () => 21 })
    const path = await resolver.forInstall({ mcVersion: '1.21.4', javaPath: 'D:/jdk/bin/java.exe' })
    expect(path).toBe('D:/jdk/bin/java.exe')
    expect(manager.ensure).not.toHaveBeenCalled()
  })

  it('forInstall ensures the managed Java', async () => {
    const manager = fakeManager([])
    const resolver = new JavaResolver({ manager, mojangJavaMajor: async () => 21, probe: async () => null })
    expect(await resolver.forInstall({ mcVersion: '1.21.4' })).toBe('C:/java/21/bin/java.exe')
    expect(manager.ensure).toHaveBeenCalledWith(21, undefined)
  })

  it('forStart returns the managed exe when installed', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([25]),
      mojangJavaMajor: async () => 25,
      probe: async () => null
    })
    expect(await resolver.forStart({ mcVersion: '26.3' })).toBe('C:/java/25/bin/java.exe')
  })

  it('forStart throws JAVA_MISSING with the required major', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 21,
      probe: async () => null
    })
    await expect(resolver.forStart({ mcVersion: '1.21.4' })).rejects.toMatchObject({
      code: 'JAVA_MISSING',
      details: { major: 21 }
    })
  })

  it('forStart rejects a custom Java that cannot run', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 21,
      probe: async () => null
    })
    await expect(
      resolver.forStart({ mcVersion: '1.21.4', javaPath: 'D:/broken/java.exe' })
    ).rejects.toMatchObject({ code: 'JAVA_INVALID' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/java`
Expected: FAIL. `detect`, `run`, `manager` and `resolver` each report "Failed to resolve import". `requirements` still passes.

- [ ] **Step 3: Implement**

`src/main/java/detect.ts`:
```ts
import { execFile } from 'node:child_process'

/** Extracts the Java major from `java -version` output ("1.8.0_392" -> 8, "21.0.2" -> 21). */
export function parseJavaVersionOutput(output: string): number | null {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(output)
  if (!match) return null
  const first = Number(match[1])
  return first === 1 && match[2] ? Number(match[2]) : first
}

/** Runs `<javaPath> -version`; resolves the major version or null if it is not a working Java. */
export function probeJava(javaPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      javaPath,
      ['-version'],
      { timeout: 15_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return resolve(null)
        resolve(parseJavaVersionOutput(`${stderr}\n${stdout}`))
      }
    )
  })
}
```

`src/main/java/run.ts`:
```ts
import { spawn } from 'node:child_process'
import { AppError } from '../errors'
import { LineSplitter } from '../util/lines'

export type RunJava = (
  javaPath: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
) => Promise<number>

/** Runs a short-lived Java process (e.g. a mod loader installer) and streams its output lines. */
export const runJava: RunJava = (javaPath, args, cwd, onLine) =>
  new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd, windowsHide: true })
    const stdout = new LineSplitter(onLine)
    const stderr = new LineSplitter(onLine)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk))
    child.on('error', (err) => reject(new AppError('JAVA_SPAWN', `Could not run Java: ${err.message}`)))
    child.on('close', (code) => {
      stdout.flush()
      stderr.flush()
      resolve(code ?? -1)
    })
  })
```

`src/main/java/manager.ts`:
```ts
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../errors'
import type { DownloadFn } from '../net/download'
import type { HttpClient } from '../net/http'
import { pathExists } from '../util/fs'

interface AdoptiumAsset {
  release_name: string
  binary: { package: { link: string; checksum: string; name: string } }
}

export function adoptiumAssetsUrl(major: number): string {
  return `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jre`
}

export interface JavaManagerDeps {
  root: string
  http: HttpClient
  download: DownloadFn
  extractZip: (zipPath: string, destDir: string) => Promise<void>
}

/** Installs Eclipse Temurin JREs into `<root>/temurin-<major>/`, one per major, shared by servers. */
export class JavaManager {
  private readonly deps: JavaManagerDeps
  private readonly inflight = new Map<number, Promise<string>>()

  constructor(deps: JavaManagerDeps) {
    this.deps = deps
  }

  javaExe(major: number): string {
    return join(this.deps.root, `temurin-${major}`, 'bin', 'java.exe')
  }

  isInstalled(major: number): Promise<boolean> {
    return pathExists(this.javaExe(major))
  }

  ensure(major: number, onProgress?: (percent: number) => void): Promise<string> {
    const existing = this.inflight.get(major)
    if (existing) return existing
    const job = this.install(major, onProgress).finally(() => this.inflight.delete(major))
    this.inflight.set(major, job)
    return job
  }

  private async install(major: number, onProgress?: (percent: number) => void): Promise<string> {
    if (await this.isInstalled(major)) return this.javaExe(major)

    const assets = await this.deps.http.getJson<AdoptiumAsset[]>(adoptiumAssetsUrl(major))
    const pkg = assets[0]?.binary.package
    if (!pkg) {
      throw new AppError('JAVA_UNAVAILABLE', `No Java ${major} build is available for Windows x64`)
    }

    const zip = join(this.deps.root, pkg.name)
    await this.deps.download({
      url: pkg.link,
      dest: zip,
      hash: { algo: 'sha256', value: pkg.checksum },
      onProgress: (received, total) => {
        if (total) onProgress?.(Math.round((received / total) * 100))
      }
    })

    const staging = join(this.deps.root, `temurin-${major}.staging`)
    const final = join(this.deps.root, `temurin-${major}`)
    await rm(staging, { recursive: true, force: true })
    await this.deps.extractZip(zip, staging)
    // Temurin zips contain a single top-level folder such as "jdk-21.0.12.1+1-jre".
    const [top] = await readdir(staging)
    if (!top) throw new AppError('JAVA_EXTRACT', `The Java ${major} archive was empty`)
    await rm(final, { recursive: true, force: true })
    await rename(join(staging, top), final)
    await rm(staging, { recursive: true, force: true })
    await rm(zip, { force: true })

    if (!(await this.isInstalled(major))) {
      throw new AppError('JAVA_EXTRACT', `The Java ${major} archive did not contain bin/java.exe`)
    }
    return this.javaExe(major)
  }
}
```

`src/main/java/resolver.ts`:
```ts
import type { ServerRecord } from '../../shared/types'
import { AppError } from '../errors'
import type { JavaManager } from './manager'
import { fallbackJavaMajor, normalizeJavaMajor } from './requirements'

export interface JavaResolverDeps {
  manager: Pick<JavaManager, 'ensure' | 'isInstalled' | 'javaExe'>
  mojangJavaMajor: (mcVersion: string) => Promise<number | undefined>
  probe: (javaPath: string) => Promise<number | null>
}

type JavaTarget = Pick<ServerRecord, 'mcVersion' | 'javaPath'>

/** Decides which java.exe a server uses for installing and starting. */
export class JavaResolver {
  private readonly deps: JavaResolverDeps

  constructor(deps: JavaResolverDeps) {
    this.deps = deps
  }

  async requiredMajor(mcVersion: string): Promise<number> {
    let major: number | undefined
    try {
      major = await this.deps.mojangJavaMajor(mcVersion)
    } catch {
      major = undefined
    }
    return major ? normalizeJavaMajor(major) : fallbackJavaMajor(mcVersion)
  }

  async forInstall(server: JavaTarget, onProgress?: (percent: number) => void): Promise<string> {
    if (server.javaPath) return server.javaPath
    return this.deps.manager.ensure(await this.requiredMajor(server.mcVersion), onProgress)
  }

  async forStart(server: JavaTarget): Promise<string> {
    if (server.javaPath) {
      if ((await this.deps.probe(server.javaPath)) === null) {
        throw new AppError('JAVA_INVALID', `The custom Java at ${server.javaPath} could not be run`)
      }
      return server.javaPath
    }
    const major = await this.requiredMajor(server.mcVersion)
    if (!(await this.deps.manager.isInstalled(major))) {
      throw new AppError('JAVA_MISSING', `Java ${major} is not installed`, { major })
    }
    return this.deps.manager.javaExe(major)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/java`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/java
git commit -m "feat: add Java detection, runner, Temurin manager and resolver"
```

---

### Task 7: Provider interface and jar-based providers (Vanilla, Paper, Purpur, Fabric)

**Files:**
- Create: `src/main/providers/types.ts`, `src/main/providers/vanilla.ts`, `src/main/providers/paper.ts`, `src/main/providers/purpur.ts`, `src/main/providers/fabric.ts`
- Modify: `src/main/test-utils.ts` (add `fakeProviderDeps`, `installOpts`)
- Test: `src/main/providers/vanilla.test.ts`, `paper.test.ts`, `purpur.test.ts`, `fabric.test.ts`

**Interfaces:**
- Consumes: `AppError`, `SERVER_TYPE_LABELS`, `ServerType`, `VersionInfo`, `LaunchSpec` (Task 2); `HttpClient` (Task 4); `DownloadFn` (Task 5); `RunJava` (Task 6)
- Produces:
  - `interface ProviderInstallOptions { dir: string; version: string; build?: string; javaPath: string; onLog: (line: string) => void; onProgress: (percent: number) => void }`
  - `interface ServerProvider { readonly type: ServerType; readonly label: string; listVersions(): Promise<VersionInfo[]>; listBuilds?(version: string): Promise<VersionInfo[]>; install(opts: ProviderInstallOptions): Promise<LaunchSpec> }`
  - `interface ProviderDeps { http: HttpClient; download: DownloadFn; runJava: RunJava }`
  - `percentReporter(onProgress: (percent: number) => void): (received: number, total: number | undefined) => void`
  - `MOJANG_MANIFEST`, `createMojangJavaLookup(http: HttpClient): (mcVersion: string) => Promise<number | undefined>`
  - `createVanillaProvider(deps)`, `createPaperProvider(deps)`, `createPurpurProvider(deps)`, `createFabricProvider(deps)`, each returning `ServerProvider`
  - URL constants: `PAPER_API`, `PURPUR_API`, `FABRIC_META`
  - Error codes: `NO_SERVER_JAR`, `BUILD_NOT_FOUND`, `VERSION_NOT_FOUND`
  - test helpers: `fakeProviderDeps(routes, runJava?)` returning `{ http, dl, deps }`; `installOpts(dir, version, build?)` returning `ProviderInstallOptions`

- [ ] **Step 1: Write the provider types**

`src/main/providers/types.ts`:
```ts
import type { LaunchSpec, ServerType, VersionInfo } from '../../shared/types'
import type { RunJava } from '../java/run'
import type { DownloadFn } from '../net/download'
import type { HttpClient } from '../net/http'

export interface ProviderInstallOptions {
  dir: string
  version: string
  build?: string
  javaPath: string
  onLog: (line: string) => void
  onProgress: (percent: number) => void
}

export interface ServerProvider {
  readonly type: ServerType
  readonly label: string
  listVersions(): Promise<VersionInfo[]>
  listBuilds?(version: string): Promise<VersionInfo[]>
  /** Puts the server files into `dir` and returns how to launch them. */
  install(opts: ProviderInstallOptions): Promise<LaunchSpec>
}

export interface ProviderDeps {
  http: HttpClient
  download: DownloadFn
  runJava: RunJava
}

export function percentReporter(
  onProgress: (percent: number) => void
): (received: number, total: number | undefined) => void {
  return (received, total) => {
    if (total) onProgress(Math.round((received / total) * 100))
  }
}
```

- [ ] **Step 2: Add the test helpers**

Append to `src/main/test-utils.ts` (merge imports at the top):
```ts
import type { RunJava } from './java/run'
import type { ProviderDeps, ProviderInstallOptions } from './providers/types'

export function fakeProviderDeps(routes: Record<string, unknown>, runJava: RunJava = async () => 0) {
  const http = fakeHttp(routes)
  const dl = fakeDownload()
  const deps: ProviderDeps = { http, download: dl.fn, runJava }
  return { http, dl, deps }
}

export function installOpts(dir: string, version: string, build?: string): ProviderInstallOptions {
  return { dir, version, build, javaPath: 'C:/java/bin/java.exe', onLog: () => {}, onProgress: () => {} }
}
```

- [ ] **Step 3: Write the failing tests**

`src/main/providers/vanilla.test.ts`:
```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createMojangJavaLookup, createVanillaProvider, MOJANG_MANIFEST } from './vanilla'

const routes = {
  [MOJANG_MANIFEST]: {
    versions: [
      { id: '26.4-snapshot-4', type: 'snapshot', url: 'https://meta.test/snap.json' },
      { id: '26.3', type: 'release', url: 'https://meta.test/26.3.json' },
      { id: 'b1.7.3', type: 'old_beta', url: 'https://meta.test/b173.json' }
    ]
  },
  'https://meta.test/26.3.json': {
    downloads: { server: { url: 'https://dl.test/server.jar', sha1: 'deadbeef' } },
    javaVersion: { majorVersion: 25 }
  },
  'https://meta.test/b173.json': { downloads: {} }
}

describe('vanilla provider', () => {
  it('lists releases and snapshots only', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createVanillaProvider(deps).listVersions()).toEqual([
      { id: '26.4-snapshot-4', stable: false },
      { id: '26.3', stable: true }
    ])
  })

  it('downloads server.jar with sha1 verification', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createVanillaProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/server.jar',
      dest: join(dir, 'server.jar'),
      hash: { algo: 'sha1', value: 'deadbeef' }
    })
  })

  it('rejects versions without an official server download', async () => {
    const { deps } = fakeProviderDeps(routes)
    await expect(
      createVanillaProvider(deps).install(installOpts(await tempDir(), 'b1.7.3'))
    ).rejects.toMatchObject({ code: 'NO_SERVER_JAR' })
  })

  it('looks up the required Java version from Mojang metadata', async () => {
    const { http } = fakeProviderDeps(routes)
    const lookup = createMojangJavaLookup(http)
    expect(await lookup('26.3')).toBe(25)
    expect(await lookup('1.7.10_pre4')).toBeUndefined()
  })
})
```

`src/main/providers/paper.test.ts`:
```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createPaperProvider, PAPER_API } from './paper'

function build(id: number, channel: string) {
  return {
    id,
    channel,
    downloads: {
      'server:default': {
        name: `paper-26.3-${id}.jar`,
        url: `https://dl.test/${id}.jar`,
        checksums: { sha256: `sha${id}` }
      }
    }
  }
}

const routes = {
  [`${PAPER_API}/versions`]: { versions: [{ version: { id: '26.3' } }, { version: { id: '26.3-rc-3' } }] },
  [`${PAPER_API}/versions/26.3/builds`]: [build(204, 'BETA'), build(203, 'STABLE')]
}

describe('paper provider', () => {
  it('lists versions, marking release candidates unstable', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPaperProvider(deps).listVersions()).toEqual([
      { id: '26.3', stable: true },
      { id: '26.3-rc-3', stable: false }
    ])
  })

  it('lists builds newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPaperProvider(deps).listBuilds!('26.3')).toEqual([
      { id: '204', stable: false },
      { id: '203', stable: true }
    ])
  })

  it('installs the newest stable build by default', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createPaperProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/203.jar',
      dest: join(dir, 'server.jar'),
      hash: { algo: 'sha256', value: 'sha203' }
    })
  })

  it('installs an explicitly chosen build', async () => {
    const { deps, dl } = fakeProviderDeps(routes)
    await createPaperProvider(deps).install(installOpts(await tempDir(), '26.3', '204'))
    expect(dl.calls[0].url).toBe('https://dl.test/204.jar')
  })

  it('rejects an unknown build', async () => {
    const { deps } = fakeProviderDeps(routes)
    await expect(
      createPaperProvider(deps).install(installOpts(await tempDir(), '26.3', '999'))
    ).rejects.toMatchObject({ code: 'BUILD_NOT_FOUND' })
  })
})
```

`src/main/providers/purpur.test.ts`:
```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createPurpurProvider, PURPUR_API } from './purpur'

const routes = {
  [PURPUR_API]: { versions: ['1.21.4', '26.3'] },
  [`${PURPUR_API}/26.3`]: { builds: { latest: '2601', all: ['2600', '2601'] } },
  [`${PURPUR_API}/26.3/2601`]: { md5: 'md5-2601' },
  [`${PURPUR_API}/26.3/2600`]: { md5: 'md5-2600' }
}

describe('purpur provider', () => {
  it('lists versions newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPurpurProvider(deps).listVersions()).toEqual([
      { id: '26.3', stable: true },
      { id: '1.21.4', stable: true }
    ])
  })

  it('lists builds newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPurpurProvider(deps).listBuilds!('26.3')).toEqual([
      { id: '2601', stable: true },
      { id: '2600', stable: true }
    ])
  })

  it('installs the latest build with md5 verification', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createPurpurProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: `${PURPUR_API}/26.3/2601/download`,
      dest: join(dir, 'server.jar'),
      hash: { algo: 'md5', value: 'md5-2601' }
    })
  })

  it('installs an explicitly chosen build', async () => {
    const { deps, dl } = fakeProviderDeps(routes)
    await createPurpurProvider(deps).install(installOpts(await tempDir(), '26.3', '2600'))
    expect(dl.calls[0]).toMatchObject({ url: `${PURPUR_API}/26.3/2600/download`, hash: { value: 'md5-2600' } })
  })
})
```

`src/main/providers/fabric.test.ts`:
```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createFabricProvider, FABRIC_META } from './fabric'

const routes = {
  [`${FABRIC_META}/game`]: [
    { version: '26.4-snapshot-4', stable: false },
    { version: '26.3', stable: true }
  ],
  [`${FABRIC_META}/loader`]: [
    { version: '0.20.0', stable: false },
    { version: '0.19.2', stable: true }
  ],
  [`${FABRIC_META}/installer`]: [{ version: '1.1.2', stable: true }]
}

describe('fabric provider', () => {
  it('lists game versions with stability', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createFabricProvider(deps).listVersions()).toEqual([
      { id: '26.4-snapshot-4', stable: false },
      { id: '26.3', stable: true }
    ])
  })

  it('downloads the server launcher for the latest stable loader and installer', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createFabricProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'fabric-server-launch.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: `${FABRIC_META}/loader/26.3/0.19.2/1.1.2/server/jar`,
      dest: join(dir, 'fabric-server-launch.jar')
    })
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/main/providers`
Expected: FAIL with "Failed to resolve import" for `./vanilla`, `./paper`, `./purpur` and `./fabric`.

- [ ] **Step 5: Implement**

`src/main/providers/vanilla.ts`:
```ts
import { join } from 'node:path'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  versions: { id: string; type: string; url: string }[]
}

interface VersionMeta {
  downloads: { server?: { url: string; sha1: string } }
  javaVersion?: { majorVersion: number }
}

async function versionMeta(http: HttpClient, version: string): Promise<VersionMeta | undefined> {
  const manifest = await http.getJson<Manifest>(MOJANG_MANIFEST)
  const entry = manifest.versions.find((v) => v.id === version)
  return entry ? http.getJson<VersionMeta>(entry.url) : undefined
}

/** Required Java major for a Minecraft version according to Mojang, if known. */
export function createMojangJavaLookup(http: HttpClient) {
  return async (mcVersion: string): Promise<number | undefined> =>
    (await versionMeta(http, mcVersion))?.javaVersion?.majorVersion
}

export function createVanillaProvider({ http, download }: ProviderDeps): ServerProvider {
  return {
    type: 'vanilla',
    label: 'Vanilla',

    async listVersions() {
      const manifest = await http.getJson<Manifest>(MOJANG_MANIFEST)
      return manifest.versions
        .filter((v) => v.type === 'release' || v.type === 'snapshot')
        .map((v) => ({ id: v.id, stable: v.type === 'release' }))
    },

    async install(opts) {
      const server = (await versionMeta(http, opts.version))?.downloads.server
      if (!server) {
        throw new AppError('NO_SERVER_JAR', `Minecraft ${opts.version} has no official server download`)
      }
      opts.onLog(`Downloading Minecraft server ${opts.version}`)
      await download({
        url: server.url,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'sha1', value: server.sha1 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}
```

`src/main/providers/paper.ts`:
```ts
import { join } from 'node:path'
import { AppError } from '../errors'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const PAPER_API = 'https://fill.papermc.io/v3/projects/paper'

interface PaperVersions {
  versions: { version: { id: string } }[]
}

interface PaperBuild {
  id: number
  channel: string
  downloads: Record<string, { name: string; url: string; checksums: { sha256: string } }>
}

export function createPaperProvider({ http, download }: ProviderDeps): ServerProvider {
  const builds = (version: string): Promise<PaperBuild[]> =>
    http.getJson<PaperBuild[]>(`${PAPER_API}/versions/${encodeURIComponent(version)}/builds`)

  return {
    type: 'paper',
    label: 'Paper',

    async listVersions() {
      const data = await http.getJson<PaperVersions>(`${PAPER_API}/versions`)
      return data.versions.map((v) => ({ id: v.version.id, stable: !v.version.id.includes('-') }))
    },

    async listBuilds(version) {
      return (await builds(version)).map((b) => ({ id: String(b.id), stable: b.channel === 'STABLE' }))
    },

    async install(opts) {
      const list = await builds(opts.version)
      const chosen = opts.build
        ? list.find((b) => String(b.id) === opts.build)
        : (list.find((b) => b.channel === 'STABLE') ?? list[0])
      const file = chosen?.downloads['server:default']
      if (!chosen || !file) {
        throw new AppError('BUILD_NOT_FOUND', `Paper build ${opts.build ?? 'latest'} for ${opts.version} was not found`)
      }
      opts.onLog(`Downloading ${file.name}`)
      await download({
        url: file.url,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'sha256', value: file.checksums.sha256 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}
```

`src/main/providers/purpur.ts`:
```ts
import { join } from 'node:path'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const PURPUR_API = 'https://api.purpurmc.org/v2/purpur'

interface PurpurVersion {
  builds: { latest: string; all: string[] }
}

export function createPurpurProvider({ http, download }: ProviderDeps): ServerProvider {
  const versionInfo = (version: string): Promise<PurpurVersion> =>
    http.getJson<PurpurVersion>(`${PURPUR_API}/${encodeURIComponent(version)}`)

  return {
    type: 'purpur',
    label: 'Purpur',

    async listVersions() {
      const data = await http.getJson<{ versions: string[] }>(PURPUR_API)
      return [...data.versions].reverse().map((id) => ({ id, stable: true }))
    },

    async listBuilds(version) {
      const info = await versionInfo(version)
      return [...info.builds.all].reverse().map((id) => ({ id, stable: true }))
    },

    async install(opts) {
      const build = opts.build ?? (await versionInfo(opts.version)).builds.latest
      const base = `${PURPUR_API}/${encodeURIComponent(opts.version)}/${encodeURIComponent(build)}`
      const { md5 } = await http.getJson<{ md5: string }>(base)
      opts.onLog(`Downloading Purpur ${opts.version} build ${build}`)
      await download({
        url: `${base}/download`,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'md5', value: md5 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}
```

`src/main/providers/fabric.ts`:
```ts
import { join } from 'node:path'
import { AppError } from '../errors'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const FABRIC_META = 'https://meta.fabricmc.net/v2/versions'

interface FabricEntry {
  version: string
  stable: boolean
}

const pickStable = (list: FabricEntry[]): FabricEntry | undefined =>
  list.find((e) => e.stable) ?? list[0]

export function createFabricProvider({ http, download }: ProviderDeps): ServerProvider {
  return {
    type: 'fabric',
    label: 'Fabric',

    async listVersions() {
      const games = await http.getJson<FabricEntry[]>(`${FABRIC_META}/game`)
      return games.map((g) => ({ id: g.version, stable: g.stable }))
    },

    async install(opts) {
      const loader = pickStable(await http.getJson<FabricEntry[]>(`${FABRIC_META}/loader`))
      const installer = pickStable(await http.getJson<FabricEntry[]>(`${FABRIC_META}/installer`))
      if (!loader || !installer) {
        throw new AppError('VERSION_NOT_FOUND', 'Fabric loader metadata is unavailable')
      }
      const url = `${FABRIC_META}/loader/${encodeURIComponent(opts.version)}/${loader.version}/${installer.version}/server/jar`
      opts.onLog(`Downloading Fabric ${loader.version} for Minecraft ${opts.version}`)
      await download({
        url,
        dest: join(opts.dir, 'fabric-server-launch.jar'),
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'fabric-server-launch.jar'] }
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/providers`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main
git commit -m "feat: add Vanilla, Paper, Purpur and Fabric providers"
```

---

### Task 8: Mod loader providers (Forge, NeoForge) and provider registry

**Files:**
- Create: `src/main/providers/modloader.ts`, `src/main/providers/forge.ts`, `src/main/providers/neoforge.ts`, `src/main/providers/index.ts`
- Test: `src/main/providers/modloader.test.ts`, `forge.test.ts`, `neoforge.test.ts`, `index.test.ts`, fixtures in `src/main/providers/runBat.fixtures.ts`

**Interfaces:**
- Consumes: `ProviderDeps`, `ProviderInstallOptions`, `ServerProvider`, `percentReporter` (Task 7); `compareMcVersions` (Task 2); `pathExists` (Task 4); `fakeProviderDeps`, `installOpts`, `tempDir` (Tasks 4 and 7)
- Produces:
  - `parseRunBat(content: string): LaunchSpec | null`; `resolveLaunchSpec(dir: string): Promise<LaunchSpec>` (error `LAUNCH_NOT_FOUND`)
  - `runModLoaderInstaller(deps: ProviderDeps, opts: ProviderInstallOptions, installerUrl: string): Promise<LaunchSpec>` (error `INSTALLER_FAILED`)
  - `FORGE_PROMOS`, `forgeVersionsFromPromos(promos: Record<string, string>): VersionInfo[]`, `createForgeProvider(deps)`
  - `NEOFORGE_VERSIONS`, `neoForgeToMc(neo: string): string | null`, `pickNeoForge(all: string[], mc: string): string | undefined`, `neoForgeVersions(all: string[]): VersionInfo[]`, `createNeoForgeProvider(deps)`
  - `createProviders(deps: ProviderDeps): Record<ServerType, ServerProvider>`

- [ ] **Step 1: Write the failing tests**

`src/main/providers/runBat.fixtures.ts` (test data shared by the mod loader tests):
```ts
// Verbatim run.bat output of the Forge 26.3-66.0.13 and NeoForge 26.3.0.88 installers.
export const FORGE_RUN_BAT = [
  '@echo off',
  'REM Add custom JVM arguments (such as RAM allocation) to the user_jvm_args.txt',
  '',
  'java -jar forge-26.3-66.0.13-shim.jar --onlyCheckJava',
  'if %ERRORLEVEL% NEQ 0 (',
  '    echo.',
  '    goto :exit',
  ')',
  '',
  'REM Add custom program arguments (such as nogui) to the next line before the %* or pass them to this script directly',
  'java @user_jvm_args.txt @libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt %*',
  '',
  ':exit',
  'pause'
].join('\r\n')

export const NEO_RUN_BAT = [
  '@echo off',
  'REM Forge requires a configured set of both JVM and program arguments.',
  'java @user_jvm_args.txt @libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt %*',
  'pause'
].join('\r\n')
```

`src/main/providers/modloader.test.ts`:
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { pathExists } from '../util/fs'
import { parseRunBat, resolveLaunchSpec, runModLoaderInstaller } from './modloader'
import { FORGE_RUN_BAT, NEO_RUN_BAT } from './runBat.fixtures'

describe('parseRunBat', () => {
  it('extracts the Forge args file and ignores the Java pre-check line', () => {
    expect(parseRunBat(FORGE_RUN_BAT)).toEqual({
      args: ['@libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt']
    })
  })

  it('extracts the NeoForge args file', () => {
    expect(parseRunBat(NEO_RUN_BAT)).toEqual({
      args: ['@libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt']
    })
  })

  it('returns null when there is no launch line', () => {
    expect(parseRunBat('@echo off\r\npause')).toBeNull()
  })
})

describe('resolveLaunchSpec', () => {
  it('falls back to the legacy Forge jar', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'forge-1.12.2-14.23.5.2860.jar'), '')
    await writeFile(join(dir, 'minecraft_server.1.12.2.jar'), '')
    expect(await resolveLaunchSpec(dir)).toEqual({ args: ['-jar', 'forge-1.12.2-14.23.5.2860.jar'] })
  })

  it('throws LAUNCH_NOT_FOUND when nothing is launchable', async () => {
    await expect(resolveLaunchSpec(await tempDir())).rejects.toMatchObject({ code: 'LAUNCH_NOT_FOUND' })
  })
})

describe('runModLoaderInstaller', () => {
  it('downloads and runs the installer, cleans up, and returns the launch spec', async () => {
    const dir = await tempDir()
    const runJava = vi.fn(async (_java: string, _args: string[], cwd: string) => {
      await writeFile(join(cwd, 'run.bat'), NEO_RUN_BAT)
      await writeFile(join(cwd, 'installer.jar.log'), 'log')
      return 0
    })
    const { deps, dl } = fakeProviderDeps({}, runJava)
    const spec = await runModLoaderInstaller(deps, installOpts(dir, '26.3'), 'https://maven.test/installer.jar')
    expect(dl.calls[0]).toMatchObject({ url: 'https://maven.test/installer.jar', dest: join(dir, 'installer.jar') })
    expect(runJava).toHaveBeenCalledWith(
      'C:/java/bin/java.exe',
      ['-jar', 'installer.jar', '--installServer'],
      dir,
      expect.any(Function)
    )
    expect(spec.args).toEqual(['@libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt'])
    expect(await pathExists(join(dir, 'installer.jar'))).toBe(false)
    expect(await pathExists(join(dir, 'installer.jar.log'))).toBe(false)
    expect(await readFile(join(dir, 'run.bat'), 'utf8')).toBe(NEO_RUN_BAT)
  })

  it('throws INSTALLER_FAILED on a non-zero exit code', async () => {
    const { deps } = fakeProviderDeps({}, async () => 1)
    await expect(
      runModLoaderInstaller(deps, installOpts(await tempDir(), '26.3'), 'https://maven.test/i.jar')
    ).rejects.toMatchObject({ code: 'INSTALLER_FAILED' })
  })
})
```

`src/main/providers/forge.test.ts`:
```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RunJava } from '../java/run'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createForgeProvider, FORGE_PROMOS, forgeVersionsFromPromos } from './forge'
import { FORGE_RUN_BAT } from './runBat.fixtures'

const promos = {
  '1.7.10-latest': '10.13.4.1614',
  '1.12.2-latest': '14.23.5.2860',
  '1.12.2-recommended': '14.23.5.2859',
  '1.21.11-latest': '61.2.4',
  '1.21.11-recommended': '61.2.0',
  '26.3-latest': '66.0.13'
}
const routes = { [FORGE_PROMOS]: { promos } }
const writesRunBat: RunJava = async (_java, _args, cwd) => {
  await writeFile(join(cwd, 'run.bat'), FORGE_RUN_BAT)
  return 0
}

describe('forge provider', () => {
  it('lists Minecraft versions >= 1.12.2, newest first', () => {
    expect(forgeVersionsFromPromos(promos)).toEqual([
      { id: '26.3', stable: true },
      { id: '1.21.11', stable: true },
      { id: '1.12.2', stable: true }
    ])
  })

  it('installs the latest Forge when no recommended build exists', async () => {
    const { deps, dl } = fakeProviderDeps(routes, writesRunBat)
    const spec = await createForgeProvider(deps).install(installOpts(await tempDir(), '26.3'))
    expect(dl.calls[0].url).toBe(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/26.3-66.0.13/forge-26.3-66.0.13-installer.jar'
    )
    expect(spec.args).toEqual(['@libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt'])
  })

  it('prefers the recommended Forge build', async () => {
    const { deps, dl } = fakeProviderDeps(routes, writesRunBat)
    await createForgeProvider(deps).install(installOpts(await tempDir(), '1.21.11'))
    expect(dl.calls[0].url).toContain('/1.21.11-61.2.0/')
  })

  it('rejects unknown Minecraft versions', async () => {
    const { deps } = fakeProviderDeps(routes, writesRunBat)
    await expect(
      createForgeProvider(deps).install(installOpts(await tempDir(), '9.9'))
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' })
  })
})
```

`src/main/providers/neoforge.test.ts`:
```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { NEO_RUN_BAT } from './runBat.fixtures'
import {
  createNeoForgeProvider,
  NEOFORGE_VERSIONS,
  neoForgeToMc,
  neoForgeVersions,
  pickNeoForge
} from './neoforge'

const all = ['20.4.253', '21.1.261', '21.1.262', '26.3.0.75-beta', '26.3.0.88', '26.4.0.1-beta']

describe('neoForgeToMc', () => {
  it.each([
    ['20.2.93', '1.20.2'],
    ['21.0.167', '1.21'],
    ['21.1.262', '1.21.1'],
    ['26.1.2.122', '26.1.2'],
    ['26.3.0.88', '26.3'],
    ['26.3.0.75-beta', '26.3'],
    ['0.25w14craftmine.5-beta', null]
  ])('%s -> %s', (neo, mc) => {
    expect(neoForgeToMc(neo)).toBe(mc)
  })
})

describe('neoforge provider', () => {
  it('groups NeoForge versions by Minecraft version, newest first', () => {
    expect(neoForgeVersions(all)).toEqual([
      { id: '26.4', stable: false },
      { id: '26.3', stable: true },
      { id: '1.21.1', stable: true },
      { id: '1.20.4', stable: true }
    ])
  })

  it('picks the newest non-beta build, falling back to the newest beta', () => {
    expect(pickNeoForge(all, '26.3')).toBe('26.3.0.88')
    expect(pickNeoForge(all, '1.21.1')).toBe('21.1.262')
    expect(pickNeoForge(all, '26.4')).toBe('26.4.0.1-beta')
    expect(pickNeoForge(all, '1.19')).toBeUndefined()
  })

  it('downloads and runs the matching installer', async () => {
    const { deps, dl } = fakeProviderDeps({ [NEOFORGE_VERSIONS]: { versions: all } }, async (_j, _a, cwd) => {
      await writeFile(join(cwd, 'run.bat'), NEO_RUN_BAT)
      return 0
    })
    await createNeoForgeProvider(deps).install(installOpts(await tempDir(), '1.21.1'))
    expect(dl.calls[0].url).toBe(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.262/neoforge-21.1.262-installer.jar'
    )
  })
})
```

`src/main/providers/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SERVER_TYPES } from '../../shared/types'
import { fakeProviderDeps } from '../test-utils'
import { createProviders } from './index'

describe('createProviders', () => {
  it('registers one provider per server type', () => {
    const providers = createProviders(fakeProviderDeps({}).deps)
    for (const type of SERVER_TYPES) expect(providers[type].type).toBe(type)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/providers`
Expected: FAIL with "Failed to resolve import" for `./modloader`, `./forge`, `./neoforge` and `./index`. The Task 7 provider tests still pass.

- [ ] **Step 3: Implement**

`src/main/providers/modloader.ts`:
```ts
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LaunchSpec } from '../../shared/types'
import { AppError } from '../errors'
import { pathExists } from '../util/fs'
import { percentReporter, type ProviderDeps, type ProviderInstallOptions } from './types'

/**
 * Reads the launch line written by modern Forge/NeoForge installers, e.g.
 * `java @user_jvm_args.txt @libraries/.../win_args.txt %*` -> ['@libraries/.../win_args.txt'].
 * We manage JVM args ourselves, so `@user_jvm_args.txt` and `%*` are dropped.
 */
export function parseRunBat(content: string): LaunchSpec | null {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^java\s/i.test(line) || !line.includes('@user_jvm_args.txt')) continue
    const args = line
      .split(/\s+/)
      .slice(1)
      .filter((token) => token !== '@user_jvm_args.txt' && token !== '%*')
    return { args }
  }
  return null
}

export async function resolveLaunchSpec(dir: string): Promise<LaunchSpec> {
  const runBat = join(dir, 'run.bat')
  if (await pathExists(runBat)) {
    const spec = parseRunBat(await readFile(runBat, 'utf8'))
    if (spec) return spec
  }
  // Legacy Forge (<= 1.16) installs a runnable forge-<version>.jar instead of run.bat.
  const jar = (await readdir(dir)).find(
    (file) => /^(forge|neoforge)-.+\.jar$/i.test(file) && !/installer|shim/i.test(file)
  )
  if (jar) return { args: ['-jar', jar] }
  throw new AppError('LAUNCH_NOT_FOUND', 'The installer finished but no server launch file was found')
}

export async function runModLoaderInstaller(
  deps: ProviderDeps,
  opts: ProviderInstallOptions,
  installerUrl: string
): Promise<LaunchSpec> {
  const installer = join(opts.dir, 'installer.jar')
  opts.onLog(`Downloading installer: ${installerUrl}`)
  await deps.download({ url: installerUrl, dest: installer, onProgress: percentReporter(opts.onProgress) })

  opts.onLog('Running installer. This can take a few minutes…')
  const code = await deps.runJava(
    opts.javaPath,
    ['-jar', 'installer.jar', '--installServer'],
    opts.dir,
    opts.onLog
  )
  if (code !== 0) throw new AppError('INSTALLER_FAILED', `The installer exited with code ${code}`)

  await rm(installer, { force: true })
  await rm(`${installer}.log`, { force: true })
  return resolveLaunchSpec(opts.dir)
}
```

`src/main/providers/forge.ts`:
```ts
import type { VersionInfo } from '../../shared/types'
import { AppError } from '../errors'
import { compareMcVersions } from '../util/mcVersion'
import { runModLoaderInstaller } from './modloader'
import type { ProviderDeps, ServerProvider } from './types'

export const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
// Older Forge releases use irregular version naming that the maven URL scheme below can't express.
const MIN_FORGE_MC = '1.12.2'

export function forgeVersionsFromPromos(promos: Record<string, string>): VersionInfo[] {
  const versions = new Set<string>()
  for (const key of Object.keys(promos)) {
    const match = /^(.+)-(latest|recommended)$/.exec(key)
    if (match && compareMcVersions(match[1], MIN_FORGE_MC) >= 0) versions.add(match[1])
  }
  return [...versions]
    .sort((a, b) => compareMcVersions(b, a))
    .map((id) => ({ id, stable: !/pre|rc|snapshot/i.test(id) }))
}

export function createForgeProvider(deps: ProviderDeps): ServerProvider {
  const promos = async (): Promise<Record<string, string>> =>
    (await deps.http.getJson<{ promos: Record<string, string> }>(FORGE_PROMOS)).promos

  return {
    type: 'forge',
    label: 'Forge',

    async listVersions() {
      return forgeVersionsFromPromos(await promos())
    },

    async install(opts) {
      const all = await promos()
      const forge = all[`${opts.version}-recommended`] ?? all[`${opts.version}-latest`]
      if (!forge) {
        throw new AppError('VERSION_NOT_FOUND', `Forge is not available for Minecraft ${opts.version}`)
      }
      const full = `${opts.version}-${forge}`
      opts.onLog(`Installing Forge ${forge} for Minecraft ${opts.version}`)
      return runModLoaderInstaller(deps, opts, `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`)
    }
  }
}
```

`src/main/providers/neoforge.ts`:
```ts
import type { VersionInfo } from '../../shared/types'
import { AppError } from '../errors'
import { compareMcVersions } from '../util/mcVersion'
import { runModLoaderInstaller } from './modloader'
import type { ProviderDeps, ServerProvider } from './types'

export const NEOFORGE_VERSIONS =
  'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'

/** "21.1.262" -> "1.21.1", "21.0.167" -> "1.21", "26.1.2.122" -> "26.1.2", "26.3.0.88" -> "26.3". */
export function neoForgeToMc(neo: string): string | null {
  const parts = neo.split('-')[0].split('.').map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN) || parts[0] < 20) return null
  const [major, minor, patch] = parts
  if (major >= 26) return parts.length >= 4 && patch !== 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}`
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`
}

const isBeta = (neo: string): boolean => neo.includes('-')
const byNeoVersion = (a: string, b: string): number => compareMcVersions(a.split('-')[0], b.split('-')[0])

export function pickNeoForge(all: string[], mc: string): string | undefined {
  const matches = all.filter((v) => neoForgeToMc(v) === mc).sort(byNeoVersion)
  return [...matches].reverse().find((v) => !isBeta(v)) ?? matches.at(-1)
}

export function neoForgeVersions(all: string[]): VersionInfo[] {
  const stableByMc = new Map<string, boolean>()
  for (const neo of all) {
    const mc = neoForgeToMc(neo)
    if (mc) stableByMc.set(mc, (stableByMc.get(mc) ?? false) || !isBeta(neo))
  }
  return [...stableByMc]
    .sort(([a], [b]) => compareMcVersions(b, a))
    .map(([id, stable]) => ({ id, stable }))
}

export function createNeoForgeProvider(deps: ProviderDeps): ServerProvider {
  const all = async (): Promise<string[]> =>
    (await deps.http.getJson<{ versions: string[] }>(NEOFORGE_VERSIONS)).versions

  return {
    type: 'neoforge',
    label: 'NeoForge',

    async listVersions() {
      return neoForgeVersions(await all())
    },

    async install(opts) {
      const neo = pickNeoForge(await all(), opts.version)
      if (!neo) {
        throw new AppError('VERSION_NOT_FOUND', `NeoForge is not available for Minecraft ${opts.version}`)
      }
      opts.onLog(`Installing NeoForge ${neo} for Minecraft ${opts.version}`)
      return runModLoaderInstaller(deps, opts, `${NEOFORGE_MAVEN}/${neo}/neoforge-${neo}-installer.jar`)
    }
  }
}
```

`src/main/providers/index.ts`:
```ts
import type { ServerType } from '../../shared/types'
import { createFabricProvider } from './fabric'
import { createForgeProvider } from './forge'
import { createNeoForgeProvider } from './neoforge'
import { createPaperProvider } from './paper'
import { createPurpurProvider } from './purpur'
import type { ProviderDeps, ServerProvider } from './types'
import { createVanillaProvider } from './vanilla'

export function createProviders(deps: ProviderDeps): Record<ServerType, ServerProvider> {
  return {
    vanilla: createVanillaProvider(deps),
    paper: createPaperProvider(deps),
    purpur: createPurpurProvider(deps),
    fabric: createFabricProvider(deps),
    forge: createForgeProvider(deps),
    neoforge: createNeoForgeProvider(deps)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/providers`
Expected: PASS (all provider tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/providers
git commit -m "feat: add Forge and NeoForge providers and provider registry"
```

---
### Task 9: server.properties parser and writer

**Files:**
- Create: `src/main/servers/properties.ts`
- Test: `src/main/servers/properties.test.ts`

**Interfaces:**
- Consumes: `PropertyEntry` (Task 2); `pathExists`, `writeFileAtomic`, `tempDir` (Task 4)
- Produces:
  - `interface PropertiesDoc` (opaque: `lines`, `eol`)
  - `parseProperties(text: string): PropertiesDoc`, `serializeProperties(doc: PropertiesDoc): string`
  - `getEntries(doc: PropertiesDoc): PropertyEntry[]`
  - `setEntries(doc: PropertiesDoc, entries: PropertyEntry[]): PropertiesDoc`: entries are the full desired list. Missing keys are removed, new keys are appended, and untouched lines keep their exact text.
  - `readPropertiesFile(dir: string): Promise<PropertyEntry[]>`: returns `[]` when there is no file
  - `writePropertiesFile(dir: string, entries: PropertyEntry[]): Promise<void>`
  - `updateProperties(dir: string, changes: Record<string, string>): Promise<void>`: sets the given keys and keeps everything else

- [ ] **Step 1: Write the failing test**

`src/main/servers/properties.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import {
  getEntries,
  parseProperties,
  readPropertiesFile,
  serializeProperties,
  setEntries,
  updateProperties
} from './properties'

const SAMPLE = [
  '#Minecraft server properties',
  '#Sat Oct 17 21:00:00 CEST 2026',
  'accepts-transfers=false',
  'motd=A Minecraft Server',
  'server-port=25565',
  'level-seed=',
  'white-list=false',
  ''
].join('\n')

describe('parseProperties / serializeProperties', () => {
  it('round-trips unchanged text exactly', () => {
    expect(serializeProperties(parseProperties(SAMPLE))).toBe(SAMPLE)
  })

  it('round-trips CRLF files', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    expect(serializeProperties(parseProperties(crlf))).toBe(crlf)
  })

  it('reads entries in file order', () => {
    expect(getEntries(parseProperties(SAMPLE))).toEqual([
      { key: 'accepts-transfers', value: 'false' },
      { key: 'motd', value: 'A Minecraft Server' },
      { key: 'server-port', value: '25565' },
      { key: 'level-seed', value: '' },
      { key: 'white-list', value: 'false' }
    ])
  })

  it('unescapes Java properties escapes', () => {
    expect(getEntries(parseProperties('motd=Hello\\: caf\\u00e9 \\#1\n'))).toEqual([
      { key: 'motd', value: 'Hello: café #1' }
    ])
  })

  it('accepts colon and whitespace separators', () => {
    expect(getEntries(parseProperties('a : 1\nb:2\nc   3\n'))).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' }
    ])
  })

  it('handles an empty file', () => {
    expect(serializeProperties(parseProperties(''))).toBe('')
  })
})

describe('setEntries', () => {
  it('edits in place, removes missing keys, appends new ones and escapes values', () => {
    const doc = setEntries(parseProperties(SAMPLE), [
      { key: 'motd', value: 'Hi: there é' },
      { key: 'server-port', value: '25566' },
      { key: 'level-seed', value: '' },
      { key: 'white-list', value: 'false' },
      { key: 'pvp', value: 'true' }
    ])
    expect(serializeProperties(doc)).toBe(
      [
        '#Minecraft server properties',
        '#Sat Oct 17 21:00:00 CEST 2026',
        'motd=Hi\\: there \\u00e9',
        'server-port=25566',
        'level-seed=',
        'white-list=false',
        'pvp=true',
        ''
      ].join('\n')
    )
  })
})

describe('file helpers', () => {
  it('readPropertiesFile returns [] when the file is missing', async () => {
    expect(await readPropertiesFile(await tempDir())).toEqual([])
  })

  it('updateProperties creates the file and merges later changes', async () => {
    const dir = await tempDir()
    await updateProperties(dir, { 'server-port': '25570', motd: 'x' })
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'server-port', value: '25570' },
      { key: 'motd', value: 'x' }
    ])
    await updateProperties(dir, { motd: 'y' })
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'server-port', value: '25570' },
      { key: 'motd', value: 'y' }
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/servers/properties.test.ts`
Expected: FAIL with "Failed to resolve import './properties'".

- [ ] **Step 3: Implement**

`src/main/servers/properties.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PropertyEntry } from '../../shared/types'
import { pathExists, writeFileAtomic } from '../util/fs'

type Line = { kind: 'raw'; text: string } | { kind: 'entry'; key: string; value: string; text: string }

export interface PropertiesDoc {
  lines: Line[]
  eol: string
}

const FILE = 'server.properties'
const SIMPLE_ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' }

function unescapeText(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, esc: string) =>
    esc.length === 5 ? String.fromCharCode(parseInt(esc.slice(1), 16)) : (SIMPLE_ESCAPES[esc] ?? esc)
  )
}

function escapeText(text: string, isKey: boolean): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = ch.charCodeAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\f') out += '\\f'
    else if ('=:#!'.includes(ch)) out += `\\${ch}`
    else if (ch === ' ' && (isKey || i === 0)) out += '\\ '
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out
}

function parseLine(text: string): Line {
  const t = text.trimStart()
  if (t === '' || t.startsWith('#') || t.startsWith('!')) return { kind: 'raw', text }
  let i = 0
  let key = ''
  while (i < t.length) {
    const ch = t[i]
    if (ch === '\\' && i + 1 < t.length) {
      key += t.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t') break
    key += ch
    i++
  }
  const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t'
  while (isSpace(t[i])) i++
  if (t[i] === '=' || t[i] === ':') i++
  while (isSpace(t[i])) i++
  return { kind: 'entry', key: unescapeText(key), value: unescapeText(t.slice(i)), text }
}

const entryLine = (key: string, value: string): Line => ({
  kind: 'entry',
  key,
  value,
  text: `${escapeText(key, true)}=${escapeText(value, false)}`
})

export function parseProperties(text: string): PropertiesDoc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const raw = text.length ? text.split(/\r?\n/) : []
  if (raw.length && raw[raw.length - 1] === '') raw.pop()
  return { eol, lines: raw.map(parseLine) }
}

export function serializeProperties(doc: PropertiesDoc): string {
  if (doc.lines.length === 0) return ''
  return doc.lines.map((line) => line.text).join(doc.eol) + doc.eol
}

export function getEntries(doc: PropertiesDoc): PropertyEntry[] {
  return doc.lines.flatMap((line) => (line.kind === 'entry' ? [{ key: line.key, value: line.value }] : []))
}

export function setEntries(doc: PropertiesDoc, entries: PropertyEntry[]): PropertiesDoc {
  const wanted = new Map(entries.map((e) => [e.key, e.value]))
  const lines: Line[] = []
  for (const line of doc.lines) {
    if (line.kind === 'raw') {
      lines.push(line)
      continue
    }
    const value = wanted.get(line.key)
    if (value === undefined) continue
    wanted.delete(line.key)
    lines.push(value === line.value ? line : entryLine(line.key, value))
  }
  for (const [key, value] of wanted) lines.push(entryLine(key, value))
  return { eol: doc.eol, lines }
}

async function readDoc(dir: string): Promise<PropertiesDoc> {
  const file = join(dir, FILE)
  return parseProperties((await pathExists(file)) ? await readFile(file, 'utf8') : '')
}

export async function readPropertiesFile(dir: string): Promise<PropertyEntry[]> {
  return getEntries(await readDoc(dir))
}

export async function writePropertiesFile(dir: string, entries: PropertyEntry[]): Promise<void> {
  const doc = setEntries(await readDoc(dir), entries)
  await writeFileAtomic(join(dir, FILE), serializeProperties(doc))
}

export async function updateProperties(dir: string, changes: Record<string, string>): Promise<void> {
  const current = await readPropertiesFile(dir)
  const merged = current.map((e) => (Object.hasOwn(changes, e.key) ? { key: e.key, value: changes[e.key] } : e))
  for (const [key, value] of Object.entries(changes)) {
    if (!current.some((e) => e.key === key)) merged.push({ key, value })
  }
  await writePropertiesFile(dir, merged)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/servers/properties.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/servers
git commit -m "feat: add comment-preserving server.properties parser and writer"
```

---

### Task 10: Server registry store

**Files:**
- Create: `src/main/servers/store.ts`
- Test: `src/main/servers/store.test.ts`

**Interfaces:**
- Consumes: `ServerRecord`, `AppError` (Task 2); `writeFileAtomic`, `tempDir` (Task 4)
- Produces: `class ServerStore { constructor(file: string); load(): Promise<void>; list(): ServerRecord[]; get(id: string): ServerRecord; add(rec: ServerRecord): Promise<void>; update(id: string, patch: Partial<Omit<ServerRecord, 'id'>>): Promise<ServerRecord>; remove(id: string): Promise<void> }`
  - `get`/`update` throw `AppError('NOT_FOUND')`. Every returned record is a deep copy.
  - On `load`, records left in `installing` (e.g. the app was closed mid-install) become `failed`. A corrupt file is renamed to `servers.json.corrupt-<timestamp>` and the store starts empty.

- [ ] **Step 1: Write the failing test**

`src/main/servers/store.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/servers/store.test.ts`
Expected: FAIL with "Failed to resolve import './store'".

- [ ] **Step 3: Implement**

`src/main/servers/store.ts`:
```ts
import { readFile, rename } from 'node:fs/promises'
import type { ServerRecord } from '../../shared/types'
import { AppError } from '../errors'
import { writeFileAtomic } from '../util/fs'

interface StoreFile {
  version: 1
  servers: ServerRecord[]
}

/** The servers.json registry. All reads are synchronous from memory; writes are serialized. */
export class ServerStore {
  private readonly file: string
  private servers: ServerRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.servers = []
        return
      }
      throw err
    }
    try {
      const data = JSON.parse(text) as StoreFile
      const servers = Array.isArray(data.servers) ? data.servers : []
      this.servers = servers.map((s) =>
        s.installState === 'installing' ? { ...s, installState: 'failed' } : s
      )
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`)
      this.servers = []
    }
  }

  list(): ServerRecord[] {
    return structuredClone(this.servers)
  }

  get(id: string): ServerRecord {
    return structuredClone(this.servers[this.indexOf(id)])
  }

  async add(rec: ServerRecord): Promise<void> {
    this.servers.push(structuredClone(rec))
    await this.save()
  }

  async update(id: string, patch: Partial<Omit<ServerRecord, 'id'>>): Promise<ServerRecord> {
    const index = this.indexOf(id)
    this.servers[index] = { ...this.servers[index], ...structuredClone(patch) }
    await this.save()
    return structuredClone(this.servers[index])
  }

  async remove(id: string): Promise<void> {
    this.servers = this.servers.filter((s) => s.id !== id)
    await this.save()
  }

  private indexOf(id: string): number {
    const index = this.servers.findIndex((s) => s.id === id)
    if (index < 0) throw new AppError('NOT_FOUND', 'Server not found')
    return index
  }

  private save(): Promise<void> {
    const data: StoreFile = { version: 1, servers: this.servers }
    const json = JSON.stringify(data, null, 2)
    this.writing = this.writing.catch(() => {}).then(() => writeFileAtomic(this.file, json))
    return this.writing
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/servers/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/servers
git commit -m "feat: add servers.json registry store"
```

---

### Task 11: Server installer (orchestrates Java, provider, EULA, initial config)

**Files:**
- Create: `src/main/servers/installer.ts`
- Test: `src/main/servers/installer.test.ts`

**Interfaces:**
- Consumes: `ServerStore` (Task 10); `ServerProvider` (Task 7); `JavaResolver['forInstall']` (Task 6); `readPropertiesFile`, `updateProperties` (Task 9); `isEmptyOrMissingDir` (Task 4); `CreateServerInput`, `InstallProgress`, `ServerRecord`, `ServerType` (Task 2)
- Produces:
  - `interface InstallerDeps { store: ServerStore; providers: Record<ServerType, ServerProvider>; java: Pick<JavaResolver, 'forInstall'>; emit: (p: InstallProgress) => void; newId?: () => string; now?: () => Date }`
  - `class ServerInstaller { constructor(deps); create(input: CreateServerInput): Promise<ServerRecord>; retry(id: string): Promise<ServerRecord>; isInstalling(id: string): boolean; waitFor(id: string): Promise<void>; getLog(id: string): string[] }`
  - `create` validates, saves the record as `installing`, starts the install in the background and returns immediately.
  - Error codes: `EULA_REQUIRED`, `NAME_TAKEN`, `DIR_IN_USE`, `DIR_NOT_EMPTY`, `INSTALLING`
  - Emits `InstallProgress` with steps `java` → `server` → (`installer` log lines) → `config` → `done`, or `error` carrying the failure message. Messages are also kept in `getLog(id)`, which holds the last 2,000 lines.

- [ ] **Step 1: Write the failing test**

`src/main/servers/installer.test.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CreateServerInput, InstallProgress, ServerType } from '../../shared/types'
import { AppError } from '../errors'
import type { ProviderInstallOptions, ServerProvider } from '../providers/types'
import { tempDir } from '../test-utils'
import { ServerInstaller } from './installer'
import { readPropertiesFile } from './properties'
import { ServerStore } from './store'

const ID = '11111111-1111-4111-8111-111111111111'

async function setup() {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const install = vi.fn(async (opts: ProviderInstallOptions) => {
    opts.onLog('installer says hi')
    opts.onProgress(50)
    await writeFile(join(opts.dir, 'server.jar'), 'jar')
    return { args: ['-jar', 'server.jar'] }
  })
  const provider: ServerProvider = { type: 'paper', label: 'Paper', listVersions: async () => [], install }
  const providers = { paper: provider } as unknown as Record<ServerType, ServerProvider>
  const java = { forInstall: vi.fn(async () => 'C:/java/bin/java.exe') }
  const events: InstallProgress[] = []
  const installer = new ServerInstaller({
    store,
    providers,
    java,
    emit: (e) => events.push(e),
    newId: () => ID,
    now: () => new Date('2026-10-17T12:00:00Z')
  })
  const input: CreateServerInput = {
    name: 'Survival',
    type: 'paper',
    mcVersion: '26.3',
    dir: join(root, 'servers', 'survival'),
    ramMb: 4096,
    port: 25565,
    eulaAccepted: true
  }
  return { root, store, install, java, events, installer, input }
}

describe('ServerInstaller', () => {
  it('saves an installing record, then installs in the background', async () => {
    const { store, events, installer, input } = await setup()
    const rec = await installer.create(input)
    expect(rec.installState).toBe('installing')
    expect(installer.isInstalling(ID)).toBe(true)
    await installer.waitFor(ID)
    expect(installer.isInstalling(ID)).toBe(false)

    expect(store.get(ID)).toMatchObject({
      installState: 'ready',
      launch: { args: ['-jar', 'server.jar'] },
      createdAt: '2026-10-17T12:00:00.000Z',
      jvmArgs: []
    })
    expect(await readFile(join(input.dir, 'eula.txt'), 'utf8')).toContain('eula=true')
    expect(await readPropertiesFile(input.dir)).toEqual([
      { key: 'server-port', value: '25565' },
      { key: 'motd', value: 'Survival - a Blockhost server' }
    ])
    expect(events.map((e) => e.step)).toEqual(
      expect.arrayContaining(['java', 'server', 'installer', 'config', 'done'])
    )
    expect(events.find((e) => e.percent === 50)?.step).toBe('server')
    expect(installer.getLog(ID)).toContain('installer says hi')
  })

  it('passes the resolved Java and version to the provider', async () => {
    const { install, installer, input } = await setup()
    await installer.create(input)
    await installer.waitFor(ID)
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ javaPath: 'C:/java/bin/java.exe', version: '26.3', dir: input.dir })
    )
  })

  it('marks the server failed and reports the error', async () => {
    const { store, install, events, installer, input } = await setup()
    install.mockRejectedValueOnce(new AppError('HTTP', 'Paper API is down'))
    await installer.create(input)
    await installer.waitFor(ID)
    expect(store.get(ID).installState).toBe('failed')
    expect(events.at(-1)).toEqual({ serverId: ID, step: 'error', message: 'Paper API is down' })
  })

  it('retry reinstalls a failed server', async () => {
    const { store, install, installer, input } = await setup()
    install.mockRejectedValueOnce(new Error('boom'))
    await installer.create(input)
    await installer.waitFor(ID)
    await installer.retry(ID)
    await installer.waitFor(ID)
    expect(store.get(ID).installState).toBe('ready')
  })

  it('validates EULA, unique names and empty folders', async () => {
    const { root, installer, input } = await setup()
    await expect(installer.create({ ...input, eulaAccepted: false })).rejects.toMatchObject({
      code: 'EULA_REQUIRED'
    })
    await installer.create(input)
    await installer.waitFor(ID)
    await expect(
      installer.create({ ...input, name: 'SURVIVAL', dir: join(root, 'other') })
    ).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(installer.create({ ...input, name: 'Other' })).rejects.toMatchObject({
      code: 'DIR_IN_USE'
    })
    const busy = join(root, 'busy')
    await mkdir(busy)
    await writeFile(join(busy, 'file.txt'), '')
    await expect(installer.create({ ...input, name: 'Busy', dir: busy })).rejects.toMatchObject({
      code: 'DIR_NOT_EMPTY'
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/servers/installer.test.ts`
Expected: FAIL with "Failed to resolve import './installer'".

- [ ] **Step 3: Implement**

`src/main/servers/installer.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  CreateServerInput,
  InstallProgress,
  InstallStep,
  ServerRecord,
  ServerType
} from '../../shared/types'
import { AppError } from '../errors'
import type { JavaResolver } from '../java/resolver'
import type { ServerProvider } from '../providers/types'
import { isEmptyOrMissingDir } from '../util/fs'
import { readPropertiesFile, updateProperties } from './properties'
import type { ServerStore } from './store'

export interface InstallerDeps {
  store: ServerStore
  providers: Record<ServerType, ServerProvider>
  java: Pick<JavaResolver, 'forInstall'>
  emit: (progress: InstallProgress) => void
  newId?: () => string
  now?: () => Date
}

const MAX_LOG_LINES = 2000
const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export class ServerInstaller {
  private readonly deps: InstallerDeps
  private readonly logs = new Map<string, string[]>()
  private readonly jobs = new Map<string, Promise<void>>()

  constructor(deps: InstallerDeps) {
    this.deps = deps
  }

  async create(input: CreateServerInput): Promise<ServerRecord> {
    if (!input.eulaAccepted) throw new AppError('EULA_REQUIRED', 'You must accept the Minecraft EULA')
    const name = input.name.trim()
    const existing = this.deps.store.list()
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError('NAME_TAKEN', `A server named "${name}" already exists`)
    }
    if (existing.some((s) => samePath(s.dir, input.dir))) {
      throw new AppError('DIR_IN_USE', 'Another server already uses this folder')
    }
    if (!(await isEmptyOrMissingDir(input.dir))) {
      throw new AppError('DIR_NOT_EMPTY', `The folder ${input.dir} is not empty`)
    }

    const rec: ServerRecord = {
      id: (this.deps.newId ?? randomUUID)(),
      name,
      type: input.type,
      mcVersion: input.mcVersion,
      build: input.build,
      dir: input.dir,
      ramMb: input.ramMb,
      port: input.port,
      jvmArgs: [],
      installState: 'installing',
      createdAt: (this.deps.now ?? (() => new Date()))().toISOString()
    }
    await this.deps.store.add(rec)
    this.startJob(rec.id)
    return rec
  }

  async retry(id: string): Promise<ServerRecord> {
    if (this.jobs.has(id)) throw new AppError('INSTALLING', 'This server is already installing')
    const rec = await this.deps.store.update(id, { installState: 'installing' })
    this.startJob(id)
    return rec
  }

  isInstalling(id: string): boolean {
    return this.jobs.has(id)
  }

  waitFor(id: string): Promise<void> {
    return this.jobs.get(id) ?? Promise.resolve()
  }

  getLog(id: string): string[] {
    return [...(this.logs.get(id) ?? [])]
  }

  private startJob(id: string): void {
    const job = this.run(id).finally(() => this.jobs.delete(id))
    this.jobs.set(id, job)
  }

  private async run(id: string): Promise<void> {
    const log: string[] = []
    this.logs.set(id, log)
    const report = (step: InstallStep, message: string, percent?: number): void => {
      if (message) {
        log.push(message)
        if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES)
      }
      this.deps.emit({ serverId: id, step, message, ...(percent === undefined ? {} : { percent }) })
    }

    try {
      const rec = this.deps.store.get(id)
      const provider = this.deps.providers[rec.type]
      await mkdir(rec.dir, { recursive: true })

      report('java', 'Preparing Java…')
      const javaPath = await this.deps.java.forInstall(rec, (pct) => report('java', '', pct))

      report('server', `Installing ${provider.label} ${rec.mcVersion}…`)
      const launch = await provider.install({
        dir: rec.dir,
        version: rec.mcVersion,
        build: rec.build,
        javaPath,
        onLog: (line) => report('installer', line),
        onProgress: (pct) => report('server', '', pct)
      })

      report('config', 'Writing eula.txt and server.properties…')
      await writeFile(
        join(rec.dir, 'eula.txt'),
        `# Accepted in Blockhost on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`
      )
      const hasMotd = (await readPropertiesFile(rec.dir)).some((e) => e.key === 'motd')
      await updateProperties(rec.dir, {
        'server-port': String(rec.port),
        ...(hasMotd ? {} : { motd: `${rec.name} - a Blockhost server` })
      })

      await this.deps.store.update(id, { launch, installState: 'ready' })
      report('done', 'Server installed')
    } catch (err) {
      await this.deps.store.update(id, { installState: 'failed' }).catch(() => {})
      report('error', err instanceof Error ? err.message : String(err))
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/servers/installer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/servers
git commit -m "feat: add server installer orchestrating Java, provider and initial config"
```

---

### Task 12: Process manager (spawn, status, log buffer, commands, stop/kill)

**Files:**
- Create: `src/main/servers/process.ts`
- Test: `src/main/servers/process.test.ts`

**Interfaces:**
- Consumes: `AppError`, `ServerRecord`, `ServerStatus`, `ServerStatusEvent`, `ServerLogEvent` (Task 2); `LineSplitter`, `Batcher`, `stripAnsi` (Task 3)
- Produces:
  - `interface ChildLike { pid?: number; stdout: Readable; stderr: Readable; stdin: Writable; on(event: 'close', listener: (code: number | null) => void): unknown; on(event: 'error', listener: (err: Error) => void): unknown }`
  - `type SpawnFn = (command: string, args: string[], cwd: string) => ChildLike`; `defaultSpawn: SpawnFn`; `killTree(pid: number): Promise<void>` (runs `taskkill /PID <pid> /T /F`)
  - `DONE_PATTERN: RegExp`; `buildJavaArgs(rec: ServerRecord): string[]` (throws `NOT_INSTALLED` when there is no `launch`)
  - `interface ProcessManagerDeps { spawn: SpawnFn; kill: (pid: number) => Promise<void>; onStatus: (e: ServerStatusEvent) => void; onLog: (e: ServerLogEvent) => void; batchMs?: number; maxLogLines?: number }`
  - `class ProcessManager { constructor(deps); status(id): ServerStatus; isActive(id): boolean; activeIds(): string[]; getLog(id): string[]; start(rec: ServerRecord, javaPath: string): void; sendCommand(id: string, command: string): void; stop(id: string): void; kill(id: string): Promise<void>; waitForExit(id: string, timeoutMs: number): Promise<boolean> }`
  - Status flow: `starting` on spawn, `running` when a line matches `DONE_PATTERN`, `stopping` after `stop()`, then `stopped` if the stop was requested or `crashed` if the process exited on its own. Errors: `ALREADY_RUNNING`, `NOT_RUNNING`.

- [ ] **Step 1: Write the failing test**

`src/main/servers/process.test.ts`:
```ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ServerLogEvent, ServerRecord, ServerStatus } from '../../shared/types'
import { buildJavaArgs, DONE_PATTERN, ProcessManager, type ChildLike } from './process'

class FakeChild extends EventEmitter {
  pid = 4242
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  written: string[] = []

  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => this.written.push(d))
  }

  exit(code: number): void {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code)
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const rec: ServerRecord = {
  id: 's1',
  name: 'Survival',
  type: 'paper',
  mcVersion: '26.3',
  dir: 'C:/servers/s1',
  ramMb: 4096,
  port: 25565,
  jvmArgs: ['-XX:+UseG1GC'],
  launch: { args: ['-jar', 'server.jar'] },
  installState: 'ready',
  createdAt: '2026-10-17T12:00:00.000Z'
}

function setup() {
  const child = new FakeChild()
  const spawn = vi.fn((_cmd: string, _args: string[], _cwd: string) => child as unknown as ChildLike)
  const kill = vi.fn(async () => {})
  const statuses: ServerStatus[] = []
  const logs: ServerLogEvent[] = []
  const manager = new ProcessManager({
    spawn,
    kill,
    onStatus: (e) => statuses.push(e.status),
    onLog: (e) => logs.push(e),
    batchMs: 0
  })
  return { child, spawn, kill, statuses, logs, manager }
}

describe('buildJavaArgs', () => {
  it('builds memory, encoding, extra and launch arguments', () => {
    expect(buildJavaArgs(rec)).toEqual([
      '-Xms2048M',
      '-Xmx4096M',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      '-XX:+UseG1GC',
      '-jar',
      'server.jar',
      'nogui'
    ])
  })

  it('throws NOT_INSTALLED without a launch spec', () => {
    expect(() => buildJavaArgs({ ...rec, launch: undefined })).toThrow(
      expect.objectContaining({ code: 'NOT_INSTALLED' })
    )
  })
})

describe('DONE_PATTERN', () => {
  it('matches Vanilla/Paper and Forge style done lines', () => {
    expect(DONE_PATTERN.test('[12:00:01 INFO]: Done (3.214s)! For help, type "help"')).toBe(true)
    expect(DONE_PATTERN.test('[Server thread/INFO]: Done (12,5s)! For help, type "help"')).toBe(true)
    expect(DONE_PATTERN.test('Preparing spawn area')).toBe(false)
  })
})

describe('ProcessManager', () => {
  it('spawns Java in the server folder and goes starting -> running', async () => {
    const { child, spawn, statuses, manager } = setup()
    manager.start(rec, 'C:/java/bin/java.exe')
    expect(spawn).toHaveBeenCalledWith('C:/java/bin/java.exe', buildJavaArgs(rec), 'C:/servers/s1')
    expect(manager.status('s1')).toBe('starting')
    child.stdout.write('\u001b[32m[12:00:01 INFO]: Done (3.2s)! For help, type "help"\u001b[0m\n')
    await tick()
    expect(manager.status('s1')).toBe('running')
    expect(statuses).toEqual(['starting', 'running'])
    expect(manager.getLog('s1').at(-1)).toBe('[12:00:01 INFO]: Done (3.2s)! For help, type "help"')
  })

  it('streams batched log lines', async () => {
    const { child, logs, manager } = setup()
    manager.start(rec, 'java')
    child.stdout.write('one\ntwo\n')
    child.stderr.write('three\n')
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(logs.flatMap((e) => e.lines)).toEqual(expect.arrayContaining(['one', 'two', 'three']))
    expect(logs.every((e) => e.serverId === 's1')).toBe(true)
  })

  it('sends commands to stdin and echoes them in the log', async () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    manager.sendCommand('s1', 'say hi')
    await tick()
    expect(child.written.join('')).toBe('say hi\n')
    expect(manager.getLog('s1')).toContain('> say hi')
  })

  it('rejects commands when not running', () => {
    const { manager } = setup()
    expect(() => manager.sendCommand('s1', 'list')).toThrow(expect.objectContaining({ code: 'NOT_RUNNING' }))
  })

  it('stops gracefully with "stop" and reports stopped', async () => {
    const { child, statuses, manager } = setup()
    manager.start(rec, 'java')
    manager.stop('s1')
    await tick()
    expect(child.written.join('')).toBe('stop\n')
    expect(manager.status('s1')).toBe('stopping')
    const exited = manager.waitForExit('s1', 1000)
    child.exit(0)
    expect(await exited).toBe(true)
    expect(manager.status('s1')).toBe('stopped')
    expect(statuses).toEqual(['starting', 'stopping', 'stopped'])
    expect(manager.isActive('s1')).toBe(false)
  })

  it('reports crashed on an unexpected exit', () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    child.exit(1)
    expect(manager.status('s1')).toBe('crashed')
    expect(manager.getLog('s1').at(-1)).toContain('exited with code 1')
  })

  it('waitForExit times out while the process keeps running', async () => {
    const { manager } = setup()
    manager.start(rec, 'java')
    expect(await manager.waitForExit('s1', 10)).toBe(false)
  })

  it('kill force-kills the process tree', async () => {
    const { child, kill, manager } = setup()
    manager.start(rec, 'java')
    await manager.kill('s1')
    expect(kill).toHaveBeenCalledWith(4242)
    child.exit(1)
    expect(manager.status('s1')).toBe('stopped')
  })

  it('refuses to start twice and tracks active ids', () => {
    const { manager } = setup()
    manager.start(rec, 'java')
    expect(manager.activeIds()).toEqual(['s1'])
    expect(() => manager.start(rec, 'java')).toThrow(expect.objectContaining({ code: 'ALREADY_RUNNING' }))
  })

  it('keeps only the newest maxLogLines lines', async () => {
    const child = new FakeChild()
    const manager = new ProcessManager({
      spawn: () => child as unknown as ChildLike,
      kill: async () => {},
      onStatus: () => {},
      onLog: () => {},
      batchMs: 0,
      maxLogLines: 3
    })
    manager.start(rec, 'java')
    child.stdout.write('a\nb\nc\nd\ne\n')
    await tick()
    expect(manager.getLog('s1')).toEqual(['c', 'd', 'e'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/servers/process.test.ts`
Expected: FAIL with "Failed to resolve import './process'".

- [ ] **Step 3: Implement**

`src/main/servers/process.ts`:
```ts
import { execFile, spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { ServerLogEvent, ServerRecord, ServerStatus, ServerStatusEvent } from '../../shared/types'
import { AppError } from '../errors'
import { stripAnsi } from '../util/ansi'
import { Batcher } from '../util/batcher'
import { LineSplitter } from '../util/lines'

export interface ChildLike {
  pid?: number
  stdout: Readable
  stderr: Readable
  stdin: Writable
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

export type SpawnFn = (command: string, args: string[], cwd: string) => ChildLike

export const defaultSpawn: SpawnFn = (command, args, cwd) =>
  spawn(command, args, { cwd, windowsHide: true })

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

export const DONE_PATTERN = /Done \(\d+(?:[.,]\d+)?s\)!/

export function buildJavaArgs(rec: ServerRecord): string[] {
  if (!rec.launch) throw new AppError('NOT_INSTALLED', 'This server has not finished installing')
  return [
    `-Xms${Math.max(256, Math.floor(rec.ramMb / 2))}M`,
    `-Xmx${rec.ramMb}M`,
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    ...rec.jvmArgs,
    ...rec.launch.args,
    'nogui'
  ]
}

export interface ProcessManagerDeps {
  spawn: SpawnFn
  kill: (pid: number) => Promise<void>
  onStatus: (event: ServerStatusEvent) => void
  onLog: (event: ServerLogEvent) => void
  batchMs?: number
  maxLogLines?: number
}

interface Entry {
  child: ChildLike | null
  status: ServerStatus
  log: string[]
  stopRequested: boolean
  exitWaiters: (() => void)[]
  batcher: Batcher<string>
}

export class ProcessManager {
  private readonly deps: ProcessManagerDeps
  private readonly maxLogLines: number
  private readonly entries = new Map<string, Entry>()

  constructor(deps: ProcessManagerDeps) {
    this.deps = deps
    this.maxLogLines = deps.maxLogLines ?? 5000
  }

  status(id: string): ServerStatus {
    return this.entries.get(id)?.status ?? 'stopped'
  }

  isActive(id: string): boolean {
    return this.entries.get(id)?.child != null
  }

  activeIds(): string[] {
    return [...this.entries].filter(([, e]) => e.child).map(([id]) => id)
  }

  getLog(id: string): string[] {
    return (this.entries.get(id)?.log ?? []).slice(-this.maxLogLines)
  }

  start(rec: ServerRecord, javaPath: string): void {
    if (this.isActive(rec.id)) throw new AppError('ALREADY_RUNNING', 'The server is already running')
    const args = buildJavaArgs(rec)
    const entry = this.entry(rec.id)
    entry.stopRequested = false
    this.append(rec.id, `[Blockhost] Starting: "${javaPath}" ${args.join(' ')}`)

    const child = this.deps.spawn(javaPath, args, rec.dir)
    entry.child = child
    this.setStatus(rec.id, 'starting')

    const onLine = (line: string): void => {
      const clean = stripAnsi(line)
      this.append(rec.id, clean)
      if (entry.status === 'starting' && DONE_PATTERN.test(clean)) this.setStatus(rec.id, 'running')
    }
    const stdout = new LineSplitter(onLine)
    const stderr = new LineSplitter(onLine)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.on('data', (chunk: string) => stderr.push(chunk))

    let finished = false
    const finish = (message: string): void => {
      if (finished) return
      finished = true
      stdout.flush()
      stderr.flush()
      this.append(rec.id, message)
      entry.child = null
      this.setStatus(rec.id, entry.stopRequested ? 'stopped' : 'crashed')
      entry.batcher.flush()
      const waiters = entry.exitWaiters
      entry.exitWaiters = []
      for (const resolve of waiters) resolve()
    }
    child.on('close', (code) => finish(`[Blockhost] Server exited with code ${code}`))
    child.on('error', (err) => finish(`[Blockhost] Failed to start Java: ${err.message}`))
  }

  sendCommand(id: string, command: string): void {
    const child = this.entries.get(id)?.child
    if (!child) throw new AppError('NOT_RUNNING', 'The server is not running')
    this.append(id, `> ${command}`)
    child.stdin.write(`${command}\n`)
  }

  stop(id: string): void {
    const entry = this.entries.get(id)
    if (!entry?.child) return
    entry.stopRequested = true
    this.setStatus(id, 'stopping')
    entry.child.stdin.write('stop\n')
  }

  async kill(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry?.child) return
    entry.stopRequested = true
    if (entry.child.pid) await this.deps.kill(entry.child.pid)
  }

  waitForExit(id: string, timeoutMs: number): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry?.child) return Promise.resolve(true)
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined
      const done = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      timer = setTimeout(() => {
        entry.exitWaiters = entry.exitWaiters.filter((w) => w !== done)
        resolve(false)
      }, timeoutMs)
      entry.exitWaiters.push(done)
    })
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        child: null,
        status: 'stopped',
        log: [],
        stopRequested: false,
        exitWaiters: [],
        batcher: new Batcher<string>(this.deps.batchMs ?? 50, (lines) =>
          this.deps.onLog({ serverId: id, lines })
        )
      }
      this.entries.set(id, entry)
    }
    return entry
  }

  private append(id: string, line: string): void {
    const entry = this.entry(id)
    entry.log.push(line)
    if (entry.log.length > this.maxLogLines) entry.log.splice(0, entry.log.length - this.maxLogLines)
    entry.batcher.push(line)
  }

  private setStatus(id: string, status: ServerStatus): void {
    const entry = this.entry(id)
    if (entry.status === status) return
    entry.status = status
    this.deps.onStatus({ serverId: id, status })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/servers/process.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/servers
git commit -m "feat: add server process manager with status tracking and log buffer"
```

---

### Task 13: Network helpers (port check, LAN/public IP)

**Files:**
- Create: `src/main/net/port.ts`, `src/main/net/ip.ts`
- Test: `src/main/net/port.test.ts`, `src/main/net/ip.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `fakeHttp` (Task 4)
- Produces: `isPortFree(port: number, host?: string): Promise<boolean>`; `lanIps(ifaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): string[]`; `PUBLIC_IP_URL`; `publicIp(http: HttpClient): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

`src/main/net/port.test.ts`:
```ts
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortFree } from './port'

describe('isPortFree', () => {
  it('detects a port in use and free again after closing', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
    const { port } = server.address() as AddressInfo
    expect(await isPortFree(port)).toBe(false)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(await isPortFree(port)).toBe(true)
  })
})
```

`src/main/net/ip.test.ts`:
```ts
import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { fakeHttp } from '../test-utils'
import { lanIps, PUBLIC_IP_URL, publicIp } from './ip'

function iface(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  return { address, family, internal, netmask: '', mac: '', cidr: null } as NetworkInterfaceInfo
}

describe('lanIps', () => {
  it('returns external IPv4 addresses, skipping loopback, IPv6 and link-local', () => {
    expect(
      lanIps({
        Ethernet: [iface('192.168.1.20', 'IPv4'), iface('fe80::1', 'IPv6')],
        Loopback: [iface('127.0.0.1', 'IPv4', true)],
        Other: [iface('169.254.10.2', 'IPv4')]
      })
    ).toEqual(['192.168.1.20'])
  })
})

describe('publicIp', () => {
  it('returns the trimmed IPv4 address', async () => {
    expect(await publicIp(fakeHttp({ [PUBLIC_IP_URL]: '46.249.161.2\n' }))).toBe('46.249.161.2')
  })

  it('returns null for errors or unexpected content', async () => {
    expect(await publicIp(fakeHttp({}))).toBeNull()
    expect(await publicIp(fakeHttp({ [PUBLIC_IP_URL]: '<html>' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/net/port.test.ts src/main/net/ip.test.ts`
Expected: FAIL with "Failed to resolve import" for `./port` and `./ip`.

- [ ] **Step 3: Implement**

`src/main/net/port.ts`:
```ts
import { createServer } from 'node:net'

/** True if nothing is listening on the port (Minecraft binds all interfaces, so we test 0.0.0.0). */
export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}
```

`src/main/net/ip.ts`:
```ts
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { HttpClient } from './http'

export const PUBLIC_IP_URL = 'https://api.ipify.org'

export function lanIps(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        out.push(addr.address)
      }
    }
  }
  return out
}

export async function publicIp(http: HttpClient): Promise<string | null> {
  try {
    const text = (await http.getText(PUBLIC_IP_URL)).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/net`
Expected: PASS (http, download, port, ip).

- [ ] **Step 5: Commit**

```bash
git add src/main/net
git commit -m "feat: add port availability check and LAN/public IP helpers"
```

---

### Task 14: Server service (the operations the UI calls)

**Files:**
- Create: `src/main/servers/service.ts`
- Test: `src/main/servers/service.test.ts`

**Interfaces:**
- Consumes: `ServerStore` (Task 10); `ServerInstaller` (Task 11); `ProcessManager` (Task 12); `JavaResolver` (Task 6); `readPropertiesFile`, `writePropertiesFile`, `updateProperties` (Task 9); shared types (Task 2)
- Produces:
  - `interface ServerServiceDeps { store: ServerStore; installer: Pick<ServerInstaller, 'create' | 'retry' | 'isInstalling'>; processes: Pick<ProcessManager, 'status' | 'isActive' | 'start' | 'stop' | 'kill' | 'waitForExit' | 'sendCommand' | 'getLog'>; java: Pick<JavaResolver, 'forStart' | 'requiredMajor'>; probeJava: (path: string) => Promise<number | null>; isPortFree: (port: number) => Promise<boolean>; removeDir: (dir: string) => Promise<void> }`
  - `class ServerService` with these methods:
    - Java approval: `approveJavaPath(path)`
    - Queries: `list(): ServerView[]`, `getLog(id): string[]`, `dir(id): string`
    - Lifecycle: `create(input): Promise<ServerView>`, `retryInstall(id): Promise<ServerView>`, `update(id, patch: ServerPatch): Promise<UpdateResult>`, `remove(id, keepFiles): Promise<void>`
    - Running: `start(id): Promise<void>`, `stop(id): void`, `restart(id): Promise<void>`, `kill(id): Promise<void>`, `sendCommand(id, cmd): void`
    - Properties: `readProperties(id): Promise<PropertyEntry[]>`, `writeProperties(id, entries): Promise<void>`
  - Error codes: `NOT_INSTALLED`, `ALREADY_RUNNING`, `PORT_IN_USE` (`details.port`), `STOP_TIMEOUT`, `NAME_TAKEN`, `JAVA_NOT_APPROVED`, `JAVA_INVALID`, `SERVER_RUNNING`, `INSTALLING`
  - `RESTART_STOP_TIMEOUT_MS = 30_000`

- [ ] **Step 1: Write the failing test**

`src/main/servers/service.test.ts`:
```ts
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ServerRecord, ServerStatus } from '../../shared/types'
import { AppError } from '../errors'
import { tempDir } from '../test-utils'
import { readPropertiesFile, writePropertiesFile } from './properties'
import { ServerService } from './service'
import { ServerStore } from './store'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function setup() {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const dir = join(root, 'srv')
  await mkdir(dir)
  const rec: ServerRecord = {
    id: ID,
    name: 'Survival',
    type: 'paper',
    mcVersion: '26.3',
    dir,
    ramMb: 2048,
    port: 25565,
    jvmArgs: [],
    launch: { args: ['-jar', 'server.jar'] },
    installState: 'ready',
    createdAt: '2026-10-17T12:00:00.000Z'
  }
  await store.add(rec)
  const processes = {
    status: vi.fn((): ServerStatus => 'stopped'),
    isActive: vi.fn(() => false),
    start: vi.fn(),
    stop: vi.fn(),
    kill: vi.fn(async () => {}),
    waitForExit: vi.fn(async () => true),
    sendCommand: vi.fn(),
    getLog: vi.fn((): string[] => [])
  }
  const installer = { create: vi.fn(), retry: vi.fn(), isInstalling: vi.fn(() => false) }
  const java = {
    forStart: vi.fn(async () => 'C:/java/bin/java.exe'),
    requiredMajor: vi.fn(async () => 25)
  }
  const probeJava = vi.fn(async (): Promise<number | null> => 25)
  const isPortFree = vi.fn(async () => true)
  const removeDir = vi.fn(async () => {})
  const service = new ServerService({ store, installer, processes, java, probeJava, isPortFree, removeDir })
  return { store, dir, rec, processes, installer, java, probeJava, isPortFree, removeDir, service }
}

describe('ServerService', () => {
  it('lists servers with their live status', async () => {
    const { processes, service } = await setup()
    processes.status.mockReturnValue('running')
    expect(service.list()).toEqual([expect.objectContaining({ id: ID, status: 'running' })])
  })

  it('starts a ready server with the resolved Java', async () => {
    const { processes, service } = await setup()
    await service.start(ID)
    expect(processes.start).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), 'C:/java/bin/java.exe')
  })

  it('refuses to start when the port is taken', async () => {
    const { processes, isPortFree, service } = await setup()
    isPortFree.mockResolvedValue(false)
    await expect(service.start(ID)).rejects.toMatchObject({ code: 'PORT_IN_USE', details: { port: 25565 } })
    expect(processes.start).not.toHaveBeenCalled()
  })

  it('refuses to start an unfinished install', async () => {
    const { store, service } = await setup()
    await store.update(ID, { installState: 'failed' })
    await expect(service.start(ID)).rejects.toMatchObject({ code: 'NOT_INSTALLED' })
  })

  it('propagates JAVA_MISSING from the resolver', async () => {
    const { java, service } = await setup()
    java.forStart.mockRejectedValue(new AppError('JAVA_MISSING', 'Java 25 is not installed', { major: 25 }))
    await expect(service.start(ID)).rejects.toMatchObject({ code: 'JAVA_MISSING' })
  })

  it('restart stops, waits, then starts', async () => {
    const { processes, service } = await setup()
    processes.isActive.mockReturnValueOnce(true).mockReturnValue(false)
    await service.restart(ID)
    expect(processes.stop).toHaveBeenCalledWith(ID)
    expect(processes.waitForExit).toHaveBeenCalledWith(ID, 30_000)
    expect(processes.start).toHaveBeenCalled()
  })

  it('restart fails with STOP_TIMEOUT if the server will not stop', async () => {
    const { processes, service } = await setup()
    processes.isActive.mockReturnValue(true)
    processes.waitForExit.mockResolvedValue(false)
    await expect(service.restart(ID)).rejects.toMatchObject({ code: 'STOP_TIMEOUT' })
    expect(processes.start).not.toHaveBeenCalled()
  })

  it('rejects a custom Java path that did not come from the picker', async () => {
    const { service } = await setup()
    await expect(service.update(ID, { javaPath: 'C:/evil.exe' })).rejects.toMatchObject({
      code: 'JAVA_NOT_APPROVED'
    })
  })

  it('accepts an approved Java path and warns when it is too old', async () => {
    const { probeJava, service } = await setup()
    probeJava.mockResolvedValue(17)
    service.approveJavaPath('D:/jdk17/bin/java.exe')
    const result = await service.update(ID, { javaPath: 'D:/jdk17/bin/java.exe' })
    expect(result.server.javaPath).toBe('D:/jdk17/bin/java.exe')
    expect(result.warning).toContain('Java 25')
    const cleared = await service.update(ID, { javaPath: null })
    expect(cleared.server.javaPath).toBeUndefined()
  })

  it('rejects an approved Java path that does not run', async () => {
    const { probeJava, service } = await setup()
    probeJava.mockResolvedValue(null)
    service.approveJavaPath('D:/broken.exe')
    await expect(service.update(ID, { javaPath: 'D:/broken.exe' })).rejects.toMatchObject({
      code: 'JAVA_INVALID'
    })
  })

  it('writes a changed port into server.properties', async () => {
    const { dir, service } = await setup()
    const result = await service.update(ID, { port: 25570, ramMb: 4096 })
    expect(result.server).toMatchObject({ port: 25570, ramMb: 4096 })
    expect(await readPropertiesFile(dir)).toEqual([{ key: 'server-port', value: '25570' }])
  })

  it('rejects renaming to an existing name', async () => {
    const { store, rec, service } = await setup()
    await store.add({ ...rec, id: 'other', name: 'Creative', dir: 'C:/x' })
    await expect(service.update(ID, { name: 'creative' })).rejects.toMatchObject({ code: 'NAME_TAKEN' })
  })

  it('syncs server-port from properties back to the record', async () => {
    const { store, dir, service } = await setup()
    await writePropertiesFile(dir, [{ key: 'server-port', value: '25580' }])
    await service.writeProperties(ID, [{ key: 'server-port', value: '25590' }])
    expect(store.get(ID).port).toBe(25590)
  })

  it('removes a server but keeps its files when asked', async () => {
    const { store, removeDir, service } = await setup()
    await service.remove(ID, true)
    expect(store.list()).toEqual([])
    expect(removeDir).not.toHaveBeenCalled()
  })

  it('removes a server and deletes its folder', async () => {
    const { store, dir, removeDir, service } = await setup()
    await service.remove(ID, false)
    expect(store.list()).toEqual([])
    expect(removeDir).toHaveBeenCalledWith(dir)
  })

  it('refuses to remove a running or installing server', async () => {
    const { processes, installer, service } = await setup()
    processes.isActive.mockReturnValue(true)
    await expect(service.remove(ID, false)).rejects.toMatchObject({ code: 'SERVER_RUNNING' })
    processes.isActive.mockReturnValue(false)
    installer.isInstalling.mockReturnValue(true)
    await expect(service.remove(ID, false)).rejects.toMatchObject({ code: 'INSTALLING' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/servers/service.test.ts`
Expected: FAIL with "Failed to resolve import './service'".

- [ ] **Step 3: Implement**

`src/main/servers/service.ts`:
```ts
import type {
  CreateServerInput,
  PropertyEntry,
  ServerPatch,
  ServerRecord,
  ServerView,
  UpdateResult
} from '../../shared/types'
import { AppError } from '../errors'
import type { JavaResolver } from '../java/resolver'
import type { ServerInstaller } from './installer'
import type { ProcessManager } from './process'
import { readPropertiesFile, updateProperties, writePropertiesFile } from './properties'
import type { ServerStore } from './store'

export const RESTART_STOP_TIMEOUT_MS = 30_000

export interface ServerServiceDeps {
  store: ServerStore
  installer: Pick<ServerInstaller, 'create' | 'retry' | 'isInstalling'>
  processes: Pick<
    ProcessManager,
    'status' | 'isActive' | 'start' | 'stop' | 'kill' | 'waitForExit' | 'sendCommand' | 'getLog'
  >
  java: Pick<JavaResolver, 'forStart' | 'requiredMajor'>
  probeJava: (javaPath: string) => Promise<number | null>
  isPortFree: (port: number) => Promise<boolean>
  removeDir: (dir: string) => Promise<void>
}

export class ServerService {
  private readonly deps: ServerServiceDeps
  private readonly approvedJavaPaths = new Set<string>()

  constructor(deps: ServerServiceDeps) {
    this.deps = deps
  }

  /** Called by the main-process file picker; only these paths may become a custom Java. */
  approveJavaPath(path: string): void {
    this.approvedJavaPaths.add(path)
  }

  list(): ServerView[] {
    return this.deps.store.list().map((rec) => this.view(rec))
  }

  dir(id: string): string {
    return this.deps.store.get(id).dir
  }

  getLog(id: string): string[] {
    this.deps.store.get(id)
    return this.deps.processes.getLog(id)
  }

  async create(input: CreateServerInput): Promise<ServerView> {
    return this.view(await this.deps.installer.create(input))
  }

  async retryInstall(id: string): Promise<ServerView> {
    return this.view(await this.deps.installer.retry(id))
  }

  async update(id: string, patch: ServerPatch): Promise<UpdateResult> {
    const rec = this.deps.store.get(id)
    let warning: string | undefined

    if (patch.name !== undefined) {
      const name = patch.name.trim()
      const taken = this.deps.store
        .list()
        .some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())
      if (taken) throw new AppError('NAME_TAKEN', `A server named "${name}" already exists`)
    }

    let javaPath = rec.javaPath
    if (patch.javaPath === null) {
      javaPath = undefined
    } else if (patch.javaPath !== undefined && patch.javaPath !== rec.javaPath) {
      if (!this.approvedJavaPaths.has(patch.javaPath)) {
        throw new AppError('JAVA_NOT_APPROVED', 'Choose the Java executable with the Browse button')
      }
      const major = await this.deps.probeJava(patch.javaPath)
      if (major === null) throw new AppError('JAVA_INVALID', `${patch.javaPath} is not a working Java`)
      const required = await this.deps.java.requiredMajor(rec.mcVersion)
      if (major < required) {
        warning = `This Java is version ${major}, but Minecraft ${rec.mcVersion} needs Java ${required}. The server may not start.`
      }
      javaPath = patch.javaPath
    }

    if (patch.port !== undefined && patch.port !== rec.port && rec.installState === 'ready') {
      await updateProperties(rec.dir, { 'server-port': String(patch.port) })
    }

    const updated = await this.deps.store.update(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.ramMb !== undefined ? { ramMb: patch.ramMb } : {}),
      ...(patch.port !== undefined ? { port: patch.port } : {}),
      ...(patch.jvmArgs !== undefined ? { jvmArgs: patch.jvmArgs } : {}),
      javaPath
    })
    return { server: this.view(updated), ...(warning ? { warning } : {}) }
  }

  async remove(id: string, keepFiles: boolean): Promise<void> {
    if (this.deps.processes.isActive(id)) {
      throw new AppError('SERVER_RUNNING', 'Stop the server before deleting it')
    }
    if (this.deps.installer.isInstalling(id)) {
      throw new AppError('INSTALLING', 'Wait for the installation to finish before deleting')
    }
    const rec = this.deps.store.get(id)
    await this.deps.store.remove(id)
    if (!keepFiles) await this.deps.removeDir(rec.dir)
  }

  async start(id: string): Promise<void> {
    const rec = this.deps.store.get(id)
    if (rec.installState !== 'ready' || !rec.launch) {
      throw new AppError('NOT_INSTALLED', 'This server has not finished installing')
    }
    if (this.deps.processes.isActive(id)) {
      throw new AppError('ALREADY_RUNNING', 'The server is already running')
    }
    if (!(await this.deps.isPortFree(rec.port))) {
      throw new AppError('PORT_IN_USE', `Port ${rec.port} is already in use by another program`, {
        port: rec.port
      })
    }
    const javaPath = await this.deps.java.forStart(rec)
    this.deps.processes.start(rec, javaPath)
  }

  stop(id: string): void {
    this.deps.processes.stop(id)
  }

  async restart(id: string): Promise<void> {
    if (this.deps.processes.isActive(id)) {
      this.deps.processes.stop(id)
      const stopped = await this.deps.processes.waitForExit(id, RESTART_STOP_TIMEOUT_MS)
      if (!stopped) throw new AppError('STOP_TIMEOUT', 'The server did not stop within 30 seconds')
    }
    await this.start(id)
  }

  kill(id: string): Promise<void> {
    return this.deps.processes.kill(id)
  }

  sendCommand(id: string, command: string): void {
    this.deps.processes.sendCommand(id, command)
  }

  readProperties(id: string): Promise<PropertyEntry[]> {
    return readPropertiesFile(this.deps.store.get(id).dir)
  }

  async writeProperties(id: string, entries: PropertyEntry[]): Promise<void> {
    const rec = this.deps.store.get(id)
    await writePropertiesFile(rec.dir, entries)
    const portValue = entries.find((e) => e.key === 'server-port')?.value
    const port = portValue && /^\d+$/.test(portValue) ? Number(portValue) : NaN
    if (port >= 1 && port <= 65535 && port !== rec.port) await this.deps.store.update(id, { port })
  }

  private view(rec: ServerRecord): ServerView {
    return { ...rec, status: this.deps.processes.status(rec.id) }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/servers/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (all main-process tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/servers
git commit -m "feat: add server service with start/stop, settings and properties operations"
```

---
### Task 15: IPC layer: schemas, handlers, composition root, preload bridge, app lifecycle

**Files:**
- Create: `src/shared/api.ts`, `src/main/schemas.ts`, `src/main/ipc.ts`, `src/main/services.ts`
- Overwrite: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Test: `src/main/schemas.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–14
- Produces:
  - `INVOKE_CHANNELS`, `InvokeChannel`, `EVENT_CHANNELS`, `EventChannel`, `EventPayloads`, `Bridge` (in `src/shared/api.ts`)
  - `window.blockhost: Bridge` in the renderer
  - Invoke channels and argument tuples:
    - `providers:listVersions [type]`, `providers:listBuilds [type, version]`
    - `servers:list []`, `servers:create [CreateServerInput]`, `servers:retryInstall [id]`, `servers:update [id, ServerPatch]`, `servers:remove [id, keepFiles]`
    - `servers:start [id]`, `servers:stop [id]`, `servers:restart [id]`, `servers:kill [id]`, `servers:sendCommand [id, command]`
    - `servers:getLog [id]`, `servers:getInstallLog [id]`, `servers:readProperties [id]`, `servers:writeProperties [id, entries]`, `servers:openFolder [id]`
    - `java:install [major]`
    - `system:info []`, `system:netInfo [port]`, `system:checkPort [port]`, `system:pickFolder []`, `system:pickJava []`, `system:openExternal [httpsUrl]`
  - Events: `server:status`, `server:log`, `install:progress`, `net:offline`
  - Schemas: `idSchema`, `serverTypeSchema`, `versionSchema`, `portSchema`, `ramSchema`, `nameSchema`, `createServerSchema`, `serverPatchSchema`, `propertyEntriesSchema`, `commandSchema`, `httpsUrlSchema`, `javaMajorSchema`
  - `createServices(opts: { dataDir: string; serversDir: string; send: SendEvent }): Promise<Services>`

- [ ] **Step 1: Write the shared IPC contract**

`src/shared/api.ts`:
```ts
import type { InstallProgress, Result, ServerLogEvent, ServerStatusEvent } from './types'

export const INVOKE_CHANNELS = [
  'providers:listVersions',
  'providers:listBuilds',
  'servers:list',
  'servers:create',
  'servers:retryInstall',
  'servers:update',
  'servers:remove',
  'servers:start',
  'servers:stop',
  'servers:restart',
  'servers:kill',
  'servers:sendCommand',
  'servers:getLog',
  'servers:getInstallLog',
  'servers:readProperties',
  'servers:writeProperties',
  'servers:openFolder',
  'java:install',
  'system:info',
  'system:netInfo',
  'system:checkPort',
  'system:pickFolder',
  'system:pickJava',
  'system:openExternal'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_CHANNELS = ['server:status', 'server:log', 'install:progress', 'net:offline'] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface EventPayloads {
  'server:status': ServerStatusEvent
  'server:log': ServerLogEvent
  'install:progress': InstallProgress
  'net:offline': { url: string }
}

/** What the preload script exposes as `window.blockhost`. */
export interface Bridge {
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<Result<unknown>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void): () => void
}
```

- [ ] **Step 2: Write the failing schema test**

`src/main/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  commandSchema,
  createServerSchema,
  httpsUrlSchema,
  javaMajorSchema,
  propertyEntriesSchema,
  serverPatchSchema
} from './schemas'

const validCreate = {
  name: 'Survival (2026)',
  type: 'paper',
  mcVersion: '26.3',
  dir: 'C:\\Users\\me\\Documents\\MinecraftServers\\Survival',
  ramMb: 4096,
  port: 25565,
  eulaAccepted: true
}

describe('createServerSchema', () => {
  it('accepts a valid request', () => {
    expect(createServerSchema.parse(validCreate)).toMatchObject({ name: 'Survival (2026)' })
  })

  it('requires the EULA to be accepted', () => {
    expect(createServerSchema.safeParse({ ...validCreate, eulaAccepted: false }).success).toBe(false)
  })

  it('rejects relative folders, bad names, unknown types and bad ports', () => {
    expect(createServerSchema.safeParse({ ...validCreate, dir: 'servers\\x' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, name: 'a/b' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, type: 'bukkit' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, port: 70000 }).success).toBe(false)
  })
})

describe('serverPatchSchema', () => {
  it('accepts partial patches and null javaPath', () => {
    expect(serverPatchSchema.parse({ ramMb: 2048, javaPath: null })).toEqual({ ramMb: 2048, javaPath: null })
  })

  it('rejects unknown keys', () => {
    expect(serverPatchSchema.safeParse({ launch: { args: ['-jar', 'evil.jar'] } }).success).toBe(false)
  })

  it('only allows JVM options and blocks command hooks', () => {
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-XX:+UseG1GC', '-Dfoo=bar'] }).success).toBe(true)
    expect(serverPatchSchema.safeParse({ jvmArgs: ['nogui'] }).success).toBe(false)
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-XX:OnOutOfMemoryError=calc'] }).success).toBe(false)
  })
})

describe('other schemas', () => {
  it('rejects multi-line commands', () => {
    expect(commandSchema.safeParse('say hi').success).toBe(true)
    expect(commandSchema.safeParse('stop\nop me').success).toBe(false)
  })

  it('validates property keys', () => {
    expect(propertyEntriesSchema.safeParse([{ key: 'motd', value: 'Hi: there' }]).success).toBe(true)
    expect(propertyEntriesSchema.safeParse([{ key: 'bad key', value: 'x' }]).success).toBe(false)
  })

  it('only allows https URLs', () => {
    expect(httpsUrlSchema.safeParse('https://aka.ms/MinecraftEULA').success).toBe(true)
    expect(httpsUrlSchema.safeParse('http://example.com').success).toBe(false)
    expect(httpsUrlSchema.safeParse('file:///C:/Windows').success).toBe(false)
  })

  it('only allows managed Java majors', () => {
    expect(javaMajorSchema.safeParse(21).success).toBe(true)
    expect(javaMajorSchema.safeParse(11).success).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/main/schemas.test.ts`
Expected: FAIL with "Failed to resolve import './schemas'".

- [ ] **Step 4: Implement the schemas**

`src/main/schemas.ts`:
```ts
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { SERVER_TYPES } from '../shared/types'
import { JAVA_MAJORS } from './java/requirements'

export const idSchema = z.uuid()
export const serverTypeSchema = z.enum(SERVER_TYPES)
export const versionSchema = z.string().min(1).max(64).regex(/^[\w.+-]+$/)
export const portSchema = z.number().int().min(1).max(65535)
export const ramSchema = z.number().int().min(512).max(65536)
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[\w .()-]+$/, 'Use letters, numbers, spaces, dots, dashes or brackets')

export const createServerSchema = z.object({
  name: nameSchema,
  type: serverTypeSchema,
  mcVersion: versionSchema,
  build: z.string().max(32).regex(/^[\w.-]+$/).optional(),
  dir: z
    .string()
    .min(3)
    .max(240)
    .refine((p) => isAbsolute(p), 'Folder must be an absolute path'),
  ramMb: ramSchema,
  port: portSchema,
  eulaAccepted: z.literal(true)
})

const jvmArgSchema = z
  .string()
  .max(200)
  .regex(/^-\S+$/, 'JVM arguments must start with "-"')
  .refine((arg) => !/OnError|OnOutOfMemoryError/i.test(arg), 'This JVM option is not allowed')

export const serverPatchSchema = z.strictObject({
  name: nameSchema.optional(),
  ramMb: ramSchema.optional(),
  port: portSchema.optional(),
  javaPath: z.string().max(400).nullable().optional(),
  jvmArgs: z.array(jvmArgSchema).max(50).optional()
})

export const propertyEntriesSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(128).regex(/^[^\s=:#!\\]+$/, 'Invalid property name'),
      value: z.string().max(4096)
    })
  )
  .max(500)

export const commandSchema = z.string().min(1).max(1000).regex(/^[^\r\n]*$/, 'Commands must be one line')

export const httpsUrlSchema = z.url().refine((url) => url.startsWith('https://'), 'Only https links are allowed')

export const javaMajorSchema = z
  .number()
  .int()
  .refine((major) => (JAVA_MAJORS as readonly number[]).includes(major), 'Unsupported Java version')
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the composition root**

`src/main/services.ts`:
```ts
import extract from 'extract-zip'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventChannel, EventPayloads } from '../shared/api'
import type { ServerType } from '../shared/types'
import { JsonCache } from './cache'
import { probeJava } from './java/detect'
import { JavaManager } from './java/manager'
import { JavaResolver } from './java/resolver'
import { runJava } from './java/run'
import { downloadFile } from './net/download'
import { createHttpClient, type HttpClient } from './net/http'
import { isPortFree } from './net/port'
import { createProviders } from './providers'
import type { ServerProvider } from './providers/types'
import { createMojangJavaLookup } from './providers/vanilla'
import { ServerInstaller } from './servers/installer'
import { defaultSpawn, killTree, ProcessManager } from './servers/process'
import { ServerService } from './servers/service'
import { ServerStore } from './servers/store'

export type SendEvent = <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void

export interface Services {
  paths: { dataDir: string; serversDir: string }
  http: HttpClient
  providers: Record<ServerType, ServerProvider>
  javaManager: JavaManager
  installer: ServerInstaller
  processes: ProcessManager
  servers: ServerService
}

export async function createServices(opts: {
  dataDir: string
  serversDir: string
  send: SendEvent
}): Promise<Services> {
  const { dataDir, serversDir, send } = opts
  const http = createHttpClient({
    cache: new JsonCache(join(dataDir, 'cache')),
    onStale: (url) => send('net:offline', { url })
  })
  const providers = createProviders({ http, download: downloadFile, runJava })
  const javaManager = new JavaManager({
    root: join(dataDir, 'java'),
    http,
    download: downloadFile,
    extractZip: (zipPath, destDir) => extract(zipPath, { dir: destDir })
  })
  const java = new JavaResolver({
    manager: javaManager,
    mojangJavaMajor: createMojangJavaLookup(http),
    probe: probeJava
  })
  const store = new ServerStore(join(dataDir, 'servers.json'))
  await store.load()
  const installer = new ServerInstaller({
    store,
    providers,
    java,
    emit: (progress) => send('install:progress', progress)
  })
  const processes = new ProcessManager({
    spawn: defaultSpawn,
    kill: killTree,
    onStatus: (event) => send('server:status', event),
    onLog: (event) => send('server:log', event)
  })
  const servers = new ServerService({
    store,
    installer,
    processes,
    java,
    probeJava,
    isPortFree: (port) => isPortFree(port),
    removeDir: (dir) => rm(dir, { recursive: true, force: true })
  })
  return { paths: { dataDir, serversDir }, http, providers, javaManager, installer, processes, servers }
}
```

- [ ] **Step 7: Write the IPC handlers**

`src/main/ipc.ts`:
```ts
import { dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { totalmem } from 'node:os'
import { z } from 'zod'
import type { InvokeChannel } from '../shared/api'
import type { Result } from '../shared/types'
import { AppError, toApiError } from './errors'
import { lanIps, publicIp } from './net/ip'
import { isPortFree } from './net/port'
import {
  commandSchema,
  createServerSchema,
  httpsUrlSchema,
  idSchema,
  javaMajorSchema,
  portSchema,
  propertyEntriesSchema,
  serverPatchSchema,
  serverTypeSchema,
  versionSchema
} from './schemas'
import type { Services } from './services'

function handle<A extends unknown[]>(
  channel: InvokeChannel,
  schema: z.ZodType<A>,
  fn: (...args: A) => unknown
): void {
  ipcMain.handle(channel, async (_event, ...raw: unknown[]): Promise<Result<unknown>> => {
    try {
      const args = schema.parse(raw)
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: toApiError(err) }
    }
  })
}

export function registerIpc(services: Services, getWindow: () => BrowserWindow | null): void {
  const { servers, installer, providers, javaManager, http, paths } = services

  const openDialog = async (options: OpenDialogOptions): Promise<string | null> => {
    const win = getWindow()
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  handle('providers:listVersions', z.tuple([serverTypeSchema]), (type) => providers[type].listVersions())
  handle(
    'providers:listBuilds',
    z.tuple([serverTypeSchema, versionSchema]),
    async (type, version) => (await providers[type].listBuilds?.(version)) ?? []
  )

  handle('servers:list', z.tuple([]), () => servers.list())
  handle('servers:create', z.tuple([createServerSchema]), (input) => servers.create(input))
  handle('servers:retryInstall', z.tuple([idSchema]), (id) => servers.retryInstall(id))
  handle('servers:update', z.tuple([idSchema, serverPatchSchema]), (id, patch) => servers.update(id, patch))
  handle('servers:remove', z.tuple([idSchema, z.boolean()]), (id, keepFiles) =>
    servers.remove(id, keepFiles)
  )
  handle('servers:start', z.tuple([idSchema]), (id) => servers.start(id))
  handle('servers:stop', z.tuple([idSchema]), (id) => servers.stop(id))
  handle('servers:restart', z.tuple([idSchema]), (id) => servers.restart(id))
  handle('servers:kill', z.tuple([idSchema]), (id) => servers.kill(id))
  handle('servers:sendCommand', z.tuple([idSchema, commandSchema]), (id, command) =>
    servers.sendCommand(id, command)
  )
  handle('servers:getLog', z.tuple([idSchema]), (id) => servers.getLog(id))
  handle('servers:getInstallLog', z.tuple([idSchema]), (id) => installer.getLog(id))
  handle('servers:readProperties', z.tuple([idSchema]), (id) => servers.readProperties(id))
  handle('servers:writeProperties', z.tuple([idSchema, propertyEntriesSchema]), (id, entries) =>
    servers.writeProperties(id, entries)
  )
  handle('servers:openFolder', z.tuple([idSchema]), async (id) => {
    const error = await shell.openPath(servers.dir(id))
    if (error) throw new AppError('OPEN_FAILED', error)
  })

  handle('java:install', z.tuple([javaMajorSchema]), async (major) => {
    await javaManager.ensure(major)
  })

  handle('system:info', z.tuple([]), () => ({
    totalRamMb: Math.floor(totalmem() / 1024 / 1024),
    defaultServersDir: paths.serversDir
  }))
  handle('system:netInfo', z.tuple([portSchema]), async (port) => ({
    lanIps: lanIps(),
    publicIp: await publicIp(http),
    port
  }))
  handle('system:checkPort', z.tuple([portSchema]), (port) => isPortFree(port))
  handle('system:pickFolder', z.tuple([]), () =>
    openDialog({ title: 'Choose a folder for your servers', properties: ['openDirectory', 'createDirectory'] })
  )
  handle('system:pickJava', z.tuple([]), async () => {
    const path = await openDialog({
      title: 'Choose java.exe',
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: ['exe'] }]
    })
    if (path) servers.approveJavaPath(path)
    return path
  })
  handle('system:openExternal', z.tuple([httpsUrlSchema]), (url) => shell.openExternal(url))
}
```

- [ ] **Step 8: Write the preload bridge and renderer typing**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge } from '../shared/api'

const invokeChannels: readonly string[] = INVOKE_CHANNELS
const eventChannels: readonly string[] = EVENT_CHANNELS

const bridge: Bridge = {
  invoke(channel, ...args) {
    if (!invokeChannels.includes(channel)) {
      return Promise.reject(new Error(`Unknown channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!eventChannels.includes(channel)) throw new Error(`Unknown event: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('blockhost', bridge)
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
import type { Bridge } from '../../shared/api'

declare global {
  interface Window {
    blockhost: Bridge
  }
}
```

- [ ] **Step 9: Write the app lifecycle (window, services, quit confirmation)**

`src/main/index.ts`:
```ts
import { app, BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { EventChannel, EventPayloads } from '../shared/api'
import { registerIpc } from './ipc'
import { createServices, type Services } from './services'

const QUIT_STOP_TIMEOUT_MS = 60_000

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let quitting = false
let confirming = false

function send<C extends EventChannel>(channel: C, payload: EventPayloads[C]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function shouldConfirmQuit(): boolean {
  return !quitting && !!services && services.processes.activeIds().length > 0
}

async function confirmQuit(): Promise<void> {
  if (confirming || !services) return
  confirming = true
  try {
    const { processes } = services
    const ids = processes.activeIds()
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Stop servers and quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Blockhost',
      message: ids.length === 1 ? 'A server is still running.' : `${ids.length} servers are still running.`,
      detail: 'Blockhost will send "stop" to each server so the worlds are saved, then quit.'
    }
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    if (response !== 0) return
    quitting = true
    for (const id of ids) processes.stop(id)
    const stopped = await Promise.all(ids.map((id) => processes.waitForExit(id, QUIT_STOP_TIMEOUT_MS)))
    await Promise.all(ids.filter((_, i) => !stopped[i]).map((id) => processes.kill(id)))
    app.quit()
  } finally {
    confirming = false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Blockhost',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (shouldConfirmQuit()) {
      event.preventDefault()
      void confirmQuit()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(win.webContents.getURL()).origin) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', (event) => {
  if (shouldConfirmQuit()) {
    event.preventDefault()
    void confirmQuit()
  }
})

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.blockhost.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  try {
    services = await createServices({
      dataDir: join(app.getPath('appData'), 'Blockhost'),
      serversDir: join(app.getPath('documents'), 'MinecraftServers'),
      send
    })
  } catch (err) {
    dialog.showErrorBox('Blockhost could not start', err instanceof Error ? err.message : String(err))
    app.exit(1)
    return
  }
  registerIpc(services, () => mainWindow)
  createWindow()
})
```

- [ ] **Step 10: Verify build and the bridge end-to-end**

Run: `npm test && npm run build`
Expected: all tests pass, and typecheck and build succeed.

Run: `npm run dev`, press F12 to open DevTools, and run these in the console:
```js
await window.blockhost.invoke('servers:list')                      // { ok: true, data: [] }
await window.blockhost.invoke('system:info')                       // { ok: true, data: { totalRamMb: …, defaultServersDir: 'C:\\Users\\…\\Documents\\MinecraftServers' } }
await window.blockhost.invoke('providers:listVersions', 'paper')   // { ok: true, data: [{ id: '26.3', stable: true }, …] }
await window.blockhost.invoke('servers:start', 'not-a-uuid')       // { ok: false, error: { code: 'INVALID_INPUT', … } }
typeof window.require                                              // 'undefined' (no Node in the renderer)
```
Expected: the results shown in the comments. Close the app.

- [ ] **Step 11: Commit**

```bash
git add src
git commit -m "feat: wire IPC with zod validation, preload bridge and quit confirmation"
```

---

### Task 16: Renderer foundation: API client, UI primitives, server list

**Files:**
- Create: `src/renderer/src/lib/api.ts`, `src/renderer/src/lib/format.ts`, `src/renderer/src/components/ui.tsx`, `src/renderer/src/hooks/useServers.ts`, `src/renderer/src/pages/ServerList.tsx`
- Overwrite: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `Bridge`, `EventChannel`, `EventPayloads`, `InvokeChannel` (Task 15); shared types (Task 2)
- Produces:
  - `ApiCallError` (`code`, `details`), `errorMessage(err: unknown): string`
  - `api` with these typed methods:
    - Providers: `listVersions`, `listBuilds`
    - Servers: `listServers`, `createServer`, `retryInstall`, `updateServer`, `removeServer`
    - Running: `start`, `stop`, `restart`, `kill`, `sendCommand`
    - Logs and properties: `getLog`, `getInstallLog`, `readProperties`, `writeProperties`, `openFolder`
    - System: `installJava`, `systemInfo`, `netInfo`, `checkPort`, `pickFolder`, `pickJava`, `openExternal`
    - Events: `on`
  - `STATUS_LABEL`, `STATUS_DOT`, `TYPE_BLURB`, `formatRam(mb)`, `defaultRamMb(totalMb)`, `maxRamMb(totalMb)`
  - UI: `Button` (`variant`: `primary | secondary | danger | ghost`), `Field`, `inputClass`, `StatusBadge`, `TypeBadge`, `ErrorText`
  - `useServers(): { servers: ServerView[]; loaded: boolean; error: string | null; refresh: () => Promise<void> }`
  - `ServerList` props: `{ servers; loaded; onOpen(id); onNew() }`
  - `App` routes: `list | new | server(id)`. The `new` and `server` routes get their pages in Tasks 17 and 18.

- [ ] **Step 1: Write the API client and formatting helpers**

`src/renderer/src/lib/api.ts`:
```ts
import type { Bridge, EventChannel, EventPayloads, InvokeChannel } from '../../../shared/api'
import type {
  ApiError,
  CreateServerInput,
  NetInfo,
  PropertyEntry,
  ServerPatch,
  ServerType,
  ServerView,
  SystemInfo,
  UpdateResult,
  VersionInfo
} from '../../../shared/types'

export class ApiCallError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ApiCallError'
    this.code = error.code
    this.details = error.details
  }
}

const bridge: Bridge = window.blockhost

async function call<T>(channel: InvokeChannel, ...args: unknown[]): Promise<T> {
  const result = await bridge.invoke(channel, ...args)
  if (!result.ok) throw new ApiCallError(result.error)
  return result.data as T
}

export const api = {
  listVersions: (type: ServerType) => call<VersionInfo[]>('providers:listVersions', type),
  listBuilds: (type: ServerType, version: string) =>
    call<VersionInfo[]>('providers:listBuilds', type, version),

  listServers: () => call<ServerView[]>('servers:list'),
  createServer: (input: CreateServerInput) => call<ServerView>('servers:create', input),
  retryInstall: (id: string) => call<ServerView>('servers:retryInstall', id),
  updateServer: (id: string, patch: ServerPatch) => call<UpdateResult>('servers:update', id, patch),
  removeServer: (id: string, keepFiles: boolean) => call<void>('servers:remove', id, keepFiles),
  start: (id: string) => call<void>('servers:start', id),
  stop: (id: string) => call<void>('servers:stop', id),
  restart: (id: string) => call<void>('servers:restart', id),
  kill: (id: string) => call<void>('servers:kill', id),
  sendCommand: (id: string, command: string) => call<void>('servers:sendCommand', id, command),
  getLog: (id: string) => call<string[]>('servers:getLog', id),
  getInstallLog: (id: string) => call<string[]>('servers:getInstallLog', id),
  readProperties: (id: string) => call<PropertyEntry[]>('servers:readProperties', id),
  writeProperties: (id: string, entries: PropertyEntry[]) =>
    call<void>('servers:writeProperties', id, entries),
  openFolder: (id: string) => call<void>('servers:openFolder', id),

  installJava: (major: number) => call<void>('java:install', major),
  systemInfo: () => call<SystemInfo>('system:info'),
  netInfo: (port: number) => call<NetInfo>('system:netInfo', port),
  checkPort: (port: number) => call<boolean>('system:checkPort', port),
  pickFolder: () => call<string | null>('system:pickFolder'),
  pickJava: () => call<string | null>('system:pickJava'),
  openExternal: (url: string) => call<void>('system:openExternal', url),

  on: <C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void) =>
    bridge.on(channel, listener)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

`src/renderer/src/lib/format.ts`:
```ts
import type { ServerStatus, ServerType } from '../../../shared/types'

export const STATUS_LABEL: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Crashed'
}

export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'bg-zinc-500',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse',
  crashed: 'bg-red-500'
}

export const TYPE_BLURB: Record<ServerType, string> = {
  vanilla: 'The official server from Mojang. No plugins or mods.',
  paper: 'Fast and stable, runs Bukkit/Spigot plugins. The best default.',
  purpur: 'Paper with extra gameplay options and tweaks.',
  fabric: 'Lightweight mod loader for modern mods.',
  forge: 'The classic mod loader with the largest mod library.',
  neoforge: 'Modern fork of Forge used by most new mods.'
}

export function formatRam(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024} GB` : `${(mb / 1024).toFixed(1)} GB`
}

/** A quarter of system RAM, rounded to 512 MB, between 1 GB and 8 GB. */
export function defaultRamMb(totalMb: number): number {
  const quarter = Math.round((totalMb * 0.25) / 512) * 512
  return Math.min(8192, Math.max(1024, quarter))
}

/** Leaves 2 GB for Windows, capped at 32 GB. */
export function maxRamMb(totalMb: number): number {
  return Math.max(1024, Math.min(32768, Math.floor((totalMb - 2048) / 512) * 512))
}
```

- [ ] **Step 2: Write the UI primitives**

`src/renderer/src/components/ui.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { SERVER_TYPE_LABELS, type ServerStatus, type ServerView } from '../../../shared/types'
import { STATUS_DOT, STATUS_LABEL } from '../lib/format'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
  secondary: 'border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  danger: 'bg-red-700 text-white hover:bg-red-600',
  ghost: 'text-zinc-300 hover:bg-zinc-800'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-50'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-zinc-300">{label}</div>
      {children}
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-300">
      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function TypeBadge({ server }: { server: Pick<ServerView, 'type' | 'mcVersion'> }) {
  return (
    <span className="whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
      {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
    </span>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  )
}
```

- [ ] **Step 3: Write the servers hook and the list page**

`src/renderer/src/hooks/useServers.ts`:
```ts
import { useCallback, useEffect, useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'

export function useServers() {
  const [servers, setServers] = useState<ServerView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setServers(await api.listServers())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offStatus = api.on('server:status', (event) =>
      setServers((list) =>
        list.map((s) => (s.id === event.serverId ? { ...s, status: event.status } : s))
      )
    )
    const offInstall = api.on('install:progress', (event) => {
      if (event.step === 'done' || event.step === 'error') void refresh()
    })
    return () => {
      offStatus()
      offInstall()
    }
  }, [refresh])

  return { servers, loaded, error, refresh }
}
```

`src/renderer/src/pages/ServerList.tsx`:
```tsx
import { useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { Button, ErrorText, StatusBadge, TypeBadge } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { formatRam } from '../lib/format'

interface Props {
  servers: ServerView[]
  loaded: boolean
  onOpen: (id: string) => void
  onNew: () => void
}

const isUp = (s: ServerView): boolean => s.status === 'running' || s.status === 'starting'

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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your servers</h1>
        <Button variant="primary" onClick={onNew}>
          + New server
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loaded && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center text-zinc-400">
          <p className="mb-4">No servers yet. Create one in a few clicks.</p>
          <Button variant="primary" onClick={onNew}>
            Create your first server
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => (
          <div
            key={server.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(server.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(server.id)
            }}
            className="cursor-pointer space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-600"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="truncate font-medium">{server.name}</h2>
              <TypeBadge server={server} />
            </div>
            <div className="flex items-center justify-between">
              {server.installState === 'ready' ? (
                <StatusBadge status={server.status} />
              ) : (
                <span className="text-sm text-zinc-400">
                  {server.installState === 'installing' ? 'Installing…' : 'Install failed'}
                </span>
              )}
              {server.installState === 'ready' && (
                <Button
                  disabled={busyId === server.id || server.status === 'stopping'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggle(server)
                  }}
                >
                  {isUp(server) ? 'Stop' : 'Start'}
                </Button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Port {server.port} · {formatRam(server.ramMb)} RAM
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write the app shell**

`src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { ErrorText } from './components/ui'
import { useServers } from './hooks/useServers'
import { api } from './lib/api'
import { ServerList } from './pages/ServerList'

type Route = { name: 'list' } | { name: 'new' } | { name: 'server'; id: string }

export default function App() {
  const { servers, loaded, error } = useServers()
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [offline, setOffline] = useState(false)

  useEffect(() => api.on('net:offline', () => setOffline(true)), [])

  const goList = () => setRoute({ name: 'list' })
  const openServer = (id: string) => setRoute({ name: 'server', id })
  const current = route.name === 'server' ? servers.find((s) => s.id === route.id) : undefined

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <button type="button" onClick={goList} className="text-lg font-semibold tracking-tight">
          ⛏ Blockhost
        </button>
      </header>
      {offline && (
        <div className="border-b border-amber-900 bg-amber-950/60 px-6 py-2 text-sm text-amber-200">
          You seem to be offline. Version lists may be out of date.
        </div>
      )}
      {error && (
        <div className="px-6 pt-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">
        {route.name === 'list' && (
          <ServerList
            servers={servers}
            loaded={loaded}
            onOpen={openServer}
            onNew={() => setRoute({ name: 'new' })}
          />
        )}
        {route.name === 'new' && <p className="p-6 text-zinc-400">New server wizard</p>}
        {route.name === 'server' && <p className="p-6 text-zinc-400">{current?.name}</p>}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev`
Expected: the header shows "⛏ Blockhost". The empty state shows "No servers yet. Create one in a few clicks." with a "Create your first server" button. Clicking it shows the "New server wizard" placeholder text, and clicking the header returns to the list.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: add renderer API client, UI primitives and server list"
```

---
### Task 17: New Server wizard and install progress panel

**Files:**
- Create: `src/renderer/src/components/InstallPanel.tsx`, `src/renderer/src/pages/NewServerWizard.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `api`, `errorMessage`, UI primitives, `TYPE_BLURB`, `formatRam`, `defaultRamMb`, `maxRamMb` (Task 16); `SERVER_TYPES`, `SERVER_TYPE_LABELS`, `TYPES_WITH_BUILDS` (Task 2)
- Produces:
  - `InstallPanel` props: `{ serverId: string; initialState: InstallState; actions?: (state: PanelState) => ReactNode }`, with `type PanelState = 'running' | 'done' | 'error'`. Task 18 reuses it for servers whose install failed.
  - `NewServerWizard` props: `{ servers: ServerView[]; onCancel(): void; onCreated(): void; onOpen(id: string): void }`

- [ ] **Step 1: Write the install panel**

`src/renderer/src/components/InstallPanel.tsx`:
```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InstallState, InstallStep } from '../../../shared/types'
import { api } from '../lib/api'

export type PanelState = 'running' | 'done' | 'error'

const STEPS: { step: InstallStep; label: string }[] = [
  { step: 'java', label: 'Java runtime' },
  { step: 'server', label: 'Server files' },
  { step: 'installer', label: 'Mod loader setup' },
  { step: 'config', label: 'Configuration' }
]
const ORDER: InstallStep[] = ['java', 'server', 'installer', 'config', 'done']

interface Props {
  serverId: string
  initialState: InstallState
  actions?: (state: PanelState) => ReactNode
}

export function InstallPanel({ serverId, initialState, actions }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [step, setStep] = useState<InstallStep | null>(null)
  const [percent, setPercent] = useState<number | undefined>(undefined)
  const [state, setState] = useState<PanelState>(
    initialState === 'failed' ? 'error' : initialState === 'ready' ? 'done' : 'running'
  )
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const off = api.on('install:progress', (event) => {
      if (!ready || event.serverId !== serverId) return
      if (event.message) setLines((prev) => [...prev.slice(-999), event.message])
      if (event.step === 'error') {
        setState('error')
        return
      }
      if (event.step === 'done') {
        setState('done')
        setStep('done')
        return
      }
      setState('running')
      setStep(event.step)
      setPercent(event.percent)
    })
    api
      .getInstallLog(serverId)
      .then((log) => setLines(log))
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return off
  }, [serverId])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const current = step ? ORDER.indexOf(step) : -1

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const done = state === 'done' || current > i
          const active = state === 'running' && current === i
          return (
            <li key={s.step} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  done
                    ? 'bg-emerald-600 text-white'
                    : active
                      ? 'bg-amber-500 text-black'
                      : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'text-zinc-100' : 'text-zinc-400'}>{s.label}</span>
              {active && percent !== undefined && (
                <span className="text-xs text-zinc-500">{percent}%</span>
              )}
            </li>
          )
        })}
      </ol>

      {state === 'done' && <p className="text-sm text-emerald-400">Server installed and ready to start.</p>}
      {state === 'error' && (
        <p className="text-sm text-red-400">Installation failed. Check the log below, then retry.</p>
      )}

      <div
        ref={logRef}
        className="h-64 overflow-auto rounded-md border border-zinc-800 bg-black p-3 font-mono text-xs leading-5 text-zinc-300"
      >
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>

      {actions && <div className="flex gap-2">{actions(state)}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Write the wizard**

`src/renderer/src/pages/NewServerWizard.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  SERVER_TYPES,
  SERVER_TYPE_LABELS,
  TYPES_WITH_BUILDS,
  type ServerType,
  type ServerView,
  type SystemInfo,
  type VersionInfo
} from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { Button, ErrorText, Field, inputClass } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { defaultRamMb, formatRam, maxRamMb, TYPE_BLURB } from '../lib/format'

interface Props {
  servers: ServerView[]
  onCancel: () => void
  onCreated: () => void
  onOpen: (id: string) => void
}

const EULA_URL = 'https://aka.ms/MinecraftEULA'
const NAME_PATTERN = /^[\w .()-]+$/
const STEP_TITLES = ['Type & version', 'Settings', 'Install']

function firstFreePort(servers: ServerView[]): number {
  const used = new Set(servers.map((s) => s.port))
  let port = 25565
  while (used.has(port)) port++
  return port
}

export function NewServerWizard({ servers, onCancel, onCreated, onOpen }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [type, setType] = useState<ServerType>('paper')
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [version, setVersion] = useState('')
  const [builds, setBuilds] = useState<VersionInfo[]>([])
  const [build, setBuild] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [parentDir, setParentDir] = useState('')
  const [ramMb, setRamMb] = useState(2048)
  const [port, setPort] = useState(() => firstFreePort(servers))
  const [portFree, setPortFree] = useState<boolean | null>(null)
  const [eula, setEula] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  useEffect(() => {
    api
      .systemInfo()
      .then((info) => {
        setSys(info)
        setParentDir(info.defaultServersDir)
        setRamMb(defaultRamMb(info.totalRamMb))
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setVersionsLoading(true)
    setVersions([])
    setVersion('')
    setError(null)
    api
      .listVersions(type)
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        setVersion(list.find((v) => v.stable)?.id ?? list[0]?.id ?? '')
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type])

  useEffect(() => {
    setBuilds([])
    setBuild('')
    if (!version || !TYPES_WITH_BUILDS.includes(type)) return
    let cancelled = false
    api
      .listBuilds(type, version)
      .then((list) => {
        if (!cancelled) setBuilds(list)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [type, version])

  useEffect(() => {
    if (!nameTouched && version) setName(`${SERVER_TYPE_LABELS[type]} ${version}`)
  }, [type, version, nameTouched])

  useEffect(() => {
    setPortFree(null)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    const timer = setTimeout(() => {
      api
        .checkPort(port)
        .then(setPortFree)
        .catch(() => setPortFree(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [port])

  const visibleVersions = useMemo(
    () => versions.filter((v) => showSnapshots || v.stable),
    [versions, showSnapshots]
  )
  const trimmedName = name.trim()
  const dir = `${parentDir.replace(/[\\/]+$/, '')}\\${trimmedName}`
  const nameError = !trimmedName
    ? 'Enter a name'
    : !NAME_PATTERN.test(trimmedName)
      ? 'Use letters, numbers, spaces, dots, dashes or brackets'
      : servers.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())
        ? 'Another server already uses this name'
        : null
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535
  const portConflict = servers.find((s) => s.port === port)
  const portHint = !portValid
    ? 'Enter a port between 1 and 65535.'
    : portConflict
      ? `Also used by "${portConflict.name}". Both can't run at the same time.`
      : portFree === false
        ? 'This port is in use by another program right now.'
        : portFree
          ? 'Port is free. 25565 is the Minecraft default.'
          : 'Checking…'
  const canCreate = !nameError && portValid && eula && !!parentDir && !!version && !creating

  async function pickFolder() {
    const picked = await api.pickFolder()
    if (picked) setParentDir(picked)
  }

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const server = await api.createServer({
        name: trimmedName,
        type,
        mcVersion: version,
        build: build || undefined,
        dir,
        ramMb,
        port,
        eulaAccepted: true
      })
      setCreatedId(server.id)
      setStep(3)
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">New server</h1>
        <ol className="flex gap-4 text-sm">
          {STEP_TITLES.map((title, i) => (
            <li key={title} className={i + 1 === step ? 'text-emerald-400' : 'text-zinc-500'}>
              {i + 1}. {title}
            </li>
          ))}
        </ol>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {SERVER_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-lg border p-3 text-left ${
                  t === type
                    ? 'border-emerald-500 bg-emerald-950/40'
                    : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                }`}
              >
                <div className="font-medium">{SERVER_TYPE_LABELS[t]}</div>
                <div className="mt-1 text-xs text-zinc-400">{TYPE_BLURB[t]}</div>
              </button>
            ))}
          </div>

          <Field label="Minecraft version">
            <select
              className={inputClass}
              value={version}
              disabled={versionsLoading}
              onChange={(e) => setVersion(e.target.value)}
            >
              {versionsLoading && <option value="">Loading…</option>}
              {visibleVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                  {v.stable ? '' : ' (snapshot / beta)'}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={showSnapshots}
              onChange={(e) => setShowSnapshots(e.target.checked)}
            />
            Show snapshots and pre-releases
          </label>

          {TYPES_WITH_BUILDS.includes(type) && (
            <Field label="Build">
              <select className={inputClass} value={build} onChange={(e) => setBuild(e.target.value)}>
                <option value="">Latest stable (recommended)</option>
                {builds.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id}
                    {b.stable ? '' : ' (experimental)'}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="primary" disabled={!version} onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <Field label="Server name" hint={nameError ?? undefined}>
            <input
              className={inputClass}
              value={name}
              maxLength={48}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
          </Field>

          <Field label="Folder" hint={`Files will be stored in ${dir}`}>
            <div className="flex gap-2">
              <input className={inputClass} value={parentDir} readOnly />
              <Button onClick={() => void pickFolder()}>Change…</Button>
            </div>
          </Field>

          <Field
            label={`Memory: ${formatRam(ramMb)}`}
            hint={
              sys
                ? `Your PC has ${formatRam(sys.totalRamMb)} of RAM. 2–4 GB is plenty for a few friends; modpacks need 6 GB or more.`
                : undefined
            }
          >
            <input
              type="range"
              className="w-full accent-emerald-500"
              min={1024}
              max={sys ? maxRamMb(sys.totalRamMb) : 8192}
              step={512}
              value={ramMb}
              onChange={(e) => setRamMb(Number(e.target.value))}
            />
          </Field>

          <Field label="Port" hint={portHint}>
            <input
              type="number"
              className={inputClass}
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </Field>

          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={eula}
              onChange={(e) => setEula(e.target.checked)}
            />
            <span>
              I accept the{' '}
              <button
                type="button"
                className="text-emerald-400 underline"
                onClick={() => void api.openExternal(EULA_URL)}
              >
                Minecraft End User License Agreement
              </button>
              . Mojang requires this to run a server.
            </span>
          </label>

          <div className="flex justify-between">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
              {creating ? 'Creating…' : 'Create server'}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && createdId && (
        <InstallPanel
          serverId={createdId}
          initialState="installing"
          actions={(state) =>
            state === 'done' ? (
              <Button variant="primary" onClick={() => onOpen(createdId)}>
                Open server
              </Button>
            ) : state === 'error' ? (
              <>
                <Button
                  variant="primary"
                  onClick={() => void api.retryInstall(createdId).catch((err) => setError(errorMessage(err)))}
                >
                  Retry
                </Button>
                <Button onClick={() => onOpen(createdId)}>Go to server page</Button>
              </>
            ) : null
          }
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Route to the wizard from App**

In `src/renderer/src/App.tsx`:
- Add the import: `import { NewServerWizard } from './pages/NewServerWizard'`
- Replace `const { servers, loaded, error } = useServers()` with `const { servers, loaded, error, refresh } = useServers()`
- Replace the line
  ```tsx
        {route.name === 'new' && <p className="p-6 text-zinc-400">New server wizard</p>}
  ```
  with
  ```tsx
        {route.name === 'new' && (
          <NewServerWizard
            servers={servers}
            onCancel={goList}
            onCreated={() => void refresh()}
            onOpen={openServer}
          />
        )}
  ```

- [ ] **Step 4: Verify in the running app**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev`, click "+ New server", and check each of these:
1. Paper is preselected. The version dropdown fills with the newest stable Paper version, and the Build dropdown shows "Latest stable (recommended)" plus build numbers.
2. Switching to Fabric hides the Build dropdown and reloads the versions.
3. Next leads to Settings, where the name is "Paper 26.3" (or similar) and the folder is `C:\Users\<you>\Documents\MinecraftServers`. Under the port, the hint says "Port is free."
4. "Create server" stays disabled until the EULA box is ticked. Clicking the EULA link opens the browser.
5. Create leads to Install: the steps tick through Java runtime (Java 25 downloads on first run), then Server files, then Configuration, and the log shows lines like `Downloading paper-26.3-…jar`. "Open server" then appears.
6. The new folder contains `server.jar`, `eula.txt` (`eula=true`) and `server.properties` (`server-port=25565`, `motd=…`). `%APPDATA%\Blockhost\java\temurin-25\bin\java.exe` exists.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: add new server wizard with live install progress"
```

---

### Task 18: Server detail page (console, properties, settings, connect)

**Files:**
- Create: `src/renderer/src/pages/ServerDetail.tsx`, `src/renderer/src/pages/tabs/ConsoleTab.tsx`, `src/renderer/src/pages/tabs/PropertiesTab.tsx`, `src/renderer/src/pages/tabs/SettingsTab.tsx`, `src/renderer/src/pages/tabs/ConnectTab.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `api`, `ApiCallError`, `errorMessage`, UI primitives, `formatRam`, `maxRamMb` (Task 16); `InstallPanel` (Task 17)
- Produces:
  - `ServerDetail` props: `{ server: ServerView; onBack(): void; onChanged(): void; onDeleted(): void }`
  - Tab components:
    - `ConsoleTab({ server })`
    - `PropertiesTab({ server, onChanged })`
    - `SettingsTab({ server, onChanged, onDeleted })`
    - `ConnectTab({ server })`

- [ ] **Step 1: Write the console tab**

`src/renderer/src/pages/tabs/ConsoleTab.tsx`:
```tsx
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ServerView } from '../../../../shared/types'
import { Button, ErrorText, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

interface Line {
  id: number
  text: string
}

const MAX_LINES = 5000

function lineClass(text: string): string {
  if (text.startsWith('[Blockhost]')) return 'text-sky-400'
  if (text.startsWith('> ')) return 'text-emerald-400'
  if (/\b(ERROR|SEVERE|FATAL)\b|Exception/.test(text)) return 'text-red-400'
  if (/\bWARN(ING)?\b/.test(text)) return 'text-amber-300'
  return 'text-zinc-300'
}

const LogLine = memo(function LogLine({ text }: { text: string }) {
  return <div className={`whitespace-pre-wrap break-all ${lineClass(text)}`}>{text}</div>
})

export function ConsoleTab({ server }: { server: ServerView }) {
  const [lines, setLines] = useState<Line[]>([])
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)
  const history = useRef<string[]>([])
  const historyIndex = useRef(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const toLines = (texts: string[]): Line[] => texts.map((text) => ({ id: nextId.current++, text }))
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
  }, [lines])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const canSend = server.status === 'running' || server.status === 'starting'

  async function send() {
    const cmd = command.trim().replace(/^\//, '')
    if (!cmd) return
    setError(null)
    try {
      await api.sendCommand(server.id, cmd)
      history.current.push(cmd)
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
    const h = history.current
    if (h.length === 0) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      historyIndex.current = historyIndex.current < 0 ? h.length - 1 : Math.max(0, historyIndex.current - 1)
      setCommand(h[historyIndex.current])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex.current < 0) return
      historyIndex.current += 1
      if (historyIndex.current >= h.length) {
        historyIndex.current = -1
        setCommand('')
      } else {
        setCommand(h[historyIndex.current])
      }
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800 bg-black p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-600">No output yet. Start the server to see its console.</div>
        ) : (
          lines.map((line) => <LogLine key={line.id} text={line.text} />)
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-2">
        <input
          className={`${inputClass} font-mono`}
          placeholder={canSend ? 'Type a command, e.g. op YourName' : 'Start the server to send commands'}
          disabled={!canSend}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="primary" disabled={!canSend || !command.trim()} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the properties tab**

`src/renderer/src/pages/tabs/PropertiesTab.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { PropertyEntry, ServerView } from '../../../../shared/types'
import { Button, ErrorText, Field, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

type Kind = 'text' | 'number' | 'bool' | 'select'

interface CommonProperty {
  key: string
  label: string
  kind: Kind
  options?: string[]
  hint?: string
}

const COMMON: CommonProperty[] = [
  { key: 'motd', label: 'Message of the day', kind: 'text', hint: 'Shown in the multiplayer server list.' },
  { key: 'max-players', label: 'Max players', kind: 'number' },
  { key: 'gamemode', label: 'Game mode', kind: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'difficulty', label: 'Difficulty', kind: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'view-distance', label: 'View distance (chunks)', kind: 'number' },
  { key: 'server-port', label: 'Port', kind: 'number' },
  { key: 'pvp', label: 'Player vs player', kind: 'bool' },
  { key: 'white-list', label: 'Whitelist (only listed players can join)', kind: 'bool' },
  {
    key: 'online-mode',
    label: 'Online mode',
    kind: 'bool',
    hint: 'Checks accounts with Mojang. Turn off only for offline LAN play, since anyone could then join with any name.'
  }
]

// Minecraft's own defaults, shown until the server writes its full server.properties on first start.
const DEFAULTS: Record<string, string> = {
  motd: 'A Minecraft Server',
  'max-players': '20',
  gamemode: 'survival',
  difficulty: 'easy',
  'view-distance': '10',
  pvp: 'true',
  'white-list': 'false',
  'online-mode': 'true'
}

const KEY_PATTERN = /^[^\s=:#!\\]+$/

export function PropertiesTab({ server, onChanged }: { server: ServerView; onChanged: () => void }) {
  const [entries, setEntries] = useState<PropertyEntry[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    api
      .readProperties(server.id)
      .then(setEntries)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id])

  const get = (key: string): string => entries?.find((e) => e.key === key)?.value ?? DEFAULTS[key] ?? ''

  function set(key: string, value: string) {
    setEntries((prev) => {
      const list = prev ?? []
      return list.some((e) => e.key === key)
        ? list.map((e) => (e.key === key ? { key, value } : e))
        : [...list, { key, value }]
    })
    setDirty(true)
    setNotice(null)
  }

  function remove(key: string) {
    setEntries((prev) => (prev ?? []).filter((e) => e.key !== key))
    setDirty(true)
    setNotice(null)
  }

  async function save() {
    if (!entries) return
    setSaving(true)
    setError(null)
    try {
      await api.writeProperties(server.id, entries)
      setDirty(false)
      const stopped = server.status === 'stopped' || server.status === 'crashed'
      setNotice(stopped ? 'Saved.' : 'Saved. Restart the server to apply the changes.')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!entries) return error ? <ErrorText>{error}</ErrorText> : <p className="text-sm text-zinc-500">Loading…</p>

  const commonKeys = new Set(COMMON.map((c) => c.key))
  const advanced = entries.filter((e) => !commonKeys.has(e.key))
  const newKeyValid = KEY_PATTERN.test(newKey) && !entries.some((e) => e.key === newKey)

  return (
    <div className="max-w-3xl space-y-6 pb-6">
      {entries.length <= 2 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
          The full list of settings is generated the first time the server starts. You can already set the
          common ones below.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {COMMON.map((def) => (
          <PropertyInput key={def.key} def={def} value={get(def.key)} onChange={(v) => set(def.key, v)} />
        ))}
      </div>

      <details className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced: all other properties ({advanced.length})
        </summary>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {advanced.map((entry) => (
              <tr key={entry.key} className="border-t border-zinc-800">
                <td className="py-1 pr-3 font-mono text-xs text-zinc-400">{entry.key}</td>
                <td className="py-1">
                  <input
                    className={inputClass}
                    value={entry.value}
                    onChange={(e) => set(entry.key, e.target.value)}
                  />
                </td>
                <td className="py-1 pl-2">
                  <Button variant="ghost" aria-label={`Remove ${entry.key}`} onClick={() => remove(entry.key)}>
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-zinc-800">
              <td className="py-2 pr-3">
                <input
                  className={`${inputClass} font-mono text-xs`}
                  placeholder="new-key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.trim())}
                />
              </td>
              <td className="py-2">
                <input
                  className={inputClass}
                  placeholder="value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </td>
              <td className="py-2 pl-2">
                <Button
                  disabled={!newKeyValid}
                  onClick={() => {
                    set(newKey, newValue)
                    setNewKey('')
                    setNewValue('')
                  }}
                >
                  Add
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </details>

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {notice && <span className="text-sm text-emerald-400">{notice}</span>}
      </div>
    </div>
  )
}

function PropertyInput({
  def,
  value,
  onChange
}: {
  def: CommonProperty
  value: string
  onChange: (value: string) => void
}) {
  if (def.kind === 'bool') {
    return (
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value === 'true'}
          onChange={(e) => onChange(String(e.target.checked))}
        />
        <span>
          <span className="text-zinc-200">{def.label}</span>
          {def.hint && <span className="block text-xs text-zinc-500">{def.hint}</span>}
        </span>
      </label>
    )
  }
  return (
    <Field label={def.label} hint={def.hint}>
      {def.kind === 'select' ? (
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={inputClass}
          type={def.kind === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}
```

- [ ] **Step 3: Write the settings tab**

`src/renderer/src/pages/tabs/SettingsTab.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { ServerView, SystemInfo } from '../../../../shared/types'
import { Button, ErrorText, Field, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { formatRam, maxRamMb } from '../../lib/format'

interface Props {
  server: ServerView
  onChanged: () => void
  onDeleted: () => void
}

export function SettingsTab({ server, onChanged, onDeleted }: Props) {
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [ramMb, setRamMb] = useState(server.ramMb)
  const [jvmArgs, setJvmArgs] = useState(server.jvmArgs.join(' '))
  const [javaPath, setJavaPath] = useState<string | undefined>(server.javaPath)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [keepFiles, setKeepFiles] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api
      .systemInfo()
      .then(setSys)
      .catch(() => {})
  }, [])

  const dirty =
    ramMb !== server.ramMb || jvmArgs.trim() !== server.jvmArgs.join(' ') || javaPath !== server.javaPath
  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const ramMax = Math.max(sys ? maxRamMb(sys.totalRamMb) : 16384, server.ramMb)

  async function save() {
    setSaving(true)
    setError(null)
    setNotice(null)
    setWarning(null)
    try {
      const result = await api.updateServer(server.id, {
        ramMb,
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
        javaPath: javaPath ?? null
      })
      setWarning(result.warning ?? null)
      setNotice(stopped ? 'Saved.' : 'Saved. Changes apply the next time the server starts.')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function browseJava() {
    const picked = await api.pickJava()
    if (picked) setJavaPath(picked)
  }

  async function remove() {
    setDeleting(true)
    setError(null)
    try {
      await api.removeServer(server.id, keepFiles)
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6 pb-6">
      <Field label={`Memory: ${formatRam(ramMb)}`}>
        <input
          type="range"
          className="w-full accent-emerald-500"
          min={1024}
          max={ramMax}
          step={512}
          value={ramMb}
          onChange={(e) => setRamMb(Number(e.target.value))}
        />
      </Field>

      <Field
        label="Java"
        hint={
          javaPath
            ? 'Using a custom Java. Make sure its version matches what this Minecraft version needs.'
            : 'Blockhost downloads and uses the right Java version automatically.'
        }
      >
        <div className="flex gap-2">
          <input className={inputClass} readOnly value={javaPath ?? 'Automatic (Eclipse Temurin)'} />
          <Button onClick={() => void browseJava()}>Browse…</Button>
          {javaPath && <Button onClick={() => setJavaPath(undefined)}>Use automatic</Button>}
        </div>
      </Field>

      <Field label="Extra JVM arguments" hint="Advanced. Separate with spaces, e.g. -XX:+UseG1GC">
        <input
          className={`${inputClass} font-mono`}
          value={jvmArgs}
          onChange={(e) => setJvmArgs(e.target.value)}
          placeholder="-XX:+UseG1GC"
        />
      </Field>

      {warning && <p className="text-sm text-amber-300">{warning}</p>}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button onClick={() => void api.openFolder(server.id).catch((err) => setError(errorMessage(err)))}>
          Open server folder
        </Button>
        {notice && <span className="text-sm text-emerald-400">{notice}</span>}
      </div>

      <section className="space-y-3 rounded-md border border-red-900/60 p-4">
        <h3 className="font-medium text-red-300">Delete server</h3>
        {!confirmDelete ? (
          <Button variant="danger" disabled={!stopped} onClick={() => setConfirmDelete(true)}>
            Delete…
          </Button>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={keepFiles} onChange={(e) => setKeepFiles(e.target.checked)} />
              Keep the world and files on disk ({server.dir})
            </label>
            <div className="flex gap-2">
              <Button variant="danger" disabled={deleting} onClick={() => void remove()}>
                {keepFiles ? 'Remove from Blockhost' : 'Delete server and files'}
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {!stopped && <p className="text-xs text-zinc-500">Stop the server before deleting it.</p>}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Write the connect tab**

`src/renderer/src/pages/tabs/ConnectTab.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { NetInfo, ServerView } from '../../../../shared/types'
import { Button, ErrorText } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

function AddressRow({ address, copied, onCopy }: { address: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <code className="rounded bg-zinc-900 px-3 py-1.5 font-mono text-sm">{address}</code>
      <Button variant="ghost" onClick={onCopy}>
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}

export function ConnectTab({ server }: { server: ServerView }) {
  const [info, setInfo] = useState<NetInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    api
      .netInfo(server.port)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)))
  }, [server.port])

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied((current) => (current === text ? null : current)), 1500)
  }

  const row = (address: string) => (
    <AddressRow key={address} address={address} copied={copied === address} onCopy={() => void copy(address)} />
  )

  return (
    <div className="max-w-2xl space-y-6 pb-6">
      {error && <ErrorText>{error}</ErrorText>}

      <section className="space-y-2">
        <h3 className="font-medium">On this PC</h3>
        {row(`localhost:${server.port}`)}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Same Wi-Fi or home network</h3>
        {info ? (
          info.lanIps.length ? (
            info.lanIps.map((ip) => row(`${ip}:${server.port}`))
          ) : (
            <p className="text-sm text-zinc-500">No network connection found.</p>
          )
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Over the internet</h3>
        {info ? (
          info.publicIp ? (
            row(`${info.publicIp}:${server.port}`)
          ) : (
            <p className="text-sm text-zinc-500">Could not detect your public IP address.</p>
          )
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}
        <p className="text-xs text-zinc-500">This only works after you forward the port on your router (see below).</p>
      </section>

      <details className="rounded-md border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
        <summary className="cursor-pointer font-medium">How to let friends join over the internet</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Open your router&apos;s admin page. It is often <code>192.168.0.1</code> or <code>192.168.1.1</code>,
            and the address is usually printed on the router.
          </li>
          <li>
            Find the <b>Port Forwarding</b> section (sometimes called NAT or Virtual Server).
          </li>
          <li>
            Forward <b>TCP port {server.port}</b> to this PC
            {info?.lanIps[0] ? ` (${info.lanIps[0]})` : ''}.
          </li>
          <li>
            When Windows asks whether Java may communicate on networks, allow it. If you dismissed that prompt,
            allow Java under Windows Security → Firewall &amp; network protection → Allow an app through firewall.
          </li>
          <li>Share the internet address above with your friends.</li>
        </ol>
        <p className="mt-3 text-xs text-zinc-500">
          Some internet providers use CGNAT, which blocks port forwarding. If it still does not work, ask your
          provider for a public IP address.
        </p>
      </details>
    </div>
  )
}
```

- [ ] **Step 5: Write the detail page**

`src/renderer/src/pages/ServerDetail.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { Button, ErrorText, StatusBadge, TypeBadge } from '../components/ui'
import { api, ApiCallError, errorMessage } from '../lib/api'
import { ConnectTab } from './tabs/ConnectTab'
import { ConsoleTab } from './tabs/ConsoleTab'
import { PropertiesTab } from './tabs/PropertiesTab'
import { SettingsTab } from './tabs/SettingsTab'

type Tab = 'console' | 'properties' | 'settings' | 'connect'

const TABS: { id: Tab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'properties', label: 'Properties' },
  { id: 'settings', label: 'Settings' },
  { id: 'connect', label: 'Connect' }
]

const FORCE_KILL_AFTER_MS = 30_000

interface Props {
  server: ServerView
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
}

export function ServerDetail({ server, onBack, onChanged, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('console')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingJava, setMissingJava] = useState<number | null>(null)
  const [showKill, setShowKill] = useState(false)

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
      const major = err instanceof ApiCallError && err.code === 'JAVA_MISSING' ? err.details?.major : undefined
      if (typeof major === 'number') setMissingJava(major)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = server.installState === 'ready'
  const up = server.status === 'starting' || server.status === 'running'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <Button variant="ghost" onClick={onBack}>
          ← Servers
        </Button>
        <h1 className="text-lg font-semibold">{server.name}</h1>
        <TypeBadge server={server} />
        {ready && <StatusBadge status={server.status} />}
        <div className="ml-auto flex gap-2">
          {ready && !up && server.status !== 'stopping' && (
            <Button variant="primary" disabled={busy} onClick={() => void run(() => api.start(server.id))}>
              Start
            </Button>
          )}
          {up && (
            <>
              <Button disabled={busy} onClick={() => void run(() => api.stop(server.id))}>
                Stop
              </Button>
              <Button disabled={busy || server.status !== 'running'} onClick={() => void run(() => api.restart(server.id))}>
                Restart
              </Button>
            </>
          )}
          {server.status === 'stopping' && showKill && (
            <Button variant="danger" onClick={() => void run(() => api.kill(server.id))}>
              Force kill
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="space-y-2 px-6 pt-4">
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

      {!ready ? (
        <div className="min-h-0 flex-1 overflow-auto p-6">
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
        </div>
      ) : (
        <>
          <nav className="flex gap-1 border-b border-zinc-800 px-6">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-3 py-2 text-sm ${
                  tab === t.id
                    ? 'border-emerald-500 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className={`min-h-0 flex-1 p-6 ${tab === 'console' ? 'overflow-hidden' : 'overflow-auto'}`}>
            {tab === 'console' && <ConsoleTab server={server} />}
            {tab === 'properties' && <PropertiesTab server={server} onChanged={onChanged} />}
            {tab === 'settings' && <SettingsTab server={server} onChanged={onChanged} onDeleted={onDeleted} />}
            {tab === 'connect' && <ConnectTab server={server} />}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Route to the detail page from App**

In `src/renderer/src/App.tsx`:
- Add the import: `import { ServerDetail } from './pages/ServerDetail'`
- Replace the line
  ```tsx
        {route.name === 'server' && <p className="p-6 text-zinc-400">{current?.name}</p>}
  ```
  with
  ```tsx
        {route.name === 'server' &&
          (current ? (
            <ServerDetail
              server={current}
              onBack={goList}
              onChanged={() => void refresh()}
              onDeleted={() => {
                void refresh()
                goList()
              }}
            />
          ) : (
            <p className="p-6 text-zinc-400">This server no longer exists.</p>
          ))}
  ```

- [ ] **Step 7: Verify in the running app**

Run: `npm run typecheck && npm test`
Expected: PASS.

Run: `npm run dev`, open the server created in Task 17, and check each of these:
1. **Start:** the status goes Starting… then Running. The console streams the server log and the `Done (…s)!` line appears.
2. **Commands:** typing `list` and pressing Enter shows `> list` in green, followed by the server's reply. The ↑ key recalls `list`.
3. **Properties:** set Max players to 10 and Save. The notice says "Restart the server to apply the changes." `server.properties` on disk now has `max-players=10`, and the comment header lines are unchanged.
4. **Restart:** the status goes Stopping…, then Starting…, then Running.
5. **Connect:** shows `localhost:25565`, your LAN IP and your public IP. Copy works.
6. **Settings:** move RAM to 3 GB and Save. After a restart, the console's `[Blockhost] Starting:` line shows `-Xmx3072M`.
7. **Stop:** the status goes to Stopped and the console shows `[Blockhost] Server exited with code 0`.
8. **Quit while running:** start the server again and close the window. The "A server is still running" dialog appears. "Stop servers and quit" closes the app after the server stops, and no `java.exe` stays behind in Task Manager.
9. **Delete:** delete the server with "Keep the world and files" ticked. It disappears from the list, and its folder is still on disk.

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: add server detail page with console, properties, settings and connect tabs"
```

---

### Task 19: Integration test, packaging, docs

**Files:**
- Create: `vitest.integration.config.ts`, `src/main/integration/paper.integration.test.ts`, `README.md`, `docs/smoke-test.md`

**Interfaces:**
- Consumes: every main-process module (Tasks 2–15)
- Produces: `npm run test:integration` and the Windows installer from `npm run build:win` (`dist/Blockhost-0.1.0-setup.exe`)

- [ ] **Step 1: Write the integration config and test**

`vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000
  }
})
```

`src/main/integration/paper.integration.test.ts`:
```ts
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
    processes.stop(rec.id)
    expect(await processes.waitForExit(rec.id, 120_000)).toBe(true)
    expect(processes.status(rec.id)).toBe('stopped')
    expect(processes.getLog(rec.id).some((line) => line.includes(`:${port}`))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `npm run test:integration`
Expected: PASS in a few minutes. It downloads Temurin 25 and the latest Paper into a temp folder, starts the server, waits for `Done`, sends `stop` and confirms a clean exit. If it fails, the assertion message contains the install error lines.

- [ ] **Step 3: Write the README and the smoke checklist**

`README.md`:
````markdown
# Blockhost

A Windows app that sets up and runs Minecraft Java Edition servers in a few clicks.

- Server types: Vanilla, Paper, Purpur, Fabric, Forge, NeoForge
- Downloads the right Java (Eclipse Temurin) automatically, or uses your own
- Live console with commands, `server.properties` editor, RAM and JVM settings
- Shows LAN and public addresses, with a port-forwarding guide

## Develop

```bash
npm install
npm run dev               # start the app with hot reload
npm test                  # unit tests
npm run test:integration  # real download + start of a Paper server (slow, needs internet)
npm run build:win         # build dist/Blockhost-<version>-setup.exe
```

## Where things live

- App data: `%APPDATA%\Blockhost\` (`servers.json`, `java\temurin-<major>\`, `cache\`)
- Servers: `Documents\MinecraftServers\<name>` by default, chosen per server

## Architecture

All side effects run in the Electron main process (`src/main`): providers per server type, Java
management, the process manager and the server service. The sandboxed renderer (`src/renderer`)
reaches them only through the allow-listed `window.blockhost` bridge (`src/preload`, `src/shared/api.ts`),
and every call is validated with zod. The design spec is in `docs/superpowers/specs/`.
````

`docs/smoke-test.md`:
```markdown
# Manual smoke test (packaged build)

Run on a clean Windows 10/11 machine (no Java installed) using `dist/Blockhost-<version>-setup.exe`.

- [ ] Installer runs per-user, creates a desktop shortcut, and the app opens
- [ ] For each type (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge), on its newest stable version:
  - [ ] the wizard creates the server and the install completes
  - [ ] Start reaches Running; `list` returns a reply in the console
  - [ ] the client joins via `localhost:<port>`
  - [ ] Stop reaches Stopped with exit code 0
- [ ] One legacy version (Paper 1.16.5) installs Java 8 and starts
- [ ] Changing `max-players` in Properties is applied after a restart
- [ ] A second server on the same port shows "Port … is already in use" when started while the first runs
- [ ] Closing the app with a running server shows the stop-and-quit dialog, and no java.exe remains
- [ ] Disconnecting from the network still shows cached version lists with the offline banner
- [ ] Uninstall via Windows Settings removes the app (server folders remain)
```

- [ ] **Step 4: Build the installer**

Run: `npm run build:win`
Expected: typecheck and build pass, and `dist/Blockhost-0.1.0-setup.exe` is created. Run it: the app installs per-user and opens to the empty server list. SmartScreen may warn because the installer is unsigned.

- [ ] **Step 5: Commit**

```bash
git add vitest.integration.config.ts src/main/integration README.md docs/smoke-test.md
git commit -m "test: add Paper end-to-end integration test; docs: README and smoke checklist"
```
