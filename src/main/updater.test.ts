import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../shared/types'
import { UPDATE_CHECK_INTERVAL_MS, UpdateService, type UpdaterLike } from './updater'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

function makeService(opts?: { enabled?: boolean; intervalMs?: number }) {
  const updater = new FakeUpdater()
  const statuses: UpdateStatus[] = []
  const service = new UpdateService({
    updater,
    enabled: opts?.enabled ?? true,
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
    expect(service.status()).toEqual({ state: 'idle', currentVersion: '0.1.0' })
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
      { state: 'available', version: '0.2.0', currentVersion: '0.1.0' },
      { state: 'downloading', version: '0.2.0', percent: 45, currentVersion: '0.1.0' },
      { state: 'ready', version: '0.2.0', currentVersion: '0.1.0' }
    ])
    expect(service.status()).toEqual({ state: 'ready', version: '0.2.0', currentVersion: '0.1.0' })
  })

  it('maps update-not-available to idle and error event to an error status', () => {
    const { updater, service } = makeService()
    service.start()

    updater.emit('update-not-available')
    expect(service.status()).toEqual({ state: 'idle', currentVersion: '0.1.0' })

    updater.emit('error', new Error('network down'))
    expect(service.status()).toEqual({
      state: 'error',
      message: 'network down',
      currentVersion: '0.1.0'
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
        currentVersion: '0.1.0'
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

  it('install() throws NO_UPDATE unless ready, and calls quitAndInstall when ready', () => {
    const { updater, service } = makeService()
    service.start()
    expect(() => service.install()).toThrow('No update is ready to install')

    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('update-downloaded', { version: '0.2.0' })
    service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('stop() clears the interval so no further checks happen', async () => {
    const { updater, service } = makeService({ intervalMs: 1000 })
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    service.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
