# Blockhost — UI Restyle — Design

Date: 2026-10-18
Status: Draft for review

## 1. Goal

Restyle Blockhost to the user's dark admin-panel design canvas
(`https://claude.ai/artifact/BuD3VywvayKjaZ4ELHZ41b`): a sidebar layout with a
server switcher, a server header, an Overview page, and the canvas's colours,
type and components applied to every existing screen.

### In scope

- Design tokens, bundled fonts and a restyled component kit.
- A new app shell: sidebar with server switcher and section navigation.
- A server header and a new Overview section built from existing data.
- Restyled Console (level colours, filters, command history), Players,
  Mods/Plugins, Properties, Connect, Settings, All servers and the New
  server wizard.

### Out of scope

Anything in the canvas that needs data Blockhost does not have yet: CPU,
memory and TPS stats and charts; worlds; backups; file browser; disk usage;
player ping, session time and world; Teleport and Message actions. These
are later sub-projects and are not faked or stubbed. No behaviour of
existing features changes; no main-process or IPC changes.

## 2. Approach

Tailwind 4 `@theme` tokens (CSS variables) in `main.css`, used by name
everywhere instead of `zinc`/`emerald` classes; a restyled shared kit in
`components/ui.tsx`; a new `AppShell` replacing the header-plus-tabs
layout; each screen migrated one task at a time so the app works after
every step.

Rejected: a component library such as shadcn/Radix (extra dependencies and
a look we would fight to match); global CSS overrides only (brittle, and
the layout change cannot be done in CSS).

## 3. Theme and fonts

### 3.1 Tokens (`src/renderer/src/assets/main.css`, `@theme`)

| Token                   | Value     | Use                            |
| ----------------------- | --------- | ------------------------------ |
| `--color-bg`            | `#0C0E11` | page background                |
| `--color-sidebar`       | `#0F1215` | sidebar, inset fields          |
| `--color-panel`         | `#13171B` | cards                          |
| `--color-panel-2`       | `#1A1F25` | raised rows, hover             |
| `--color-console`       | `#0A0C0E` | console background             |
| `--color-nav-active`    | `#1C2229` | active sidebar item            |
| `--color-border`        | `#1F242B` | card borders                   |
| `--color-border-soft`   | `#1A1F25` | dividers                       |
| `--color-border-strong` | `#2A313A` | inputs, secondary buttons      |
| `--color-ring`          | `#262D35` | active nav inset ring          |
| `--color-text`          | `#E8EAED` | primary text                   |
| `--color-text-2`        | `#C9D0D7` | secondary text                 |
| `--color-muted`         | `#8C96A1` | labels                         |
| `--color-nav`           | `#9AA3AE` | inactive nav text              |
| `--color-faint`         | `#6F7883` | hints, placeholders            |
| `--color-accent`        | `#8BE36B` | primary actions, CMD lines     |
| `--color-accent-ink`    | `#0C0E11` | text on accent                 |
| `--color-link`          | `#9BE07F` | links                          |
| `--color-info`          | `#6FA8F5` | INFO level                     |
| `--color-warn`          | `#F2B84B` | WARN level, starting/stopping  |
| `--color-danger`        | `#F2958A` | ERROR level, offline text      |
| `--color-ok-bg`         | `#172517` | online pill background         |
| `--color-ok-text`       | `#A6E795` | online pill text, CHAT level   |
| `--color-ok-border`     | `#25402A` | online pill border             |
| `--color-bad-bg`        | `#251818` | offline pill background        |
| `--color-bad-border`    | `#402525` | offline pill border            |
| `--color-stop-bg`       | `#2A1717` | Stop button background         |
| `--color-stop-text`     | `#F7B0A7` | Stop button text               |
| `--color-stop-border`   | `#4A2A2A` | Stop button border             |
| `--color-warn-bg`       | `#2A2214` | amber pill / offline banner bg |
| `--color-warn-border`   | `#4A3B1E` | amber pill / banner border     |

Radii: `--radius-card: 14px`, `--radius-btn: 9px` (buttons, inputs, nav
items), `--radius-sm: 7px` (badges, chips). Body background `--color-bg`,
`color-scheme: dark`. `--color-muted` text must keep at least 4.5:1
contrast on `--color-panel` (it does: ≈6.2:1); `--color-faint` is only used
for non-essential hints.

### 3.2 Fonts

