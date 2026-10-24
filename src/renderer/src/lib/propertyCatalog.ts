import type { PropertyEntry } from '../../../shared/types'

export type PropertyKind = 'text' | 'number' | 'bool' | 'select'
export type PropertyCategory =
  'gameplay' | 'world' | 'players' | 'network' | 'performance' | 'advanced'
export type PropertyGroupId = PropertyCategory | 'other'

export interface PropertyDef {
  key: string
  label: string
  description: string
  category: PropertyCategory
  kind: PropertyKind
  options?: string[]
  min?: number
  max?: number
  /** Minecraft's own default. */
  default: string
  /** Shown with its default before the server has generated the full file. */
  core?: boolean
}

export const PROPERTY_CATEGORIES: { id: PropertyGroupId; label: string }[] = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'world', label: 'World' },
  { id: 'players', label: 'Players & access' },
  { id: 'network', label: 'Network' },
  { id: 'performance', label: 'Performance' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'other', label: 'Other' }
]

const bool = (
  key: string,
  label: string,
  category: PropertyCategory,
  def: boolean,
  description: string,
  core = false
): PropertyDef => ({ key, label, category, kind: 'bool', default: String(def), description, core })

const num = (
  key: string,
  label: string,
  category: PropertyCategory,
  def: number,
  description: string,
  range: { min?: number; max?: number } = {},
  core = false
): PropertyDef => ({
  key,
  label,
  category,
  kind: 'number',
  default: String(def),
  description,
  ...range,
  core
})

const text = (
  key: string,
  label: string,
  category: PropertyCategory,
  def: string,
  description: string,
  core = false
): PropertyDef => ({ key, label, category, kind: 'text', default: def, description, core })

