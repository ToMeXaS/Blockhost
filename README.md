# Blockhost

A Windows app that sets up and runs Minecraft Java Edition servers in a few clicks.

- Server types: Vanilla, Paper, Purpur, Fabric, Forge, NeoForge
- Downloads the right Java (Eclipse Temurin) automatically, or uses your own
- Dashboard with players, TPS, CPU and memory, a last-hour performance chart, world sizes and
  disk usage
- Live console with commands, `server.properties` editor, RAM, JVM and disk-limit settings
- Players: who's online, for how long and in which dimension; ops, whitelist and bans
- Mods and plugins from Modrinth, with dependencies, updates and removal
- Backups on demand or every 1–24 hours, with retention; restore in place or as a new server
- Shows LAN and public addresses with a port-forwarding guide, or shares the server through a
  free playit.gg tunnel without port forwarding
- Updates itself from GitHub Releases

## Develop

```bash
npm install
npm run dev               # start the app with hot reload
npm test                  # unit tests
npm run test:integration  # real download + start of a Paper server (slow, needs internet)
npm run build:win         # build dist/Blockhost-<version>-setup.exe
```

## Where things live

- App data: `%APPDATA%\Blockhost\` (`servers.json`, `settings.json`, `java\temurin-<major>\`,
  `playit\`, `cache\`)
- Backups: `%APPDATA%\Blockhost\backups\` by default, changeable in the app
- Servers: `Documents\MinecraftServers\<name>` by default, chosen per server

Updating or reinstalling the app leaves servers, settings and backups alone.

## Releasing an update

1. `npm version patch` (or `minor`)
2. `git push --follow-tags`

Pushing a `v*` tag runs the [Release workflow](.github/workflows/release.yml): it checks the tag
matches `package.json`, runs the tests, builds `Blockhost-<version>-setup.exe` and uploads it with
its `.blockmap` and `latest.yml` to a **draft** GitHub release on `ToMeXaS/blockhost`.

The draft's notes are written from the commit messages since the previous tag, so write them as
[conventional commits](https://www.conventionalcommits.org/): `feat:` goes under *New*, `fix:` under
*Fixes*, other types under *Other changes*, and `ci`, `docs`, `test`, `chore`, `build` and `style`
are left out. Review the draft, then publish it. Installed apps check on launch, every 15 minutes and
on wake, download the update in the background, and install it silently once the user chooses to.

To publish from your machine instead, set `GH_TOKEN` (PowerShell: `$env:GH_TOKEN = gh auth token`)
and run `npm run release`.

Updates only work in installed builds (`npm run dev` never checks). Unsigned builds may show a
SmartScreen warning on first install only.

## Architecture

All side effects run in the Electron main process (`src/main`): providers per server type, Java
management, the process manager, and the server, player, content, backup and tunnel services. The
sandboxed renderer (`src/renderer`) reaches them only through the allow-listed `window.blockhost`
bridge (`src/preload`, `src/shared/api.ts`), and every call is validated with zod.
