import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { extractZip } from './extract'

const execFileAsync = promisify(execFile)
const tarExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

async function buildZip(srcDir: string, fileName: string, destZip: string): Promise<void> {
  await execFileAsync(tarExe, ['-a', '-cf', destZip, '-C', srcDir, fileName])
}

describe('extractZip', () => {
  it('round-trips a file through a zip archive', async () => {
    const root = await tempDir()
    const srcDir = join(root, 'src')
    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'hello.txt'), 'hello world')
    const zip = join(root, 'test.zip')
    await buildZip(srcDir, 'hello.txt', zip)

    const destDir = join(root, 'out')
    await extractZip(zip, destDir)

    expect(await readFile(join(destDir, 'hello.txt'), 'utf8')).toBe('hello world')
  })

  it('rejects with JAVA_EXTRACT for a non-zip file', async () => {
    const root = await tempDir()
    const garbage = join(root, 'garbage.zip')
    await writeFile(garbage, 'not a zip file at all')

    await expect(extractZip(garbage, join(root, 'out'))).rejects.toMatchObject({
      code: 'JAVA_EXTRACT'
    })
  })
})
