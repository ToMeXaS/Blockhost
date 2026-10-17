import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LaunchSpec } from '../../shared/types'
import { AppError } from '../errors'
import { pathExists } from '../util/fs'
import { percentReporter, type ProviderDeps, type ProviderInstallOptions } from './types'

/**
 * Reads the launch line written by modern Forge/NeoForge installers, e.g.
 * `java @user_jvm_args.txt @libraries/.../win_args.txt %*` -> ['@libraries/.../win_args.txt'].
 * We manage JVM args ourselves, so `@user_jvm_args.txt` and `%*` are dropped.
 */
export function parseRunBat(content: string): LaunchSpec | null {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^java\s/i.test(line) || !line.includes('@user_jvm_args.txt')) continue
    const args = line
      .split(/\s+/)
      .slice(1)
      .filter((token) => token !== '@user_jvm_args.txt' && token !== '%*')
    return { args }
  }
  return null
}

export async function resolveLaunchSpec(dir: string): Promise<LaunchSpec> {
  const runBat = join(dir, 'run.bat')
  if (await pathExists(runBat)) {
    const spec = parseRunBat(await readFile(runBat, 'utf8'))
    if (spec) return spec
  }
  // Legacy Forge (<= 1.16) installs a runnable forge-<version>.jar instead of run.bat.
  const jar = (await readdir(dir)).find(
    (file) => /^(forge|neoforge)-.+\.jar$/i.test(file) && !/installer|shim/i.test(file)
  )
  if (jar) return { args: ['-jar', jar] }
  throw new AppError(
    'LAUNCH_NOT_FOUND',
    'The installer finished but no server launch file was found'
  )
}

export async function runModLoaderInstaller(
  deps: ProviderDeps,
  opts: ProviderInstallOptions,
  installerUrl: string
): Promise<LaunchSpec> {
  const installer = join(opts.dir, 'installer.jar')
  opts.onLog(`Downloading installer: ${installerUrl}`)
  await deps.download({
    url: installerUrl,
    dest: installer,
    onProgress: percentReporter(opts.onProgress)
  })

  opts.onLog('Running installer. This can take a few minutes…')
  const code = await deps.runJava(
    opts.javaPath,
    ['-jar', 'installer.jar', '--installServer'],
    opts.dir,
    opts.onLog
  )
  if (code !== 0) throw new AppError('INSTALLER_FAILED', `The installer exited with code ${code}`)

  await rm(installer, { force: true })
  await rm(`${installer}.log`, { force: true })
  return resolveLaunchSpec(opts.dir)
}
