import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../test-utils'
import { claimExpired, claimRejected, type ClaimSetupState } from './api'
import { CLAIM_TIMEOUT_MS, parseSecretFile, PlayitAccount, secretFileContent } from './account'

async function setup(
  opts: {
    setup?: ClaimSetupState[]
    exchange?: (string | null)[]
    setupError?: Error
    exchangeError?: Error
  } = {}
) {
  const file = join(await tempDir(), 'playit', 'playit.toml')
  const setupStates = [...(opts.setup ?? ['WaitingForUserVisit', 'WaitingForUser', 'UserAccepted'])]
  const exchanges = [...(opts.exchange ?? [null, 'secret123'])]
  let clock = 0
  const api = {
    claimSetup: vi.fn(async () => {
      if (opts.setupError) throw opts.setupError
      return setupStates.length > 1 ? setupStates.shift()! : setupStates[0]
    }),
    claimExchange: vi.fn(async () => {
      if (opts.exchangeError) throw opts.exchangeError
      return exchanges.length > 1 ? exchanges.shift()! : exchanges[0]
    })
  }
  const openUrl = vi.fn(async () => {})
  const sleep = vi.fn(async (ms: number, signal: AbortSignal) => {
    clock += ms
    await Promise.resolve()
    if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'CANCELLED' })
  })
  const account = new PlayitAccount({
    file,
    api,
    openUrl,
    randomCode: () => 'c0de',
    sleep,
    now: () => clock
  })
  return { file, api, openUrl, sleep, account }
}

describe('secret file', () => {
  it('writes and parses the playitd format', () => {
    expect(secretFileContent('abc123')).toBe('secret_key = "abc123"\n')
    expect(parseSecretFile('secret_key = "abc123"\n')).toBe('abc123')
    expect(parseSecretFile('# comment\nsecret_key="  k  "')).toBe('k')
    expect(parseSecretFile('secret_key = ""')).toBeNull()
    expect(parseSecretFile('nonsense')).toBeNull()
  })
})

describe('PlayitAccount', () => {
  it('is not linked without a secret file', async () => {
    const { account } = await setup()
    expect(await account.isLinked()).toBe(false)
    expect(await account.secret()).toBeNull()
  })

  it('opens the claim URL, waits for acceptance and saves the key', async () => {
    const { account, openUrl, api, file } = await setup()
    await account.link()
    expect(openUrl).toHaveBeenCalledWith('https://playit.gg/claim/c0de')
    expect(api.claimSetup).toHaveBeenCalledTimes(3)
    expect(api.claimSetup).toHaveBeenCalledWith('c0de')
    expect(api.claimExchange).toHaveBeenCalledTimes(2)
    expect(await readFile(file, 'utf8')).toBe('secret_key = "secret123"\n')
    expect(await account.isLinked()).toBe(true)
  })

  it('rejects when the user declines', async () => {
    const { account, file } = await setup({ setup: ['WaitingForUser', 'UserRejected'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_REJECTED' })
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('passes through expiry and rejection from the API', async () => {
    const expired = await setup({ setupError: claimExpired() })
    await expect(expired.account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    const rejected = await setup({ exchangeError: claimRejected() })
    await expect(rejected.account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_REJECTED' })
  })

  it('gives up after ten minutes', async () => {
    const { account, sleep } = await setup({ setup: ['WaitingForUserVisit'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    const waited = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0)
    expect(waited).toBeGreaterThanOrEqual(CLAIM_TIMEOUT_MS)
    expect(waited).toBeLessThan(CLAIM_TIMEOUT_MS + 5000)
  })

  it('shares one attempt and can be cancelled', async () => {
    const { account, api } = await setup({ setup: ['WaitingForUserVisit'] })
    const first = account.link()
    const second = account.link()
    expect(second).toBe(first)
    account.cancelLink()
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(api.claimSetup.mock.calls.length).toBeLessThan(5)
  })

  it('rejects a key with unexpected characters', async () => {
    const { account } = await setup({ exchange: ['bad key"\n'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_API' })
  })

  it('unlinks by deleting the secret file', async () => {
    const { account, file } = await setup()
    await account.link()
    await account.unlink()
    expect(await account.isLinked()).toBe(false)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('does not save the key when unlinked while the exchange is in flight', async () => {
    const { account, api, file } = await setup({ setup: ['UserAccepted'] })
    let resolveExchange: (key: string | null) => void = () => {}
    api.claimExchange.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (resolveExchange = resolve))
    )
    const linking = account.link()
    await vi.waitFor(() => expect(api.claimExchange).toHaveBeenCalled())
    await account.unlink()
    resolveExchange('secret123')
    await expect(linking).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(await account.isLinked()).toBe(false)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('reads a secret file written by hand', async () => {
    const { account, file } = await setup()
    await account.link()
    await writeFile(file, 'secret_key = "other"\n')
    expect(await account.secret()).toBe('other')
  })
})
