import { describe, expect, it } from 'vitest'
import {
  commandSchema,
  configChangeSchema,
  configFileIdSchema,
  contentFileSchema,
  contentRefSchema,
  contentSearchSchema,
  versionIdSchema,
  createServerSchema,
  httpsUrlSchema,
  javaMajorSchema,
  nameSchema,
  playerActionSchema,
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
    expect(createServerSchema.safeParse({ ...validCreate, eulaAccepted: false }).success).toBe(
      false
    )
  })

  it('rejects relative folders, bad names, unknown types and bad ports', () => {
    expect(createServerSchema.safeParse({ ...validCreate, dir: 'servers\\x' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, name: 'a/b' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, type: 'bukkit' }).success).toBe(false)
    expect(createServerSchema.safeParse({ ...validCreate, port: 70000 }).success).toBe(false)
  })
})

describe('nameSchema', () => {
  it('accepts normal names', () => {
    expect(nameSchema.safeParse('Survival (2026)').success).toBe(true)
  })

  it('rejects dot/space-only names, trailing dots/spaces and reserved device names', () => {
    expect(nameSchema.safeParse('.').success).toBe(false)
    expect(nameSchema.safeParse('..').success).toBe(false)
    expect(nameSchema.safeParse('name.').success).toBe(false)
    expect(nameSchema.safeParse('CON').success).toBe(false)
    expect(nameSchema.safeParse('con').success).toBe(false)
    expect(nameSchema.safeParse('nul.txt').success).toBe(false)
    expect(nameSchema.safeParse('COM1').success).toBe(false)
  })
})

describe('serverPatchSchema', () => {
  it('accepts partial patches and null javaPath', () => {
    expect(serverPatchSchema.parse({ ramMb: 2048, javaPath: null })).toEqual({
      ramMb: 2048,
      javaPath: null
    })
  })

  it('accepts a whole-GB disk limit or null, and rejects anything else', () => {
    expect(serverPatchSchema.parse({ diskLimitMb: 10_240 })).toEqual({ diskLimitMb: 10_240 })
    expect(serverPatchSchema.parse({ diskLimitMb: null })).toEqual({ diskLimitMb: null })
    for (const bad of [0, 512, 1500, -1024, 1024.5]) {
      expect(serverPatchSchema.safeParse({ diskLimitMb: bad }).success).toBe(false)
    }
  })

  it('rejects unknown keys', () => {
    expect(serverPatchSchema.safeParse({ launch: { args: ['-jar', 'evil.jar'] } }).success).toBe(
      false
    )
  })

  it('only allows JVM options and blocks command hooks', () => {
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-XX:+UseG1GC', '-Dfoo=bar'] }).success).toBe(
      true
    )
    expect(serverPatchSchema.safeParse({ jvmArgs: ['nogui'] }).success).toBe(false)
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-XX:OnOutOfMemoryError=calc'] }).success).toBe(
      false
    )
  })

  it('blocks native agent JVM options', () => {
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-agentpath:evil.dll'] }).success).toBe(false)
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-agentlib:evil'] }).success).toBe(false)
    expect(serverPatchSchema.safeParse({ jvmArgs: ['-javaagent:evil.jar'] }).success).toBe(false)
  })
})

