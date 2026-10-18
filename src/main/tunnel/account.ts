import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { AppError } from '../errors'
import { writeFileAtomic } from '../util/fs'
import { claimExpired, claimRejected, type PlayitApi } from './api'

export const CLAIM_URL = 'https://playit.gg/claim/'
export const CLAIM_POLL_MS = 2000
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/

export function secretFileContent(key: string): string {
  return `secret_key = "${key}"\n`
}

export function parseSecretFile(text: string): string | null {
  const match = /^\s*secret_key\s*=\s*"([^"]*)"\s*$/m.exec(text)
  const key = match?.[1].trim()
  return key ? key : null
}

const cancelled = (): AppError => new AppError('CANCELLED', 'Linking was cancelled.')

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface PlayitAccountDeps {
  file: string
  api: Pick<PlayitApi, 'claimSetup' | 'claimExchange'>
  openUrl: (url: string) => Promise<void>
  randomCode?: () => string
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

/** The app's playit.gg agent key, stored where playitd reads it. */
export class PlayitAccount {
  private readonly deps: PlayitAccountDeps
  private current: { promise: Promise<void>; controller: AbortController } | null = null

  constructor(deps: PlayitAccountDeps) {
    this.deps = deps
  }

  async secret(): Promise<string | null> {
    try {
      return parseSecretFile(await readFile(this.deps.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async isLinked(): Promise<boolean> {
    return (await this.secret()) !== null
  }

  link(): Promise<void> {
    if (this.current) return this.current.promise
    const controller = new AbortController()
    const promise = this.run(controller.signal).finally(() => {
      this.current = null
    })
    this.current = { promise, controller }
    return promise
  }

  cancelLink(): void {
    this.current?.controller.abort()
  }

  async unlink(): Promise<void> {
    this.cancelLink()
    await rm(this.deps.file, { force: true })
  }

  private async run(signal: AbortSignal): Promise<void> {
    const sleep = this.deps.sleep ?? abortableSleep
    const now = this.deps.now ?? Date.now
    const code = (this.deps.randomCode ?? (() => randomBytes(16).toString('hex')))()
    await this.deps.openUrl(`${CLAIM_URL}${code}`)
    const deadline = now() + CLAIM_TIMEOUT_MS

    const wait = async (): Promise<void> => {
      if (now() >= deadline) throw claimExpired()
      await sleep(CLAIM_POLL_MS, signal)
      if (signal.aborted) throw cancelled()
    }

    for (;;) {
      if (signal.aborted) throw cancelled()
      const state = await this.deps.api.claimSetup(code)
      if (state === 'UserAccepted') break
      if (state === 'UserRejected') throw claimRejected()
      await wait()
    }

    for (;;) {
      if (signal.aborted) throw cancelled()
      const key = await this.deps.api.claimExchange(code)
      if (key !== null) {
        const trimmed = key.trim()
        if (!KEY_PATTERN.test(trimmed)) {
          throw new AppError('PLAYIT_API', 'playit.gg returned a key Blockhost cannot use.')
        }
        await writeFileAtomic(this.deps.file, secretFileContent(trimmed))
        return
      }
      await wait()
    }
  }
}
