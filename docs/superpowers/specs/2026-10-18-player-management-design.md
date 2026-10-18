# Blockhost — Player Management — Design

Date: 2026-10-18
Status: Draft for review

## 1. Goal

Let a server owner see who is online and manage operators, the whitelist, and
bans from a Players tab, whether the server is running or stopped, without
typing console commands.

This is sub-project 1 of 3 (player management → tunnel integration →
mod/plugin browser); each gets its own spec, plan, and implementation.

### In scope
- Online-now list (from console join/leave lines) with Kick / Op / Ban per player.
- Operators: list, add, remove.
- Whitelist: list, add, remove, on/off toggle.
- Bans: players (with optional reason) and IPs; list, ban, pardon.
- Works for all six server types, running or stopped.

### Out of scope
Per-player stats (playtime, last seen), op permission levels other than the
server default, temporary bans, RCON.

## 2. Approach

Commands while running, files while stopped.

- **Running:** the server owns `ops.json`, `whitelist.json`,
  `banned-players.json`, `banned-ips.json` (it holds them in memory and
  overwrites them). Every action is sent as a console command over the existing
  stdin pipe (`ProcessManager.sendCommand`). The lists are then re-read from
  disk after a short debounce (500 ms), because the server rewrites the files
  immediately after each command.
- **Stopped / crashed:** the app edits the JSON files directly. Adding a player
  needs a UUID (see §3.2).
- **Starting / stopping:** actions are rejected with a `SERVER_BUSY` error; the
  UI disables controls in these states.

Rejected alternatives: stopped-only editing (cannot act in the moment); RCON
(extra port and password to manage, duplicates stdin).

## 3. Main-process modules

```
src/main/players/
  files.ts      read/write the four list files
  uuid.ts       username → UUID
  tracker.ts    per-server online set from log lines
  service.ts    PlayerService: snapshot + action dispatch
```

### 3.1 `files.ts`

Reads and writes the vanilla formats:

- `ops.json`: `[{ uuid, name, level, bypassesPlayerLimit }]` — new entries use
  `level` from `op-permission-level` in `server.properties` (default 4) and
  `bypassesPlayerLimit: false`.
- `whitelist.json`: `[{ uuid, name }]`.
- `banned-players.json`: `[{ uuid, name, created, source, expires, reason }]`.
- `banned-ips.json`: `[{ ip, created, source, expires, reason }]`.
- New ban entries: `created` in the server's format
  (`yyyy-MM-dd HH:mm:ss Z`, e.g. `2026-10-18 14:03:00 +0000`),
  `source: "Blockhost"`, `expires: "forever"`, `reason` defaulting to
  `"Banned by an operator."`.
- Writes use `writeFileAtomic` from `util/fs.ts`.
- A missing file reads as an empty list. A file that fails to parse reads as an
  empty list flagged `corrupt: true`; file edits to a corrupt file are refused
  (`LIST_FILE_CORRUPT`) unless the action carries `overwriteCorrupt: true`,
  which the UI sets only after the user confirms.
- Unknown fields on existing entries are preserved on rewrite.

### 3.2 `uuid.ts`

- `online-mode=true` (the default): `GET
  https://api.mojang.com/users/profiles/minecraft/<name>`; a 404 or 204 raises
  `PLAYER_NOT_FOUND` ("No Minecraft account named X"). The returned undashed id
  is formatted as a dashed UUID; the canonical name from the response is stored.
- `online-mode=false`: offline UUID — version-3 UUID of the MD5 of
  `"OfflinePlayer:" + name`, matching the server's own derivation. No network.
- Network failure surfaces the existing network error, with a hint that an
  offline-mode server does not need the lookup.
- Only used for file edits while stopped; running servers resolve names
  themselves.

### 3.3 `tracker.ts`

Per-server online set fed by the same log lines the console gets (after ANSI
stripping):

- Join: `/: ([A-Za-z0-9_]{3,16}) joined the game$/`
- Leave: `/: ([A-Za-z0-9_]{3,16}) left the game$/`
- Anchoring on the `: ` logger prefix (rather than matching anywhere) prevents
  chat spoofing, since chat lines are formatted `<name> message`.
- Resync: when the `Done (…)!` line is seen, the tracker sends `list`; the reply
  `There are N of a max of M players online: a, b` replaces the whole set. This
  covers loaders whose join lines differ.
- Cleared when the server stops or crashes.
- Emits a change notification whenever the set changes.

### 3.4 `service.ts` — `PlayerService`

```ts
getPlayers(serverId): Promise<PlayerLists>
action(serverId, action: PlayerAction): Promise<PlayerLists>
```

