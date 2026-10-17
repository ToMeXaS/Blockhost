# Blockhost — Minecraft Server Manager (Windows, Electron) — Design

Date: 2026-10-17
Status: Draft for review

## 1. Goal

A Windows desktop app that lets a non-expert create, run, and manage Java Edition
Minecraft servers in a few clicks: pick a server type and version, choose RAM and
port, accept the EULA, and get a running server with a live console.

### In scope (v1)
- Server types: Vanilla, Paper, Purpur, Fabric, Forge, NeoForge.
- Automatic Java (Eclipse Temurin via Adoptium) per server, with optional custom Java path override.
- Dashboard: server list, start/stop/restart, live console with command input,
  `server.properties` editor, RAM / JVM args settings.
- Connect info: LAN IP, public IP, port, port-forwarding guide.
- Windows NSIS installer.

### Out of scope (v1)
Backups, player management (ops/whitelist/bans UI), mod/plugin browser, UPnP,
tunnels (playit.gg etc.), Bedrock, app auto-update, macOS/Linux builds
(code stays portable; not tested).

## 2. Stack

- Electron + electron-vite + React + TypeScript
- Tailwind CSS for styling
- electron-builder (NSIS target) for packaging
- zod for IPC input validation
- Vitest for unit tests
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  for the renderer; all side effects live in the main process.

## 3. Architecture

```
src/
  main/
    index.ts              app lifecycle, BrowserWindow
    ipc.ts                registers typed IPC handlers (zod-validated)
    providers/            one per server type, common interface
      types.ts            ServerProvider interface, LaunchSpec
      vanilla.ts          Mojang piston-meta version manifest
      paper.ts            PaperMC API
      purpur.ts           Purpur API
      fabric.ts           meta.fabricmc.net server launcher jar
      forge.ts            Forge maven installer -> --installServer
      neoforge.ts         NeoForge maven installer -> --installServer
    java/
      requirements.ts     MC version -> required Java major
      adoptium.ts         list/download/extract Temurin JRE
      detect.ts           validate custom java path (`java -version`)
    servers/
      store.ts            servers.json registry
      installer.ts        orchestrates provider + java + eula + initial config
      process.ts          spawn/stop/restart, log ring buffer, stdin
      properties.ts       parse/serialize server.properties, preserving comments/order
    net/
      download.ts         streaming download, progress, hash verify, retries
      ip.ts               LAN IPs, public IP lookup
      port.ts             port availability check
    cache.ts              1h API response cache on disk
  preload/index.ts        exposes typed `window.api`
  shared/types.ts         types shared by main & renderer
  renderer/               React UI
```

### 3.1 Provider interface

```ts
interface ServerProvider {
  type: ServerType; // 'vanilla' | 'paper' | 'purpur' | 'fabric' | 'forge' | 'neoforge'
  listVersions(): Promise<{ id: string; stable: boolean }[]>;
  listBuilds?(version: string): Promise<{ id: string; stable: boolean }[]>;
  install(opts: {
    dir: string; version: string; build?: string; javaPath: string;
    onProgress: (p: InstallProgress) => void;
  }): Promise<LaunchSpec>;
}

type LaunchSpec =
  | { kind: 'jar'; jar: string }              // java <jvm> -jar <jar> nogui
  | { kind: 'argsFile'; argsFile: string };   // java <jvm> @<argsFile> nogui (modern Forge/NeoForge)
```

Adding a new server type = one new provider file + registration.

Per-provider notes:
- **Vanilla**: `piston-meta.mojang.com/mc/game/version_manifest_v2.json` -> version JSON -> `downloads.server` (sha1 verified). Versions without a server download are hidden.
- **Paper / Purpur**: versions and builds from their APIs; download jar; verify hash where provided.
- **Fabric**: download the server launcher jar for (game version, latest stable loader, latest installer).
- **Forge / NeoForge**: download installer jar, run `java -jar installer.jar --installServer` in the server dir with the managed Java, stream its output into the install log. The generated `libraries/.../win_args.txt` becomes the args file. Legacy Forge (pre-1.17) yields a plain jar.

### 3.2 Java management

- `requirements.ts`: MC >= 1.20.5 -> Java 21; 1.17-1.20.4 -> 17; <= 1.16.5 -> 8. Snapshots/unknown -> 21.
- Managed JREs stored at `%APPDATA%/Blockhost/java/temurin-<major>/`, downloaded from the Adoptium API (windows, x64, jre, hotspot), zip extracted, checksum verified. Downloaded once, shared by all servers needing that major.
- Each server has an optional `javaPath` override; validated on save via `java -version`, major version compared to the requirement (warning, not a block, on mismatch).

### 3.3 Data model

`%APPDATA%/Blockhost/servers.json`:

