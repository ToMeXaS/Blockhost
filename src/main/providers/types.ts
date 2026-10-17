import type { LaunchSpec, ServerType, VersionInfo } from '../../shared/types'
import type { RunJava } from '../java/run'
import type { DownloadFn } from '../net/download'
import type { HttpClient } from '../net/http'

export interface ProviderInstallOptions {
  dir: string
  version: string
  build?: string
  javaPath: string
  onLog: (line: string) => void
  onProgress: (percent: number) => void
}

export interface ServerProvider {
  readonly type: ServerType
  readonly label: string
  listVersions(): Promise<VersionInfo[]>
  listBuilds?(version: string): Promise<VersionInfo[]>
  /** Puts the server files into `dir` and returns how to launch them. */
  install(opts: ProviderInstallOptions): Promise<LaunchSpec>
}

export interface ProviderDeps {
  http: HttpClient
  download: DownloadFn
  runJava: RunJava
}

export function percentReporter(
  onProgress: (percent: number) => void
): (received: number, total: number | undefined) => void {
  return (received, total) => {
    if (total) onProgress(Math.round((received / total) * 100))
  }
}
