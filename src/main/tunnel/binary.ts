import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { DownloadFn } from '../net/download'
import { pathExists } from '../util/fs'

export const PLAYITD_VERSION = '1.0.12'
export const PLAYITD_URL = `https://github.com/playit-cloud/playit-agent/releases/download/v${PLAYITD_VERSION}/playit-windows-x86_64-signed.exe`
export const PLAYITD_SHA256 = '367fb813a20c67c7501e3921298ce51a641e5b25e6005f6059808f89404ba44b'

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export interface PlayitdBinaryDeps {
  dir: string
  download: DownloadFn
  hashFile?: (path: string) => Promise<string>
}

/** The pinned playit agent daemon, downloaded on first use. */
export class PlayitdBinary {
  private readonly deps: PlayitdBinaryDeps
  private inflight: Promise<string> | null = null

  constructor(deps: PlayitdBinaryDeps) {
    this.deps = deps
  }

  path(): string {
    return join(this.deps.dir, `playitd-${PLAYITD_VERSION}.exe`)
  }

  ensure(onProgress?: (percent: number) => void): Promise<string> {
    if (!this.inflight) {
      this.inflight = this.install(onProgress).finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async install(onProgress?: (percent: number) => void): Promise<string> {
    const exe = this.path()
    const hashFile = this.deps.hashFile ?? sha256File
    if (await pathExists(exe)) {
      if ((await hashFile(exe)).toLowerCase() === PLAYITD_SHA256) return exe
      await rm(exe, { force: true })
    }
    await this.deps.download({
      url: PLAYITD_URL,
      dest: exe,
      hash: { algo: 'sha256', value: PLAYITD_SHA256 },
      onProgress: (received, total) => {
        if (total) onProgress?.(Math.floor((received * 100) / total))
      }
    })
    return exe
  }
}
