import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeDownload, fakeHttp, tempDir } from '../test-utils'
import { pathExists } from '../util/fs'
import { adoptiumAssetsUrl, JavaManager } from './manager'

const asset21 = {
  release_name: 'jdk-21.0.12.1+1',
  binary: {
    package: {
      link: 'https://dl.test/jre21.zip',
      checksum: 'abc123',
      name: 'OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip'
    }
  }
}

async function setup() {
  const root = await tempDir()
  const http = fakeHttp({ [adoptiumAssetsUrl(21)]: [asset21], [adoptiumAssetsUrl(8)]: [] })
  const dl = fakeDownload()
  const extractZip = vi.fn(async (_zip: string, dest: string) => {
    const bin = join(dest, 'jdk-21.0.12.1+1-jre', 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'java.exe'), '')
  })
  const manager = new JavaManager({ root, http, download: dl.fn, extractZip })
  return { root, dl, extractZip, manager }
}

describe('JavaManager', () => {
  it('builds the Adoptium query for Windows x64 JREs', () => {
    expect(adoptiumAssetsUrl(25)).toBe(
      'https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jre'
    )
  })

  it('downloads, verifies and extracts a JRE into temurin-<major>', async () => {
    const { root, dl, manager } = await setup()
    const exe = await manager.ensure(21)
    expect(exe).toBe(join(root, 'temurin-21', 'bin', 'java.exe'))
    expect(await pathExists(exe)).toBe(true)
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/jre21.zip',
      hash: { algo: 'sha256', value: 'abc123' }
    })
    expect(await pathExists(join(root, asset21.binary.package.name))).toBe(false)
    expect(await pathExists(join(root, 'temurin-21.staging'))).toBe(false)
  })

  it('does not download again once installed', async () => {
    const { dl, manager } = await setup()
    await manager.ensure(21)
    await manager.ensure(21)
    expect(dl.calls).toHaveLength(1)
    expect(await manager.isInstalled(21)).toBe(true)
  })

  it('deduplicates concurrent installs of the same major', async () => {
    const { dl, manager } = await setup()
    const [a, b] = await Promise.all([manager.ensure(21), manager.ensure(21)])
    expect(a).toBe(b)
    expect(dl.calls).toHaveLength(1)
  })

  it('fails clearly when Adoptium has no build', async () => {
    const { manager } = await setup()
    await expect(manager.ensure(8)).rejects.toMatchObject({ code: 'JAVA_UNAVAILABLE' })
  })
})