Geist (sans, 400–700) for UI text and JetBrains Mono (400/500) for
addresses, numbers and the console, bundled with the app through
`@fontsource-variable/geist` and `@fontsource-variable/jetbrains-mono`
(OFL licence), imported in `main.tsx`. Not loaded from Google Fonts: the
app must work offline and the CSP allows fonts only from `'self'`
(`font-src` falls back to `default-src 'self'`; no CSP change needed).
Tokens: `--font-sans: 'Geist Variable', 'Segoe UI', sans-serif`,
`--font-mono: 'JetBrains Mono Variable', Consolas, monospace`.

## 4. Component kit (`src/renderer/src/components/ui.tsx`)

Existing exports keep their names and props so screens keep compiling;
their classes move to the tokens. Added:

- `Card({ title?, description?, actions?, children })` — panel, border,
  14px radius, 20px padding; optional header row.
- `Button` variants: `primary` (accent background, accent-ink text),
  `secondary` (panel-2, border-strong), `danger` (stop colours), `ghost`;
  sizes `sm` / `md`.
- `StatusPill({ status })` — ok colours for running, warn for
  starting/stopping, bad colours for stopped/crashed; labels from
  `lib/format` `STATUS_LABEL`. Replaces `StatusBadge` (kept as an alias).
- `Badge({ tone: 'neutral' | 'accent' | 'warn' | 'danger' })` — small
  rounded label; `TypeBadge` uses it.
- `Switch({ checked, onChange, disabled?, label })` — a `role="switch"`
  button with `aria-checked`.
- `Segmented({ options, value, onChange })` — the in-page sub-tab control.
- `Table` helpers: `Table`, `Th`, `Td` with token borders and row hover.
- `Menu({ trigger, items })` — a small popover menu (Escape and outside
  click close it), used for the switcher and the header "⋯" menu.
- `inputClass`, `Field`, `ErrorText` restyled.

## 5. App shell and routing

### 5.1 Routes (`App.tsx`)

```ts
type Section =
  'overview' | 'console' | 'players' | 'content' | 'properties' | 'connect' | 'settings'
type Route = { name: 'list' } | { name: 'new' } | { name: 'server'; id: string; section: Section }
```

Opening a server goes to its last-used section (kept in an in-memory
`Map<string, Section>`, default `overview`). If the remembered section is
`content` and the server type has no content target, it falls back to
`overview`. Helpers live in `src/renderer/src/lib/routes.ts`
(`sectionsFor(type)`, `resolveSection(type, remembered)`), unit-tested.

### 5.2 `AppShell` (`src/renderer/src/components/AppShell.tsx`)

- **Sidebar** (width 248px, `--color-sidebar`, right border):
  - Logo: a 3×3 block mark in accent tones and "Blockhost".
  - Server switcher (only when a server is selected): a button with the
    status dot and server name; opens a `Menu` listing every server (dot,
    name, type) plus "+ New server" and "All servers".
  - Section nav for the selected server, items 40px tall, 9px radius,
    inactive `--color-nav`, active `--color-nav-active` with an inset 1px
    `--color-ring`:

    | Section        | Shown                                    |
    | -------------- | ---------------------------------------- |
    | Overview       | always                                   |
    | Console        | always                                   |
    | Players        | always; badge with online count when > 0 |
    | Mods / Plugins | label from `CONTENT_LABELS`; not Vanilla |
    | Properties     | always                                   |
    | Connect        | always                                   |
    | Settings       | always                                   |

  - With no server selected (All servers, New server): logo, "All
    servers" and "+ New server" nav items.
  - Bottom: `UpdateBanner` (restyled) and the app version.
- **Main area**: the offline banner (`net:offline`) as a thin amber bar at
  the top, then the page content, max width 1200px, 32px padding.
- Below 1000px window width the sidebar collapses to a 64px icon rail
  (labels become `title` tooltips); the window minimum stays 860px.
- Icons: inline SVG components in `src/renderer/src/components/icons.tsx`
  (no icon dependency).

`ServerDetail.tsx` becomes the server page: header plus the active
section; its tab bar is removed (navigation lives in the sidebar).
InstallPanel still replaces the section area while the server is not
ready.

## 6. Server header

Shown above every section of a selected server:

