# Blockhost — Tunnel Integration (playit.gg) — Design

Date: 2026-10-18
Status: Draft for review

## 1. Goal

Let friends join a Blockhost server over the internet without port forwarding,
by sharing it through a playit.gg tunnel from the Connect tab.

This is sub-project 2 of 3 (player management → tunnel integration →
mod/plugin browser).

### In scope

- One playit.gg account link for the whole app (browser claim flow).
- A per-server "Share over the internet" switch; the tunnel runs while that
  server runs.
- Automatic creation of a `minecraft-java` tunnel per shared server, with a
  stable public address shown and copyable.
- Managing the playit agent (`playitd`) as a child process: download, start,
  restart, stop.

### Out of scope

Other tunnel providers (ngrok, Tailscale, ZeroTier), UDP/Bedrock tunnels,
custom domains, paid playit features, choosing tunnel regions.

## 2. Facts this design relies on

Checked against the playit-agent source and releases on 2026-10-18:

- Latest release v1.0.12 (2026-10-01), BSD-2-Clause.
- The Windows asset `playit-windows-x86_64-signed.exe` is the `playitd`
  daemon itself (release workflow uploads `target/.../playitd.exe` under that
  name). Size 4,864,056 bytes,
  sha256 `367fb813a20c67c7501e3921298ce51a641e5b25e6005f6059808f89404ba44b`,
  URL `https://github.com/playit-cloud/playit-agent/releases/download/v1.0.12/playit-windows-x86_64-signed.exe`.
- `playitd` options: `--secret <key>` | `--secret-path <file>`,
  `--socket-path <pipe>`, `-l/--log-path <file>`. Without `-l` it logs to
  stderr, which is how Blockhost reads its status. A `.toml` secret file has
  the form `secret_key = "<key>"`. Its user-facing error lines include
  "Could not connect to playit tunnel servers…", "Could not reach the playit
  API…", "The configured playit secret is no longer valid…", "The playit API
  rejected…", "Timed out while connecting to playit…"; success logs
  "playit connected; tunnels loaded".
- API base `https://api.playit.gg`; JSON POST; authenticated calls send
  `Authorization: Agent-Key <secret>`. Responses are an envelope
  `{status: "success", data}` | `{status: "fail", data: "<Reason>"}` |
  `{status: "error", data: {type: "auth"|"validation"|"path-not-found"|"internal", message}}`
  (auth messages include `InvalidAgentKey`, `NoLongerValid`,
  `ScopeNotAllowed`).
- Claim flow (unauthenticated): random code → user visits
  `https://playit.gg/claim/<code>` → poll `POST /claim/setup
{code, agent_type: "self-managed", version}` until `UserAccepted`
  (other states: `WaitingForUserVisit`, `WaitingForUser`, `UserRejected`;
  fail `CodeExpired`) → `POST /claim/exchange {code}` returns
  `{secret_key}` (fail `NotAccepted` while waiting, `CodeExpired`,
  `CodeNotFound`, `UserRejected`).
- `POST /v1/agents/rundata` (what playitd itself uses) returns `agent_id`,
  `tunnels[]` (each with `id`, `name`, `display_address`, `tunnel_type`,
  `agent_config.fields[]` holding `local_ip` / `local_port`,
  `disabled_reason`) and `pending[]`.
- `POST /v1/tunnels/create {ports: {type: "tunnel-type", details:
"minecraft-java"}, origin: {type: "agent", data: {agent_id, config:
{fields: [{name: "local_ip", value}, {name: "local_port", value}]}}},
enabled, alloc: null, name, firewall_id: null}` returns `{id}`; fail
  reasons include `RequiresPlayitPremium`, `RequiresVerifiedAccount`,
  `TunnelNameIsNotAscii`, `TunnelNameTooLong`.
  `POST /v1/tunnels/config {tunnel_id, new_agent_id: null, new_config}`
  changes the local port; `POST /tunnels/delete {tunnel_id}` deletes.

**Unverified:** whether a self-managed agent's key may call `/v1/tunnels/create`
(vs. only the website session). The first implementation task is a live check;
§4.5 is the fallback if it may not.

## 3. Approach

Download the agent on demand and drive everything from the main process.

- `playitd.exe` is downloaded the first time sharing is turned on (same
  pattern as Temurin Java), pinned to v1.0.12 and verified by sha256, into
  `<dataDir>/playit/playitd-1.0.12.exe`.
