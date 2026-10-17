import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { SERVER_TYPES } from '../shared/types'
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
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[\w .()-]+$/, 'Use letters, numbers, spaces, dots, dashes or brackets')

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
