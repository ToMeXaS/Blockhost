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

describe('serverPatchSchema', () => {
  it('accepts partial patches and null javaPath', () => {
    expect(serverPatchSchema.parse({ ramMb: 2048, javaPath: null })).toEqual({
      ramMb: 2048,
      javaPath: null
    })
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
