import { readFile, rename } from 'node:fs/promises'
import type { ServerRecord } from '../../shared/types'
import { AppError } from '../errors'
import { writeFileAtomic } from '../util/fs'

interface StoreFile {
  version: 1
  servers: ServerRecord[]
}

/** The servers.json registry. All reads are synchronous from memory; writes are serialized. */
export class ServerStore {
  private readonly file: string
  private servers: ServerRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.servers = []
        return
      }
      throw err
    }
    try {
      const data = JSON.parse(text) as StoreFile
      const servers = Array.isArray(data.servers) ? data.servers : []
      this.servers = servers.map((s) =>
        s.installState === 'installing' ? { ...s, installState: 'failed' } : s
      )
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`)
      this.servers = []
    }
  }

  list(): ServerRecord[] {
    return structuredClone(this.servers)
  }

  get(id: string): ServerRecord {
    return structuredClone(this.servers[this.indexOf(id)])
  }

  async add(rec: ServerRecord): Promise<void> {
    this.servers.push(structuredClone(rec))
    await this.save()
  }

  async update(id: string, patch: Partial<Omit<ServerRecord, 'id'>>): Promise<ServerRecord> {
    const index = this.indexOf(id)
    this.servers[index] = { ...this.servers[index], ...structuredClone(patch) }
    await this.save()
    return structuredClone(this.servers[index])
  }

  async remove(id: string): Promise<void> {
    this.servers = this.servers.filter((s) => s.id !== id)
    await this.save()
  }

  private indexOf(id: string): number {
    const index = this.servers.findIndex((s) => s.id === id)
    if (index < 0) throw new AppError('NOT_FOUND', 'Server not found')
    return index
  }

  private save(): Promise<void> {
    const data: StoreFile = { version: 1, servers: this.servers }
    const json = JSON.stringify(data, null, 2)
    this.writing = this.writing.catch(() => {}).then(() => writeFileAtomic(this.file, json))
    return this.writing
  }
}
