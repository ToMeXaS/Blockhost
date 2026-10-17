import { describe, expect, it, vi } from 'vitest'
import { JavaResolver } from './resolver'

function fakeManager(installed: number[]) {
  return {
    ensure: vi.fn(async (major: number) => `C:/java/${major}/bin/java.exe`),
    isInstalled: vi.fn(async (major: number) => installed.includes(major)),
    javaExe: (major: number) => `C:/java/${major}/bin/java.exe`
  }
}

describe('JavaResolver', () => {
  it('uses the Mojang Java version, normalized to an LTS', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 16,
      probe: async () => null
    })
    expect(await resolver.requiredMajor('1.17.1')).toBe(17)
  })

  it('falls back to the version table when the lookup fails or is unknown', async () => {
    const failing = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => {
        throw new Error('offline')
      },
      probe: async () => null
    })
    expect(await failing.requiredMajor('26.3')).toBe(25)
    const unknown = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => undefined,
      probe: async () => null
    })
    expect(await unknown.requiredMajor('1.20.4')).toBe(17)
  })

  it('forInstall prefers a custom Java path', async () => {
    const manager = fakeManager([])
    const resolver = new JavaResolver({
      manager,
      mojangJavaMajor: async () => 21,
      probe: async () => 21
    })
    const path = await resolver.forInstall({ mcVersion: '1.21.4', javaPath: 'D:/jdk/bin/java.exe' })
    expect(path).toBe('D:/jdk/bin/java.exe')
    expect(manager.ensure).not.toHaveBeenCalled()
  })

  it('forInstall ensures the managed Java', async () => {
    const manager = fakeManager([])
    const resolver = new JavaResolver({
      manager,
      mojangJavaMajor: async () => 21,
      probe: async () => null
    })
    expect(await resolver.forInstall({ mcVersion: '1.21.4' })).toBe('C:/java/21/bin/java.exe')
    expect(manager.ensure).toHaveBeenCalledWith(21, undefined)
  })

  it('forStart returns the managed exe when installed', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([25]),
      mojangJavaMajor: async () => 25,
      probe: async () => null
    })
    expect(await resolver.forStart({ mcVersion: '26.3' })).toBe('C:/java/25/bin/java.exe')
  })

  it('forStart throws JAVA_MISSING with the required major', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 21,
      probe: async () => null
    })
    await expect(resolver.forStart({ mcVersion: '1.21.4' })).rejects.toMatchObject({
      code: 'JAVA_MISSING',
      details: { major: 21 }
    })
  })

  it('forStart rejects a custom Java that cannot run', async () => {
    const resolver = new JavaResolver({
      manager: fakeManager([]),
      mojangJavaMajor: async () => 21,
      probe: async () => null
    })
    await expect(
      resolver.forStart({ mcVersion: '1.21.4', javaPath: 'D:/broken/java.exe' })
    ).rejects.toMatchObject({ code: 'JAVA_INVALID' })
  })
})
