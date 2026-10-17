import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../errors'
import type { DownloadFn } from '../net/download'
import type { HttpClient } from '../net/http'
import { pathExists } from '../util/fs'

interface AdoptiumAsset {
  release_name: string
  binary: { package: { link: string; checksum: string; name: string } }
}

export function adoptiumAssetsUrl(major: number): string {
  return `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jre`
}

export interface JavaManagerDeps {
  root: string
  http: HttpClient
  download: DownloadFn
  extractZip: (zipPath: string, destDir: string) => Promise<void>
}

/** Installs Eclipse Temurin JREs into `<root>/temurin-<major>/`, one per major, shared by servers. */
export class JavaManager {
  private readonly deps: JavaManagerDeps
  private readonly inflight = new Map<number, Promise<string>>()

  constructor(deps: JavaManagerDeps) {
    this.deps = deps
  }

  javaExe(major: number): string {
    return join(this.deps.root, `temurin-${major}`, 'bin', 'java.exe')
  }

  isInstalled(major: number): Promise<boolean> {
    return pathExists(this.javaExe(major))
  }

  ensure(major: number, onProgress?: (percent: number) => void): Promise<string> {
    const existing = this.inflight.get(major)
    if (existing) return existing
    const job = this.install(major, onProgress).finally(() => this.inflight.delete(major))
    this.inflight.set(major, job)
    return job
  }

  private async install(major: number, onProgress?: (percent: number) => void): Promise<string> {
    if (await this.isInstalled(major)) return this.javaExe(major)

    const assets = await this.deps.http.getJson<AdoptiumAsset[]>(adoptiumAssetsUrl(major))
    const pkg = assets[0]?.binary.package
    if (!pkg) {
      throw new AppError('JAVA_UNAVAILABLE', `No Java ${major} build is available for Windows x64`)
    }

    const zip = join(this.deps.root, pkg.name)
    await this.deps.download({
      url: pkg.link,
      dest: zip,
      hash: { algo: 'sha256', value: pkg.checksum },
      onProgress: (received, total) => {
        if (total) onProgress?.(Math.round((received / total) * 100))
      }
    })

    const staging = join(this.deps.root, `temurin-${major}.staging`)
    const final = join(this.deps.root, `temurin-${major}`)
    await rm(staging, { recursive: true, force: true })
    await this.deps.extractZip(zip, staging)
    // Temurin zips contain a single top-level folder such as "jdk-21.0.12.1+1-jre".
    const [top] = await readdir(staging)
    if (!top) throw new AppError('JAVA_EXTRACT', `The Java ${major} archive was empty`)
    await rm(final, { recursive: true, force: true })
    await rename(join(staging, top), final)
    await rm(staging, { recursive: true, force: true })
    await rm(zip, { force: true })

    if (!(await this.isInstalled(major))) {
      throw new AppError('JAVA_EXTRACT', `The Java ${major} archive did not contain bin/java.exe`)
    }
    return this.javaExe(major)
  }
}
