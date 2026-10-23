import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupInfo } from '../../shared/types'
import {
  backupFileName,
  isBackupFileName,
  listBackups,
  parseBackupFileName,
  pickPruned
} from './store'

describe('backup file names', () => {
  it('formats a UTC stamp and kind', () => {
    expect(backupFileName(new Date('2026-10-23T09:05:07.900Z'), 'auto')).toBe(
      '20261023-090507-auto.zip'
    )
  })

  it('parses its own names back', () => {
    expect(parseBackupFileName('20261023-090507-pre-restore.zip')).toEqual({
      kind: 'pre-restore',
      createdAt: '2026-10-23T09:05:07.000Z'
    })
  })

  it('does not parse other names', () => {
    expect(parseBackupFileName('my-world.zip')).toBeNull()
    expect(parseBackupFileName('20261023-090507-weekly.zip')).toBeNull()
    expect(parseBackupFileName('20261399-090507-auto.zip')).toBeNull()
  })

  it('accepts plain .zip basenames, any case and spaces', () => {
    expect(isBackupFileName('20261023-090507-auto.zip')).toBe(true)
    expect(isBackupFileName('my world.zip')).toBe(true)
    expect(isBackupFileName('World.ZIP')).toBe(true)
    expect(isBackupFileName('x'.repeat(200) + '.zip')).toBe(true)
  })

  it('rejects paths, reserved characters, non-zip names and overlong names', () => {
    expect(isBackupFileName('../x.zip')).toBe(false)
    expect(isBackupFileName('a/b.zip')).toBe(false)
    expect(isBackupFileName('a\\b.zip')).toBe(false)
    expect(isBackupFileName('x.zip.partial')).toBe(false)
    expect(isBackupFileName('a:b.zip')).toBe(false)
    expect(isBackupFileName('x'.repeat(201) + '.zip')).toBe(false)
  })
})

describe('listBackups', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'blockhost-backups-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('is empty when the folder does not exist', async () => {
    expect(await listBackups(join(tmp, 'missing'))).toEqual([])
  })

  it('rethrows read errors other than a missing folder', async () => {
    const file = join(tmp, 'not-a-folder')
    await writeFile(file, 'x')
    await expect(listBackups(file)).rejects.toThrow()
  })

  it('lists a hand-made World.ZIP as manual', async () => {
    await writeFile(join(tmp, 'World.ZIP'), 'abcd')
    const list = await listBackups(tmp)
    expect(list.map((b) => [b.file, b.kind, b.bytes])).toEqual([['World.ZIP', 'manual', 4]])
  })

  it('lists zips newest first, treating unknown names as manual by mtime', async () => {
    await writeFile(join(tmp, '20261020-100000-auto.zip'), 'aa')
    await writeFile(join(tmp, '20261022-100000-manual.zip'), 'bbb')
    await writeFile(join(tmp, 'hand-made.zip'), 'c')
    await utimes(
      join(tmp, 'hand-made.zip'),
      new Date('2026-10-21T00:00:00Z'),
      new Date('2026-10-21T00:00:00Z')
    )
    await writeFile(join(tmp, '20261023-100000-auto.zip.partial'), 'x')
    await mkdir(join(tmp, 'folder.zip'))

    expect(await listBackups(tmp)).toEqual([
      {
        file: '20261022-100000-manual.zip',
        kind: 'manual',
        createdAt: '2026-10-22T10:00:00.000Z',
        bytes: 3
      },
      { file: 'hand-made.zip', kind: 'manual', createdAt: '2026-10-21T00:00:00.000Z', bytes: 1 },
      {
        file: '20261020-100000-auto.zip',
        kind: 'auto',
        createdAt: '2026-10-20T10:00:00.000Z',
        bytes: 2
      }
    ])
  })
})

describe('pickPruned', () => {
  const b = (file: string, kind: BackupInfo['kind'], day: number): BackupInfo => ({
    file,
    kind,
    createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    bytes: 1
  })

  it('returns automatic backups beyond `keep`, never manual or pre-restore', () => {
    const list = [
      b('a5', 'auto', 5),
      b('m4', 'manual', 4),
      b('a3', 'auto', 3),
      b('p2', 'pre-restore', 2),
      b('a1', 'auto', 1)
    ]
    expect(pickPruned(list, 1).map((x) => x.file)).toEqual(['a3', 'a1'])
    expect(pickPruned(list, 3)).toEqual([])
  })
})
