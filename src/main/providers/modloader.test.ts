import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { pathExists } from '../util/fs'
import { parseRunBat, resolveLaunchSpec, runModLoaderInstaller } from './modloader'
import { FORGE_RUN_BAT, NEO_RUN_BAT } from './runBat.fixtures'

describe('parseRunBat', () => {
  it('extracts the Forge args file and ignores the Java pre-check line', () => {
    expect(parseRunBat(FORGE_RUN_BAT)).toEqual({
      args: ['@libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt']
    })
  })

  it('extracts the NeoForge args file', () => {
    expect(parseRunBat(NEO_RUN_BAT)).toEqual({
      args: ['@libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt']
    })
  })

  it('returns null when there is no launch line', () => {
    expect(parseRunBat('@echo off\r\npause')).toBeNull()
  })
})

describe('resolveLaunchSpec', () => {
  it('falls back to the legacy Forge jar', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'forge-1.12.2-14.23.5.2860.jar'), '')
    await writeFile(join(dir, 'minecraft_server.1.12.2.jar'), '')
    expect(await resolveLaunchSpec(dir)).toEqual({
      args: ['-jar', 'forge-1.12.2-14.23.5.2860.jar']
    })
  })

  it('throws LAUNCH_NOT_FOUND when nothing is launchable', async () => {
    await expect(resolveLaunchSpec(await tempDir())).rejects.toMatchObject({
      code: 'LAUNCH_NOT_FOUND'
    })
  })
})

describe('runModLoaderInstaller', () => {
  it('downloads and runs the installer, cleans up, and returns the launch spec', async () => {
    const dir = await tempDir()
    const runJava = vi.fn(async (_java: string, _args: string[], cwd: string) => {
      await writeFile(join(cwd, 'run.bat'), NEO_RUN_BAT)
      await writeFile(join(cwd, 'installer.jar.log'), 'log')
      return 0
    })
    const { deps, dl } = fakeProviderDeps({}, runJava)
    const spec = await runModLoaderInstaller(
      deps,
      installOpts(dir, '26.3'),
      'https://maven.test/installer.jar'
    )
    expect(dl.calls[0]).toMatchObject({
      url: 'https://maven.test/installer.jar',
      dest: join(dir, 'installer.jar')
    })
    expect(runJava).toHaveBeenCalledWith(
      'C:/java/bin/java.exe',
      ['-jar', 'installer.jar', '--installServer'],
      dir,
      expect.any(Function)
    )
    expect(spec.args).toEqual(['@libraries/net/neoforged/neoforge/26.3.0.88/win_args.txt'])
    expect(await pathExists(join(dir, 'installer.jar'))).toBe(false)
    expect(await pathExists(join(dir, 'installer.jar.log'))).toBe(false)
    expect(await readFile(join(dir, 'run.bat'), 'utf8')).toBe(NEO_RUN_BAT)
  })

  it('throws INSTALLER_FAILED on a non-zero exit code', async () => {
    const { deps } = fakeProviderDeps({}, async () => 1)
    await expect(
      runModLoaderInstaller(deps, installOpts(await tempDir(), '26.3'), 'https://maven.test/i.jar')
    ).rejects.toMatchObject({ code: 'INSTALLER_FAILED' })
  })
})
