import { isAbsolute } from 'node:path'
import { isIP } from 'node:net'
import { z } from 'zod'
import { PLAYER_NAME_PATTERN, SERVER_TYPES } from '../shared/types'
import { JAVA_MAJORS } from './java/requirements'

export const idSchema = z.uuid()
export const serverTypeSchema = z.enum(SERVER_TYPES)
export const versionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.+-]+$/)
export const portSchema = z.number().int().min(1).max(65535)
export const ramSchema = z.number().int().min(512).max(65536)
const RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[\w .()-]+$/, 'Use letters, numbers, spaces, dots, dashes or brackets')
  .refine((name) => !/^[. ]+$/.test(name), 'This name is not allowed')
  .refine((name) => !/[. ]$/.test(name), 'The name cannot end with a dot or space')
  .refine((name) => !RESERVED_DEVICE_NAMES.test(name), 'This name is reserved by Windows')

export const createServerSchema = z.object({
  name: nameSchema,
  type: serverTypeSchema,
  mcVersion: versionSchema,
  build: z
    .string()
    .max(32)
    .regex(/^[\w.-]+$/)
    .optional(),
  dir: z
    .string()
    .min(3)
    .max(240)
    .refine((p) => isAbsolute(p), 'Folder must be an absolute path'),
  ramMb: ramSchema,
  port: portSchema,
  eulaAccepted: z.literal(true)
})

const jvmArgSchema = z
  .string()
  .max(200)
  .regex(/^-\S+$/, 'JVM arguments must start with "-"')
  .refine((arg) => !/OnError|OnOutOfMemoryError/i.test(arg), 'This JVM option is not allowed')
  .refine(
    (arg) => !/^-(agentpath|agentlib|javaagent):/i.test(arg),
    'This JVM option is not allowed'
  )

export const serverPatchSchema = z.strictObject({
  name: nameSchema.optional(),
  ramMb: ramSchema.optional(),
  port: portSchema.optional(),
  javaPath: z.string().max(400).nullable().optional(),
  jvmArgs: z.array(jvmArgSchema).max(50).optional()
})

export const propertyEntriesSchema = z
  .array(
    z.object({
      key: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[^\s=:#!\\]+$/, 'Invalid property name'),
      value: z.string().max(4096)
    })
  )
  .max(500)

export const commandSchema = z
  .string()
  .min(1)
  .max(1000)
  .regex(/^[^\r\n]*$/, 'Commands must be one line')

export const httpsUrlSchema = z
  .url()
  .refine((url) => url.startsWith('https://'), 'Only https links are allowed')

export const javaMajorSchema = z
  .number()
  .int()
  .refine((major) => (JAVA_MAJORS as readonly number[]).includes(major), 'Unsupported Java version')

const playerNameSchema = z
  .string()
  .regex(PLAYER_NAME_PATTERN, 'Player names are 3–16 letters, numbers or underscores')
const ipSchema = z
  .string()
  .max(45)
  .refine((ip) => isIP(ip) !== 0, 'Not a valid IP address')
const reasonSchema = z
  .string()
  .max(200)
  .regex(/^\P{Cc}*$/u, 'The reason must be a single line')
  .optional()
const overwriteCorrupt = z.boolean().optional()

const nameAction = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), name: playerNameSchema, overwriteCorrupt })
const nameReasonAction = <T extends string>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    name: playerNameSchema,
    reason: reasonSchema,
    overwriteCorrupt
  })

export const playerActionSchema = z.discriminatedUnion('type', [
  nameAction('op'),
  nameAction('deop'),
  nameAction('whitelistAdd'),
  nameAction('whitelistRemove'),
  nameAction('pardon'),
  nameReasonAction('ban'),
  nameReasonAction('kick'),
  z.strictObject({ type: z.literal('banIp'), ip: ipSchema, reason: reasonSchema, overwriteCorrupt }),
  z.strictObject({ type: z.literal('pardonIp'), ip: ipSchema, overwriteCorrupt }),
  z.strictObject({ type: z.literal('setWhitelistEnabled'), enabled: z.boolean(), overwriteCorrupt })
])
