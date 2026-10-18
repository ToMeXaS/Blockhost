import { describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'
import { formatUuid, lookupPlayer, MOJANG_PROFILE_URL, offlineUuid } from './uuid'

function http(getText: (url: string) => Promise<string>): HttpClient & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    getJson: async () => {
      throw new Error('getJson must not be used for profile lookups')
    },
    getText: async (url) => {
      urls.push(url)
      return getText(url)
    }
  }
}

describe('offlineUuid', () => {
  // Expected values produced by Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>"),
  // which is what offline-mode servers use.
  it('matches the server derivation', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641')
  })
})

describe('formatUuid', () => {
  it('inserts dashes and lowercases', () => {
    expect(formatUuid('069A79F444E94726A5BEFCA90E38AAF5')).toBe(
      '069a79f4-44e9-4726-a5be-fca90e38aaf5'
    )
  })
})

describe('lookupPlayer', () => {
  it('uses the offline UUID without the network when online mode is off', async () => {
    const client = http(async () => {
      throw new Error('no network expected')
    })
    expect(await lookupPlayer(client, 'Steve', false)).toEqual({
      uuid: '5627dd98-e6be-3c21-b8a8-e92344183641',
      name: 'Steve'
    })
    expect(client.urls).toEqual([])
  })

  it('looks the name up at Mojang and keeps the canonical spelling', async () => {
    const client = http(async () => '{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch"}')
    expect(await lookupPlayer(client, 'notch', true)).toEqual({
      uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
      name: 'Notch'
    })
    expect(client.urls).toEqual([`${MOJANG_PROFILE_URL}notch`])
  })

  it('reports unknown names as PLAYER_NOT_FOUND', async () => {
    const notFound = http(async () => {
      throw new AppError('HTTP', 'api.mojang.com returned HTTP 404', { status: 404 })
    })
    await expect(lookupPlayer(notFound, 'Nobody_123', true)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
      message: 'No Minecraft account named Nobody_123'
    })
    const empty = http(async () => '')
    await expect(lookupPlayer(empty, 'Nobody_123', true)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND'
    })
  })

  it('explains that offline mode avoids the lookup when the network is down', async () => {
    const client = http(async () => {
      throw new AppError('NETWORK', 'Could not reach api.mojang.com: getaddrinfo ENOTFOUND')
    })
    await expect(lookupPlayer(client, 'Steve', true)).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('online mode')
    })
  })

  it('passes other HTTP errors through', async () => {
    const client = http(async () => {
      throw new AppError('HTTP', 'api.mojang.com returned HTTP 429', { status: 429 })
    })
    await expect(lookupPlayer(client, 'Steve', true)).rejects.toMatchObject({
      code: 'HTTP',
      details: { status: 429 }
    })
  })
})
