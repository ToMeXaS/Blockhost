import type { ServerRecord } from '../../shared/types'
import { AppError } from '../errors'
import type { JavaManager } from './manager'
import { fallbackJavaMajor, normalizeJavaMajor } from './requirements'

export interface JavaResolverDeps {
  manager: Pick<JavaManager, 'ensure' | 'isInstalled' | 'javaExe'>
  mojangJavaMajor: (mcVersion: string) => Promise<number | undefined>
  probe: (javaPath: string) => Promise<number | null>
}

type JavaTarget = Pick<ServerRecord, 'mcVersion' | 'javaPath'>

/** Decides which java.exe a server uses for installing and starting. */
export class JavaResolver {
  private readonly deps: JavaResolverDeps

  constructor(deps: JavaResolverDeps) {
    this.deps = deps
  }

  async requiredMajor(mcVersion: string): Promise<number> {
    let major: number | undefined
    try {
      major = await this.deps.mojangJavaMajor(mcVersion)
    } catch {
      major = undefined
    }
    return major ? normalizeJavaMajor(major) : fallbackJavaMajor(mcVersion)
  }

  async forInstall(server: JavaTarget, onProgress?: (percent: number) => void): Promise<string> {
    if (server.javaPath) return server.javaPath
    return this.deps.manager.ensure(await this.requiredMajor(server.mcVersion), onProgress)
  }

  async forStart(server: JavaTarget): Promise<string> {
    if (server.javaPath) {
      if ((await this.deps.probe(server.javaPath)) === null) {
        throw new AppError('JAVA_INVALID', `The custom Java at ${server.javaPath} could not be run`)
      }
      return server.javaPath
    }
    const major = await this.requiredMajor(server.mcVersion)
    if (!(await this.deps.manager.isInstalled(major))) {
      throw new AppError('JAVA_MISSING', `Java ${major} is not installed`, { major })
    }
    return this.deps.manager.javaExe(major)
  }
}