describe('other schemas', () => {
  it('rejects multi-line commands', () => {
    expect(commandSchema.safeParse('say hi').success).toBe(true)
    expect(commandSchema.safeParse('stop\nop me').success).toBe(false)
  })

  it('validates property keys', () => {
    expect(propertyEntriesSchema.safeParse([{ key: 'motd', value: 'Hi: there' }]).success).toBe(
      true
    )
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

describe('playerActionSchema', () => {
  it('accepts every action shape', () => {
    const valid = [
      { type: 'op', name: 'Steve' },
      { type: 'deop', name: 'Steve' },
      { type: 'whitelistAdd', name: 'alex_99' },
      { type: 'whitelistRemove', name: 'alex_99' },
      { type: 'setWhitelistEnabled', enabled: true },
      { type: 'ban', name: 'Griefer1', reason: 'Broke the spawn' },
      { type: 'ban', name: 'Griefer1' },
      { type: 'pardon', name: 'Griefer1' },
      { type: 'banIp', ip: '203.0.113.7', reason: 'Alt accounts' },
      { type: 'banIp', ip: '2001:db8::1' },
      { type: 'pardonIp', ip: '203.0.113.7' },
      { type: 'kick', name: 'Steve', reason: 'AFK' },
      { type: 'op', name: 'Steve', overwriteCorrupt: true }
    ]
    for (const action of valid) expect(playerActionSchema.parse(action)).toEqual(action)
  })

  it('rejects names that are not Minecraft usernames', () => {
    for (const name of ['ab', 'a'.repeat(17), 'Steve stop', 'Steve\nstop', 'Stéve', '']) {
      expect(() => playerActionSchema.parse({ type: 'op', name })).toThrow()
    }
  })

  it('rejects reasons that could inject a second command', () => {
    for (const reason of ['bye\nstop', 'bye\rstop', 'x\u0000', 'r'.repeat(201)]) {
      expect(() => playerActionSchema.parse({ type: 'ban', name: 'Steve', reason })).toThrow()
    }
  })

  it('rejects invalid IPs', () => {
    for (const ip of ['300.1.1.1', 'example.com', '1.2.3.4 stop', '']) {
      expect(() => playerActionSchema.parse({ type: 'banIp', ip })).toThrow()
    }
  })

  it('rejects unknown types and extra fields', () => {
    expect(() => playerActionSchema.parse({ type: 'nuke', name: 'Steve' })).toThrow()
    expect(() => playerActionSchema.parse({ type: 'op', name: 'Steve', level: 4 })).toThrow()
    expect(() => playerActionSchema.parse({ type: 'pardon', name: 'Steve', reason: 'x' })).toThrow()
  })
})

describe('content schemas', () => {
  it('validates project refs and file names', () => {
    expect(contentRefSchema.parse({ source: 'hangar', projectId: 'LuckPerms-Supporter' })).toEqual({
      source: 'hangar',
      projectId: 'LuckPerms-Supporter'
    })
    expect(() => contentRefSchema.parse({ source: 'curse', projectId: 'x' })).toThrow()
    expect(() => contentRefSchema.parse({ source: 'modrinth', projectId: '../x' })).toThrow()
    expect(contentFileSchema.parse('sodium-1.jar')).toBe('sodium-1.jar')
    for (const bad of ['../x.jar', 'x.exe', 'CON.jar'])
      expect(() => contentFileSchema.parse(bad)).toThrow()
  })

  it('rejects dot-only ids', () => {
    for (const bad of ['.', '..'])
      expect(() => contentRefSchema.parse({ source: 'modrinth', projectId: bad })).toThrow()
    expect(() => versionIdSchema.parse('..')).toThrow()
    expect(versionIdSchema.parse('v1.2.3')).toBe('v1.2.3')
  })

  it('validates search requests', () => {
    const req = {
      text: ' sodium ',
      sources: ['modrinth', 'hangar'],
      category: 'utility',
      sort: 'downloads',
      cursor: { modrinth: 20, hangar: 'done' }
    }
    expect(contentSearchSchema.parse(req)).toMatchObject({ text: 'sodium' })
    expect(() => contentSearchSchema.parse({ ...req, text: 'x'.repeat(101) })).toThrow()
    expect(() => contentSearchSchema.parse({ ...req, cursor: { modrinth: 10001 } })).toThrow()
  })
})

describe('configFileIdSchema', () => {
  it('accepts allowlisted ids only', () => {
    expect(configFileIdSchema.safeParse('paper-global').success).toBe(true)
    expect(configFileIdSchema.safeParse('../server.properties').success).toBe(false)
  })
})

describe('configChangeSchema', () => {
  it('accepts value edits and raw text', () => {
    expect(
      configChangeSchema.safeParse({
        mode: 'values',
        edits: [
          { path: ['a', 'b'], value: 1 },
          { path: ['c'], value: ['x'] },
          { path: ['d'], value: false }
        ]
      }).success
    ).toBe(true)
    expect(configChangeSchema.safeParse({ mode: 'raw', text: 'a: 1\n' }).success).toBe(true)
  })

  it('rejects empty paths, non-finite numbers and unknown modes', () => {
    expect(
      configChangeSchema.safeParse({ mode: 'values', edits: [{ path: [], value: 1 }] }).success
    ).toBe(false)
    expect(
      configChangeSchema.safeParse({ mode: 'values', edits: [{ path: ['a'], value: Infinity }] })
        .success
    ).toBe(false)
    expect(configChangeSchema.safeParse({ mode: 'delete' }).success).toBe(false)
  })
})