export const PROPERTY_CATALOG: PropertyDef[] = [
  // Gameplay
  {
    key: 'gamemode',
    label: 'Game mode',
    category: 'gameplay',
    kind: 'select',
    options: ['survival', 'creative', 'adventure', 'spectator'],
    default: 'survival',
    description: 'Mode new players start in.',
    core: true
  },
  bool(
    'force-gamemode',
    'Force game mode',
    'gameplay',
    false,
    'Put players back into the default game mode every time they join.'
  ),
  {
    key: 'difficulty',
    label: 'Difficulty',
    category: 'gameplay',
    kind: 'select',
    options: ['peaceful', 'easy', 'normal', 'hard'],
    default: 'easy',
    description: 'How much damage mobs deal and how fast hunger drains.',
    core: true
  },
  bool(
    'hardcore',
    'Hardcore',
    'gameplay',
    false,
    'Players are switched to spectator when they die. Difficulty is locked to hard.'
  ),
  bool('pvp', 'Player vs player', 'gameplay', true, 'Lets players damage each other.', true),
  bool(
    'allow-flight',
    'Allow flight',
    'gameplay',
    false,
    'Stops the server kicking players who fly. Turn on if a plugin or mod gives flight.'
  ),
  bool('spawn-monsters', 'Spawn monsters', 'gameplay', true, 'Hostile mobs spawn naturally.'),
  bool(
    'spawn-animals',
    'Spawn animals',
    'gameplay',
    true,
    'Animals spawn naturally (older versions).'
  ),
  bool(
    'spawn-npcs',
    'Spawn villagers',
    'gameplay',
    true,
    'Villagers spawn naturally (older versions).'
  ),
  bool(
    'enable-command-block',
    'Command blocks',
    'gameplay',
    false,
    'Lets command blocks run commands.'
  ),

  // World
  text(
    'level-name',
    'World folder',
    'world',
    'world',
    'Folder the world is loaded from. Changing it loads or creates a different world.'
  ),
  text(
    'level-seed',
    'Seed',
    'world',
    '',
    'Seed for generating a new world. Blank picks a random one.'
  ),
  {
    key: 'level-type',
    label: 'World type',
    category: 'world',
    kind: 'select',
    options: [
      'minecraft:normal',
      'minecraft:flat',
      'minecraft:large_biomes',
      'minecraft:amplified',
      'minecraft:single_biome_surface'
    ],
    default: 'minecraft:normal',
    description: 'Generator used for a new world.'
  },
  text(
    'generator-settings',
    'Generator settings',
    'world',
    '{}',
    'JSON settings for flat or custom world generation.'
  ),
  bool(
    'generate-structures',
    'Generate structures',
    'world',
    true,
    'Villages, temples and other structures generate in new chunks.'
  ),
  bool('allow-nether', 'Allow the Nether', 'world', true, 'Players can travel to the Nether.'),
  num(
    'spawn-protection',
    'Spawn protection radius',
    'world',
    16,
    'Blocks around spawn that only operators can change. 0 turns it off.',
    { min: 0 }
  ),
  num(
    'max-world-size',
    'Max world radius',
    'world',
    29999984,
    'Where the world border sits, in blocks from the centre.',
    { min: 1, max: 29999984 }
  ),

  // Players & access
  text(
    'motd',
    'Message of the day',
    'players',
    'A Minecraft Server',
    'Shown in the multiplayer server list.',
    true
  ),
  num(
    'max-players',
    'Max players',
    'players',
    20,
    'How many players can be online at once.',
    { min: 0 },
    true
  ),
  bool('white-list', 'Whitelist', 'players', false, 'Only listed players can join.', true),
  bool(
    'enforce-whitelist',
    'Enforce whitelist',
    'players',
    false,
    'Kick online players who are not on the whitelist when it is reloaded.'
  ),
  bool(
    'online-mode',
    'Online mode',
    'players',
    true,
    'Checks accounts with Mojang. Turn off only for offline LAN play, since anyone could then join with any name.',
    true
  ),
  bool(
    'enforce-secure-profile',
    'Require signed chat',
    'players',
    true,
    'Only players with a Mojang-signed chat key can join.'
  ),
  num(
    'op-permission-level',
    'Operator level',
    'players',
    4,
    'Default permission level for /op (1–4).',
    { min: 1, max: 4 }
  ),
  num(
    'function-permission-level',
    'Function permission level',
    'players',
    2,
    'Permission level datapack functions run at (1–4).',
    { min: 1, max: 4 }
  ),
  num(
    'player-idle-timeout',
    'Idle kick (minutes)',
    'players',
    0,
    'Kick players idle this long. 0 never kicks.',
    { min: 0 }
  ),
  bool(
    'hide-online-players',
    'Hide player list',
    'players',
    false,
    'Hide who is online from the server list.'
  ),
  bool(
    'log-ips',
    'Log IP addresses',
    'players',
    true,
    'Write player IP addresses to the server log.'
  ),

  // Network
  num(
    'server-port',
    'Port',
    'network',
    25565,
    'Port players connect to.',
    { min: 1, max: 65535 },
    true
  ),
  text(
    'server-ip',
    'Bind address',
    'network',
    '',
    'IP address to listen on. Leave blank to listen on all of them.'
  ),
  num(
    'network-compression-threshold',
    'Compression threshold',
    'network',
    256,
    'Packets larger than this many bytes are compressed. -1 turns compression off.',
    { min: -1 }
  ),
  num(
    'rate-limit',
    'Packet rate limit',
    'network',
    0,
    'Kick players sending more packets per second than this. 0 turns it off.',
    { min: 0 }
  ),
  bool(
    'use-native-transport',
    'Native networking',
    'network',
    true,
    'Use Linux-optimised networking where available.'
  ),
  bool(
    'accepts-transfers',
    'Accept transfers',
    'network',
    false,
    'Allow players to be transferred here from other servers.'
  ),
  bool(
    'enable-status',
    'Show in server list',
    'network',
    true,
    'Answer server-list pings. Off makes the server look offline.'
  ),
  bool(
    'prevent-proxy-connections',
    'Block proxies',
    'network',
    false,
    'Kick players whose connection comes from a different IP than their Mojang login.'
  ),
  bool(
    'enable-query',
    'GameSpy query',
    'network',
    false,
    'Expose server info over the GameSpy4 query protocol.'
  ),
  num('query.port', 'Query port', 'network', 25565, 'Port for the query protocol.', {
    min: 1,
    max: 65535
  }),
  bool(
    'enable-rcon',
    'Remote console (RCON)',
    'network',
    false,
    'Allow remote console connections. Set a strong password first.'
  ),
  num('rcon.port', 'RCON port', 'network', 25575, 'Port for remote console connections.', {
    min: 1,
    max: 65535
  }),
  text('rcon.password', 'RCON password', 'network', '', 'Password for remote console connections.'),
  bool(
    'broadcast-rcon-to-ops',
    'Show RCON output to ops',
    'network',
    true,
    'Send remote console command output to online operators.'
  ),

  // Performance
  num(
    'view-distance',
    'View distance (chunks)',
    'performance',
    10,
    'How far players can see. Higher costs more memory and CPU.',
    { min: 3, max: 32 },
    true
  ),
  num(
    'simulation-distance',
    'Simulation distance (chunks)',
    'performance',
    10,
    'How far from players mobs and crops keep ticking.',
    { min: 3, max: 32 }
  ),
  num(
    'entity-broadcast-range-percentage',
    'Entity visibility range (%)',
    'performance',
    100,
    'How far away entities are sent to players, as a percentage of the default.',
    { min: 10, max: 1000 }
  ),
  num(
    'max-tick-time',
    'Watchdog timeout (ms)',
    'performance',
    60000,
    'Stop the server if one tick takes longer than this. -1 turns the watchdog off.',
    { min: -1 }
  ),
  num(
    'max-chained-neighbor-updates',
    'Max chained block updates',
    'performance',
    1000000,
    'Limit on consecutive block updates before the rest are skipped.'
  ),
  bool(
    'sync-chunk-writes',
    'Synchronous chunk saves',
    'performance',
    true,
    'Safer chunk saving at some performance cost.'
  ),
  {
    key: 'region-file-compression',
    label: 'Region compression',
    category: 'performance',
    kind: 'select',
    options: ['deflate', 'lz4', 'none'],
    default: 'deflate',
    description: 'How world region files are compressed.'
  },
  num(
    'pause-when-empty-seconds',
    'Pause when empty (seconds)',
    'performance',
    60,
    'Stop ticking the world after it has been empty this long. -1 never pauses.',
    { min: -1 }
  ),

  // Advanced
  text(
    'resource-pack',
    'Resource pack URL',
    'advanced',
    '',
    'Direct download link to a resource pack players are offered.'
  ),
  text(
    'resource-pack-sha1',
    'Resource pack SHA-1',
    'advanced',
    '',
    'Checksum of the resource pack, so clients can cache it.'
  ),
  text(
    'resource-pack-id',
    'Resource pack ID',
    'advanced',
    '',
    'UUID identifying the resource pack.'
  ),
  text(
    'resource-pack-prompt',
    'Resource pack prompt',
    'advanced',
    '',
    'Message shown when offering the resource pack.'
  ),
  bool(
    'require-resource-pack',
    'Require resource pack',
    'advanced',
    false,
    'Kick players who decline the resource pack.'
  ),
  text(
    'initial-enabled-packs',
    'Enabled datapacks (new world)',
    'advanced',
    'vanilla',
    'Datapacks enabled when a world is created.'
  ),
  text(
    'initial-disabled-packs',
    'Disabled datapacks (new world)',
    'advanced',
    '',
    'Datapacks not enabled automatically when a world is created.'
  ),
  bool(
    'broadcast-console-to-ops',
    'Show console output to ops',
    'advanced',
    true,
    'Send console command output to online operators.'
  ),
  bool(
    'enable-jmx-monitoring',
    'JMX monitoring',
    'advanced',
    false,
    'Expose tick-time metrics over JMX.'
  ),
  text(
    'text-filtering-config',
    'Text filtering config',
    'advanced',
    '',
    'Chat filtering service configuration.'
  ),
  num(
    'text-filtering-version',
    'Text filtering version',
    'advanced',
    0,
    'Version of the chat filtering service format.',
    { min: 0 }
  ),
  text(
    'bug-report-link',
    'Bug report link',
    'advanced',
    '',
    'Link shown to players in the bug-report screen.'
  )
]