- Account linking and tunnel management use playit's HTTP API from
  TypeScript.
- The agent runs as an app-owned child process.

Rejected: bundling `playitd.exe` in the installer (bigger install for
everyone, agent updates tied to app releases); requiring playit's own Windows
installer/service (admin rights, outside the app's control).

## 4. Main-process modules

```
src/main/tunnel/
  binary.ts     ensure playitd.exe (download pinned asset, verify sha256, cache)
  api.ts        playit API client
  account.ts    link / unlink (claim flow), secret file
  agent.ts      AgentProcess: run and supervise playitd
  service.ts    TunnelService: per-server sharing, tunnels, status
```

### 4.1 `binary.ts`

- `ensurePlayitd(): Promise<string>` returns the exe path; downloads via the
  existing `downloadFile` with sha256 verification if missing; reports
  progress as `tunnel:status` state `downloading`.
- A file whose hash does not match is deleted and re-downloaded once.

### 4.2 `api.ts`

`PlayitApi` over an injected `fetch`:

- `claimSetup(code)`, `claimExchange(code)` — no auth.
- `rundata(secret)`, `createTunnel(secret, {agentId, localPort, name})`,
  `updateTunnelPort(secret, tunnelId, localPort)`,
  `deleteTunnel(secret, tunnelId)` — `Authorization: Agent-Key <secret>`.
- Errors: network → `NETWORK`; HTTP 401/403 or an auth-failure body →
  `PLAYIT_UNAUTHORIZED`; API `fail` bodies → `PLAYIT_API` with the reason in
  `details`; tunnel limit reached → `PLAYIT_TUNNEL_LIMIT`; create refused for
  permissions → `PLAYIT_CREATE_FORBIDDEN`.

### 4.3 `account.ts`

- `isLinked()`: the secret file `<dataDir>/playit/playit.toml` exists and
  holds a non-empty `secret_key`.
- `link(signal)`: generate a code (32 random hex chars), open
  `https://playit.gg/claim/<code>` with `shell.openExternal`, poll
  `claimSetup` every 2 s until `UserAccepted`, then poll `claimExchange`
  every 2 s until it returns the key; write `secret_key = "<key>"` atomically.
  `UserRejected` → `PLAYIT_CLAIM_REJECTED`; 10 minutes without acceptance or
  an expired code → `PLAYIT_CLAIM_EXPIRED`; aborting the signal → `CANCELLED`.
  Only one link attempt at a time.
- `unlink()`: stop the agent, delete the secret file, clear stored
  `tunnelId`/`address` on all servers. Tunnels stay on the playit account.
- The secret is stored as plain text in the app's data folder (playitd needs
  it as a file; playit's own installer stores it the same way).

### 4.4 `agent.ts` — `AgentProcess`

- Spawn `playitd.exe --secret-path <toml> --socket-path
\\.\pipe\blockhost-playitd` (no `-l`, so logs arrive on stderr), windowsHide,
  stdout/stderr piped.
- Status from output lines: `playit connected; tunnels loaded` → connected;
  a line containing `Could not connect to playit tunnel servers` or `rejected
the agent registration` → error with that text; an invalid-secret message →
  `PLAYIT_UNAUTHORIZED` (account treated as unlinked).
- Unexpected exit → restart after 2 s, 5 s, 15 s; a fourth failure → error
  state until Retry. A successful connection resets the counter.
- `stop()` kills the process tree (existing `killTree`); also on app quit.

### 4.5 `service.ts` — `TunnelService`

State per server lives on `ServerRecord.tunnel?: { enabled: boolean;
tunnelId?: string; address?: string }` (persisted in `servers.json`).

- `setShared(serverId, enabled)`: requires a linked account
  (`PLAYIT_NOT_LINKED` otherwise). Enabling while the server is running
  starts sharing immediately; disabling stops traffic for that server.
- Server status → agent: the agent runs while at least one server with
  `tunnel.enabled` is `starting`/`running`; it stops when the last one
  stops (a tunnel's traffic only reaches a running server anyway).
- Ensuring the tunnel when sharing starts:
  1. `rundata` → `agent_id` and existing tunnels.
  2. If `tunnelId` is stored and present in rundata, reuse it; if its local
     port differs from `ServerRecord.port`, `updateTunnelPort`.
  3. Else create `minecraft-java` → `127.0.0.1:<port>`, name
     `Blockhost: <server name>`; store `tunnelId`.
  4. Fallback when create returns `PLAYIT_CREATE_FORBIDDEN`: state
     `needs-setup` with a button that opens `https://playit.gg/account/tunnels`
     and shows the local address `127.0.0.1:<port>` to copy; rundata polling
     then adopts the first `minecraft-java` tunnel whose local port equals
     the server's port and stores its id.
- Address: `display_address` of the server's tunnel from rundata, polled
  every 30 s while sharing is active (and right after create); stored in
  `tunnel.address` so it shows immediately next time.
- `PLAYIT_TUNNEL_LIMIT` → error "Your playit.gg account has no free tunnels
  left. Remove one on playit.gg or turn sharing off for another server."
- Port change of a shared server → `updateTunnelPort` on next share start.
- Server deletion → best-effort `deleteTunnel` when `tunnelId` is set
  (failure is logged, never blocks deletion).
- Emits `tunnel:status { serverId, state, address?, message? }` with
  `state: 'off' | 'downloading' | 'connecting' | 'online' | 'needs-setup' |
'error'`.

## 5. IPC

Invoke channels (zod-validated):

- `tunnel:account` → `{ linked: boolean }`
- `tunnel:link` → resolves when linked; `tunnel:cancelLink`
- `tunnel:unlink`
- `tunnel:setShared(serverId, enabled: boolean)`
- `tunnel:status(serverId)` → current `TunnelStatus`
- `tunnel:retry(serverId)`

Event: `tunnel:status` as above.

New error codes: `PLAYIT_NOT_LINKED`, `PLAYIT_UNAUTHORIZED`, `PLAYIT_API`,
`PLAYIT_TUNNEL_LIMIT`, `PLAYIT_CREATE_FORBIDDEN`, `PLAYIT_CLAIM_REJECTED`,
`PLAYIT_CLAIM_EXPIRED`, `CANCELLED`, and `PLAYIT_FORBIDDEN` (an auth
error that is not an invalid key, e.g. `ScopeNotAllowed`; `createTunnel`
turns it into `PLAYIT_CREATE_FORBIDDEN`).

## 6. UI — Connect tab

A new card at the top: **Share over the internet (playit.gg)**.

- Not linked: one-line explanation ("Friends can join without port
  forwarding. Uses a free playit.gg account.") and **Link playit.gg
  account**. While linking: "Waiting for you to accept in the browser…" with
  Cancel.
- Linked: a switch **Share this server**; under it the status line:
  - off: "Not shared."
  - downloading: "Downloading the playit agent… N%"
  - connecting: "Connecting to playit.gg…"
  - online: the address row (same component and Copy button as the
    existing rows) plus "Share this address with your friends." When the
    server is stopped and an address is known: the address greyed with
    "Available while the server is running."
  - needs-setup: steps — "Create a Minecraft Java tunnel on playit.gg
    pointing to `127.0.0.1:<port>`", **Open playit.gg**, "Blockhost picks it
    up automatically."
  - error: the message and **Retry**.
- A small **Unlink playit.gg** link at the bottom of the card (confirm first).
- The existing port-forwarding sections move below under a collapsed
  "Or forward a port yourself" heading.

## 7. Testing

Vitest, TDD.

- `binary.ts`: cached file with the right hash is reused; wrong hash is
  deleted and re-downloaded once; download uses the pinned URL and sha256.
- `api.ts`: fake fetch — request paths, bodies and `Agent-Key` header;
  mapping of 401, fail bodies, tunnel-limit and forbidden responses.
- `account.ts`: fake API + fake timers — accepted, rejected, expired,
  cancelled; secret file format `secret_key = "<key>"`; unlink clears
  server tunnel fields.
- `agent.ts`: fake spawn — arguments; connected/error detection from lines;
  restart backoff 2/5/15 s then error; reset after a connection; stop kills.
- `service.ts`: agent runs only while a shared server is up; tunnel created
  once and reused; port mismatch → update; create forbidden → needs-setup
  and adoption by port; limit error message; deletion calls deleteTunnel
  best-effort.
- Live check (opt-in, `PLAYIT_TEST_SECRET` env var): rundata, create a
  tunnel, see it in rundata, delete it. This doubles as the §2 verification.
- Manual smoke items: link an account, share a Paper server, join from a
  different network using the shown address, unlink.