`PlayerLists`:
```ts
{
  online: string[]            // empty unless running
  ops: { uuid, name, level }[]
  whitelist: { uuid, name }[]
  whitelistEnabled: boolean   // `white-list` in server.properties
  bannedPlayers: { uuid, name, reason, created }[]
  bannedIps: { ip, reason, created }[]
  corrupt: ListName[]         // files that failed to parse
}
```

`PlayerAction` (discriminated union on `type`):

| type                  | fields              | running command          | stopped behaviour                         |
|-----------------------|---------------------|--------------------------|-------------------------------------------|
| `op`                  | name                | `op <name>`              | add to ops.json                           |
| `deop`                | name                | `deop <name>`            | remove from ops.json                      |
| `whitelistAdd`        | name                | `whitelist add <name>`   | add to whitelist.json                     |
| `whitelistRemove`     | name                | `whitelist remove <name>`| remove from whitelist.json                |
| `setWhitelistEnabled` | enabled             | `whitelist on` / `off`   | set `white-list` in server.properties     |
| `ban`                 | name, reason?       | `ban <name> [reason]`    | add to banned-players.json                |
| `pardon`              | name                | `pardon <name>`          | remove from banned-players.json           |
| `banIp`               | ip, reason?         | `ban-ip <ip> [reason]`   | add to banned-ips.json                    |
| `pardonIp`            | ip                  | `pardon-ip <ip>`         | remove from banned-ips.json               |
| `kick`                | name, reason?       | `kick <name> [reason]`   | rejected (`SERVER_NOT_RUNNING`)           |

All actions also accept optional `overwriteCorrupt?: boolean` (stopped path only).

Input validation (zod, in `schemas.ts`):
- `name`: `^[A-Za-z0-9_]{3,16}$`.
- `ip`: IPv4 dotted quad or IPv6 (validated with `net.isIP`).
- `reason`: max 200 chars, no newlines or control characters.

These rules guarantee nothing can inject a second console command.

Removing by name matches case-insensitively. Adding a name that is already
present is a no-op that returns the current snapshot.

While running, the service watches the four list files (`fs.watch`, debounced
500 ms) and emits `players:changed` when they change; the watchers are closed
when the server stops.

## 4. IPC

New invoke channels (zod-validated like the existing ones):
- `players:get(serverId)` → `PlayerLists`
- `players:action(serverId, action)` → `PlayerLists`

New event:
- `players:changed { serverId }` — online set changed or a list file was
  rewritten; the renderer re-fetches.

New error codes: `SERVER_BUSY`, `SERVER_NOT_RUNNING`, `PLAYER_NOT_FOUND`,
`LIST_FILE_CORRUPT`.

## 5. UI — Players tab

New tab on the server detail page, between Console and Properties.

```
┌ Online now (3) ──────────────────────────────┐
│ Steve        [Kick] [Op] [Ban]                │
│ Alex   (op)  [Kick] [Deop] [Ban]              │
└───────────────────────────────────────────────┘
┌ Operators ─────┐ ┌ Whitelist  [● On] ┐ ┌ Banned ──────────────┐
│ Alex      [×]  │ │ Steve       [×]   │ │ Players | IPs        │
│ [name ][Add]   │ │ [name ][Add]      │ │ Griefer1 "reason" [Pardon] │
└────────────────┘ └───────────────────┘ │ [name ][reason][Ban] │
                                         └──────────────────────┘
```

- "Online now" is shown only while running; otherwise a note: "Server is
  offline — changes are saved to files and apply on next start."
- Ban and Kick open a confirm dialog with an optional reason field.
- All controls are disabled while starting or stopping, with a hint.
- Name inputs validate client-side with the same regex and show the error
  inline.
- A corrupt list shows a warning banner; the first edit to it asks for
  confirmation, then sends `overwriteCorrupt: true`.
- Errors use the existing error display.

## 6. Testing

Vitest, TDD.
- `files.ts`: round-trip real vanilla file samples; unknown fields preserved;
  missing file → empty; corrupt file → flagged and edits refused.
- `uuid.ts`: offline UUID matches a vector taken from a real offline-mode
  server's `usercache.json` (captured during implementation, not hand-computed);
  Mojang lookup mocked for
  found / 404 / network error.
- `tracker.ts`: real join/leave lines from Vanilla, Paper, and Forge; `list`
  reply resync; a chat line `<Bob> Steve joined the game` does not add Steve;
  cleared on stop.
- `service.ts`: running → correct command string per action; stopped → correct
  file edit; starting/stopping → `SERVER_BUSY`; kick while stopped →
  `SERVER_NOT_RUNNING`.
- `schemas.ts`: injection attempts in name / reason (`Steve\nstop`) rejected.
- Integration (opt-in Paper test): after `Done`, `op` a name via the service,
  wait for the file watcher, assert it appears in `ops.json`.
