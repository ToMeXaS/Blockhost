import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge } from '../shared/api'

const invokeChannels: readonly string[] = INVOKE_CHANNELS
const eventChannels: readonly string[] = EVENT_CHANNELS

const bridge: Bridge = {
  invoke(channel, ...args) {
    if (!invokeChannels.includes(channel)) {
      return Promise.reject(new Error(`Unknown channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!eventChannels.includes(channel)) throw new Error(`Unknown event: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('blockhost', bridge)