```ts
interface ServerRecord {
  id: string;            // uuid
  name: string;
  type: ServerType;
  mcVersion: string;
  build?: string;
  dir: string;           // default Documents/MinecraftServers/<name>
  ramMb: number;
  port: number;
  javaPath?: string;     // override
  jvmArgs: string[];     // extra args
  launch?: LaunchSpec;   // set when install completes
  installState: 'installing' | 'ready' | 'failed';
  createdAt: string;
}
```

Writes are atomic (write temp file, then rename).

## 4. UI

### 4.1 Server list (home)
Card per server: name, type icon, version, status dot (stopped / starting / running / crashed / installing / failed), quick Start/Stop. "+ New server" button.

### 4.2 New Server wizard
1. **Type & version**: type picker, version dropdown (releases by default, "show snapshots" toggle), build selector for Paper/Purpur (default latest).
2. **Settings**: name (unique), folder (picker; default as above; must be empty or nonexistent), RAM slider (default min(25% system RAM, 8 GB), minimum 1 GB), port (default 25565, live availability check), EULA checkbox linking to https://aka.ms/MinecraftEULA (required to continue).
3. **Install**: step list (Java -> server files -> installer -> config -> done) with live log; on completion "Open server". On failure: Retry / Delete.

Install writes `eula.txt` (`eula=true`) and an initial `server.properties` containing `server-port` and `motd`.

### 4.3 Server detail (tabs)
- **Console**: streaming log (ANSI stripped), command input with up/down history, Start/Stop/Restart.
- **Properties**: form for common keys (motd, max-players, gamemode, difficulty, pvp, online-mode, white-list, view-distance, server-port) plus an "Advanced" raw key/value table. Saving while running shows "takes effect after restart". Unknown keys are preserved.
- **Settings**: RAM, Java override path, extra JVM args, Open folder, Delete server (confirm; option to keep files). Changing the port here also updates `server.properties`.
- **Connect**: LAN IP:port, public IP:port (fetched on open from api.ipify.org), copy buttons, collapsible port-forwarding guide (forward TCP <port>; allow Java through Windows Firewall).

## 5. Data flow (IPC)

Renderer -> main via `ipcRenderer.invoke` through `window.api`:
- `providers.listVersions(type)`, `providers.listBuilds(type, version)`
- `servers.list()`, `servers.create(input)`, `servers.retryInstall(id)`, `servers.update(id, patch)`, `servers.delete(id, keepFiles)`
- `servers.start(id)`, `servers.stop(id)`, `servers.restart(id)`, `servers.kill(id)`, `servers.sendCommand(id, cmd)`, `servers.getLog(id)`
- `properties.read(id)`, `properties.write(id, entries)`
- `system.info()` (total RAM), `net.info(port)`, `net.checkPort(port)`, `shell.openFolder(id)`, `dialog.pickFolder()`, `dialog.pickJava()`

Main -> renderer events: `server:status`, `server:log` (batched ~50 ms), `install:progress`.

All handler inputs are validated with zod. Executable paths come only from the main-process file dialog (`dialog.pickJava`) and are validated in main.

## 6. Process lifecycle

- Spawn: `<java> -Xms<ram/2>M -Xmx<ram>M <jvmArgs> (-jar <jar> | @<argsFile>) nogui`, cwd = server dir, `windowsHide: true`.
- Status: `starting` on spawn; `running` when a log line matches `/Done \(\d+(\.\d+)?s\)!/`; `stopped` on exit after a requested stop; `crashed` on unrequested exit.
- Log: per-server ring buffer of 5,000 lines; the console view backfills, then streams.
- Stop: write `stop\n` to stdin; if not exited after 30 s, the UI offers Force kill (`taskkill /PID <pid> /T /F`).
- App quit with running servers: dialog "Stop servers and quit" (graceful, waits for exit) / "Cancel".
- Before start: port availability check and Java requirement check.

## 7. Error handling

- Downloads: 3 retries with exponential backoff; `.part` temp file renamed on success; SHA1/SHA256 verified when the API provides it.
- API: responses cached 1 h in `%APPDATA%/Blockhost/cache`; offline -> use cache + banner; no cache -> clear error.
- Install failure: `installState: 'failed'`, log shown, Retry / Delete offered.
- Java missing/mismatched: Start blocked with a message + "Install Java N" action.
- Port in use: Start blocked; message names the port.
- Forge/NeoForge installer non-zero exit: its output is surfaced in the install log.
- Errors cross IPC as `{ code, message }` and render as toasts or inline messages.

## 8. Testing

- **Unit (Vitest):** Java requirement mapping; properties parse/serialize round-trip (comments, order, escapes); each provider's parsing using recorded fixture JSON; log batcher; status detection regex; store atomic write/read; zod schemas.
- **Integration (opt-in, `npm run test:integration`):** install a real Paper server to a temp dir, start it, wait for Done, send `stop`, assert clean exit.
- **Manual smoke checklist:** create and start one server of each type on a clean Windows machine via the packaged installer.

## 9. Packaging

electron-builder NSIS installer, per-user install, app id `com.blockhost.app`. No code signing in v1 (SmartScreen warning expected).