const CATALOG = new Map(PROPERTY_CATALOG.map((def) => [def.key, def]))

export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  return !q || fields.some((field) => field?.toLowerCase().includes(q))
}

export interface PropertyRowModel {
  key: string
  value: string
  def?: PropertyDef
}

export interface PropertyGroup {
  id: PropertyGroupId
  label: string
  rows: PropertyRowModel[]
}

/** Splits entries into catalog categories plus Other (unknown keys), filtered by query. */
export function groupProperties(entries: PropertyEntry[], query = ''): PropertyGroup[] {
  const values = new Map(entries.map((e) => [e.key, e.value]))
  // The server writes the full file on first start; until then only the core keys are shown.
  const generated = entries.length > 2
  const groups = PROPERTY_CATEGORIES.map((c) => ({ ...c, rows: [] as PropertyRowModel[] }))
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const def of PROPERTY_CATALOG) {
    const value = values.get(def.key)
    if (value === undefined && (generated || !def.core)) continue
    if (!matchesQuery(query, def.label, def.key, def.description)) continue
    byId.get(def.category)?.rows.push({ key: def.key, value: value ?? def.default, def })
  }
  for (const entry of entries) {
    if (CATALOG.has(entry.key) || !matchesQuery(query, entry.key, entry.value)) continue
    byId.get('other')?.rows.push({ key: entry.key, value: entry.value })
  }
  return groups
}

export function countChanges(saved: PropertyEntry[], current: PropertyEntry[]): number {
  const before = new Map(saved.map((e) => [e.key, e.value]))
  const after = new Map(current.map((e) => [e.key, e.value]))
  let changes = 0
  for (const [key, value] of after) if (before.get(key) !== value) changes++
  for (const key of before.keys()) if (!after.has(key)) changes++
  return changes
}
