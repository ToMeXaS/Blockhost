import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../shared/types'
import { UPDATE_CHECK_INTERVAL_MS, UpdateService, type UpdaterLike } from './updater'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => null)
  downloadUpdate = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

const BASE = { currentVersion: '0.1.0', enabled: true, auto: true }

function makeService(opts?: { enabled?: boolean; auto?: boolean; intervalMs?: number }) {
  const updater = new FakeUpdater()
  const statuses: UpdateStatus[] = []
  const service = new UpdateService({
    updater,
    enabled: opts?.enabled ?? true,
    auto: opts?.auto ?? true,
    currentVersion: '0.1.0',
    emit: (s) => statuses.push(s),
    intervalMs: opts?.intervalMs
  })
  return { updater, statuses, service }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateService', () => {
  it('does nothing when disabled', () => {
    const { updater, service } = makeService({ enabled: false })
    service.start()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.status()).toEqual({ state: 'idle', ...BASE, enabled: false })
  })

  it('enables auto download/install and checks immediately when enabled', () => {
    const { updater, service } = makeService()
    service.start()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('maps events to statuses in order, each carrying currentVersion', () => {
    const { updater, statuses, service } = makeService()
    service.start()
    statuses.length = 0

    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('download-progress', { percent: 44.6 })
    updater.emit('update-downloaded', { version: '0.2.0' })

    expect(statuses).toEqual([
      { state: 'available', version: '0.2.0', ...BASE },
      { state: 'downloading', version: '0.2.0', percent: 45, ...BASE },
      { state: 'ready', version: '0.2.0', ...BASE }
    ])
    expect(service.status()).toEqual({ state: 'ready', version: '0.2.0', ...BASE })
  })

  it('maps update-not-available to idle and error event to an error status', () => {
    const { updater, service } = makeService()
    service.start()

    updater.emit('update-not-available')
    expect(service.status()).toEqual({ state: 'idle', ...BASE })

    updater.emit('error', new Error('network down'))
    expect(service.status()).toEqual({
      state: 'error',
      message: 'network down',
      ...BASE
    })
  })

  it('turns a rejected checkForUpdates into an error status without an unhandled rejection', async () => {
    const { updater, service } = makeService()
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('offline')
    })
    service.start()
    await vi.waitFor(() => {
      expect(service.status()).toEqual({
        state: 'error',
        message: 'offline',
        ...BASE
      })
    })
  })

  it('checks again on the interval, but not while downloading or ready', async () => {
    const { updater, service } = makeService({ intervalMs: 1000 })
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('download-progress', { percent: 10 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    updater.emit('update-downloaded', { version: '0.2.0' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checks again after the default interval elapses with idle status', async () => {
    const { updater, service } = makeService()
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('check() runs on demand once started, but not before or while a check is in flight', () => {
    const { updater, service } = makeService()
    void service.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()

    service.start()
    updater.emit('update-not-available')
    void service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)

    updater.emit('checking-for-update')
    void service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('install() throws NO_UPDATE unless ready, and calls quitAndInstall when ready', () => {
    const { updater, service } = makeService()
    service.start()
    expect(() => service.install()).toThrow('No update is ready to install')

    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('update-downloaded', { version: '0.2.0' })
    service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('stop() clears the interval so no further checks happen', async () => {
    const { updater, service } = makeService({ intervalMs: 1000 })
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    service.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('with auto off: no timer, no auto download/install, and background checks are skipped', async () => {
    const { updater, service } = makeService({ auto: false, intervalMs: 1000 })
    service.start()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)
    await service.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.status().auto).toBe(false)
  })

  it('a manual check runs with auto off and resolves with the status afterwards', async () => {
    const { updater, service } = makeService({ auto: false })
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit('update-not-available')
      return null
    })
    service.start()
    await expect(service.check({ manual: true })).resolves.toEqual({
      state: 'idle',
      ...BASE,
      auto: false
    })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('a manual check before start (dev build) does nothing', async () => {
    const { updater, service } = makeService({ enabled: false })
    service.start()
    await service.check({ manual: true })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('download() throws unless an update is available, then starts downloading', async () => {
    const { updater, service } = makeService({ auto: false })
    service.start()
    expect(() => service.download()).toThrow('No update is available to download')

    updater.emit('update-available', { version: '0.2.0' })
    service.download()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(service.status()).toEqual({
      state: 'downloading',
      version: '0.2.0',
      percent: 0,
      ...BASE,
      auto: false
    })
  })

  it('turns a rejected downloadUpdate into an error status', async () => {
    const { updater, service } = makeService({ auto: false })
    updater.downloadUpdate = vi.fn(async () => {
      throw new Error('disk full')
    })
    service.start()
    updater.emit('update-available', { version: '0.2.0' })
    service.download()
    await vi.waitFor(() => {
      expect(service.status()).toMatchObject({ state: 'error', message: 'disk full' })
    })
  })

  it('setAuto() toggles the timer and updater flags, emitting the new setting', async () => {
    const { updater, statuses, service } = makeService({ intervalMs: 1000 })
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.emit('update-not-available')

    service.setAuto(false)
    expect(statuses.at(-1)).toEqual({ state: 'idle', ...BASE, auto: false })
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    service.setAuto(true)
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('setAuto() before start only records the setting', () => {
    const { updater, service } = makeService({ enabled: false })
    service.setAuto(false)
    expect(service.status().auto).toBe(false)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
