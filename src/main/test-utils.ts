import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AppError } from './errors'
import type { RunJava } from './java/run'
import type { HttpClient } from './net/http'
import type { DownloadFn, DownloadOptions } from './net/download'
import type { Manifest, ManifestEntry } from './content/manifest'
import type { ProviderDeps, ProviderInstallOptions } from './providers/types'

export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'blockhost-test-'))
}

/** HttpClient that answers from a url -> value map and records requested URLs. */
export function fakeHttp(routes: Record<string, unknown>): HttpClient & { requested: string[] } {
  const requested: string[] = []
  const lookup = (url: string): unknown => {
    requested.push(url)
    if (!(url in routes)) throw new AppError('HTTP', `Unexpected URL in test: ${url}`)
    return routes[url]
  }
  return {
    requested,
    async getJson<T>(url: string): Promise<T> {
      return lookup(url) as T
    },
    async getText(url: string): Promise<string> {
      return String(lookup(url))
    }
  }
}

/** DownloadFn that records calls and writes a placeholder file to `dest`. */
export function fakeDownload(): { calls: DownloadOptions[]; fn: DownloadFn } {
  const calls: DownloadOptions[] = []
  const fn: DownloadFn = async (opts) => {
    calls.push(opts)
    await mkdir(dirname(opts.dest), { recursive: true })
    await writeFile(opts.dest, 'x')
  }
  return { calls, fn }
}

export function fakeProviderDeps(
  routes: Record<string, unknown>,
  runJava: RunJava = async () => 0
) {
  const http = fakeHttp(routes)
  const dl = fakeDownload()
  const deps: ProviderDeps = { http, download: dl.fn, runJava }
  return { http, dl, deps }
}

export function installOpts(dir: string, version: string, build?: string): ProviderInstallOptions {
  return {
    dir,
    version,
    build,
    javaPath: 'C:/java/bin/java.exe',
    onLog: () => {},
    onProgress: () => {}
  }
}

export function manifestEntry(
  e: Partial<ManifestEntry> & Pick<ManifestEntry, 'fileName' | 'projectId'>
): ManifestEntry {
  return {
    source: 'modrinth',
    versionId: `${e.projectId}-v`,
    title: e.projectId,
    versionNumber: '1',
    iconUrl: null,
    sha1: `sha1-${e.fileName}`,
    dependencyOf: [],
    disabled: false,
    explicit: true,
    installedAt: '2026-10-24T00:00:00.000Z',
    ...e
  }
}

export function manifestOf(entries: ManifestEntry[], includeBeta = false): Manifest {
  return { version: 2, includeBeta, entries }
}
