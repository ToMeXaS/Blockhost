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
