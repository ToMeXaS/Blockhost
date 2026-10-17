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

## Releasing an update

1. `npm version patch` (or `minor`)
2. Set a GitHub token with permission to upload release assets:
   - PowerShell: `$env:GH_TOKEN = gh auth token`
   - bash: `export GH_TOKEN=$(gh auth token)`
3. `npm run release` — builds and uploads `Blockhost-<version>-setup.exe`, its `.blockmap` and
   `latest.yml` to a GitHub release `v<version>` on `ToMeXaS/blockhost`. Installed apps pick up the
   new version within 4 hours, or on next launch.

Updates only work in installed builds (`npm run dev` never checks). Unsigned builds may show a
SmartScreen warning on first install only.

## Architecture

All side effects run in the Electron main process (`src/main`): providers per server type, Java
management, the process manager and the server service. The sandboxed renderer (`src/renderer`)
reaches them only through the allow-listed `window.blockhost` bridge (`src/preload`, `src/shared/api.ts`),
and every call is validated with zod. The design spec is in `docs/superpowers/specs/`.