- Name (26px, weight 700) and `StatusPill`.
- A mono detail line: connect address (the tunnel's public address when
  shared and known, otherwise `localhost:<port>`), type and version (e.g.
  "Paper 1.21.4"), Java ("Java auto" or the custom path's file name) and
  RAM (e.g. "4 GB"). Clicking the address copies it and shows "Copied".
- Right-aligned actions: running → **Restart** (secondary) and **Stop**
  (danger); stopped/crashed → **Start** (primary); starting/stopping →
  the relevant button disabled. **Force kill** lives in a "⋯" `Menu` and
  keeps today's rule: the item is enabled only after the server has been
  stopping for 30 seconds.

## 7. Overview section (new)

`src/renderer/src/pages/sections/OverviewSection.tsx`. A 2-column card
grid (1 column below a 1000px window width, so the default 1100px window
gets 2 columns), built only from existing
renderer APIs:

- **Status**: state; uptime counted in the renderer from the moment this
  view saw the server enter `running` ("—" if it was already running when
  the app opened and no start was observed, formatted by
  `formatUptime(ms)` in `lib/format`); port; "Shared via playit" /
  "Not shared".
- **Players**: online players with a letter avatar (first letter on a
  colour picked from the name; no skin images, so no CSP change), from the
  same data source as the Players section, "N / max online" where max is `max-players` from the
  server properties (just "N online" if unreadable), and "Manage
  players →". Empty: "No one online".
- **Console preview**: the last 12 log lines with level colours and "Open
  console →". Empty: "Server hasn't run yet".
- **Mods / Plugins** (not Vanilla): installed count, update count (from the
  existing installed listing; omitted when offline) and a link.
- **Connect**: the address with Copy and "Connect settings →".

## 8. Console section

- Full-height panel, `--color-console`, mono 13px.
- Level detection by `parseLogLevel(line)` in
  `src/renderer/src/lib/logLevel.ts`, matching Minecraft's
  `[HH:MM:SS] [thread/LEVEL]` and Paper's `[HH:MM:SS LEVEL]` prefixes →
  `info | warn | error | chat | cmd | system | plain`. Chat is an INFO
  line whose message starts with `<name>`; `cmd` marks echoed commands
  (lines starting `> `); `system` marks Blockhost's own `[Blockhost]`
  lines. Lines without a prefix keep today's keyword fallback (ERROR,
  SEVERE, FATAL or Exception → error; WARN → warn). Colours: info
  `--color-info`, warn `--color-warn`, error `--color-danger`, chat
  `--color-ok-text`, cmd `--color-accent`, system `--color-info`, plain
  `--color-text-2`.
- Filter chips: All / Warnings (warn + error) / Chat.
- Auto-scroll while at the bottom; when scrolled up a "Jump to latest"
  button appears.
- Command row: `>` prompt, input, **Send**. ↑/↓ walk the last 50 sent
  commands (in memory, per server).

## 9. Other sections and pages

Players, Mods/Plugins, Properties, Connect and Settings keep every feature
and behaviour; only markup and classes change. Each uses `Card` groups
with titles and descriptions, `Table` for lists (online players,
whitelist, ops, bans, installed content), `Switch` for boolean properties,
and `Segmented` for in-page sub-tabs. They move to
`src/renderer/src/pages/sections/` with the same component logic.

**All servers** (landing): "Servers" heading and "+ New server"; a grid of
server cards (name, `StatusPill`, type and version, "N online" when
running, quick Start/Stop); clicking a card opens that server. Empty: a
centred card with the logo and "Create your first server".

**New server wizard**: same steps and logic in a centred card (max 720px)
with a step indicator matching its existing three steps (1 Type &
version · 2 Settings · 3 Install); server
types as selectable tiles with a one-line description each.

## 10. Testing

- `npm run typecheck`, `npm test` and `npm run build` stay green after
  every task.
- New unit tests: `parseLogLevel` (each level, chat, plain, malformed);
  `formatUptime`; `sectionsFor` / `resolveSection` (Vanilla hides content;
  fallback to overview).
- `docs/smoke-test.md` gains a restyle list: every section renders for
  Vanilla, Paper and Fabric servers; the switcher changes servers and
  remembers sections; console filters and command history work; fonts
  render with the network off; layout works at 860px and the sidebar
  collapses below 1000px; Force kill appears in "⋯" after 30 s of
  stopping.

## 11. Order of work

1. Tokens and fonts.
2. Component kit.
3. Route helpers, AppShell and sidebar.
4. Server header and Overview.
5. Console.
6. Players, Mods/Plugins, Properties, Connect, Settings (one task each).
7. All servers and the wizard.
8. Smoke checklist.
