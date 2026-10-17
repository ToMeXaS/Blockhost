import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import {
  getEntries,
  parseProperties,
  readPropertiesFile,
  serializeProperties,
  setEntries,
  updateProperties
} from './properties'

const SAMPLE = [
  '#Minecraft server properties',
  '#Sat Oct 17 21:00:00 CEST 2026',
  'accepts-transfers=false',
  'motd=A Minecraft Server',
  'server-port=25565',
  'level-seed=',
  'white-list=false',
  ''
].join('\n')

describe('parseProperties / serializeProperties', () => {
  it('round-trips unchanged text exactly', () => {
    expect(serializeProperties(parseProperties(SAMPLE))).toBe(SAMPLE)
  })

  it('round-trips CRLF files', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    expect(serializeProperties(parseProperties(crlf))).toBe(crlf)
  })

  it('reads entries in file order', () => {
    expect(getEntries(parseProperties(SAMPLE))).toEqual([
      { key: 'accepts-transfers', value: 'false' },
      { key: 'motd', value: 'A Minecraft Server' },
      { key: 'server-port', value: '25565' },
      { key: 'level-seed', value: '' },
      { key: 'white-list', value: 'false' }
    ])
  })

  it('unescapes Java properties escapes', () => {
    expect(getEntries(parseProperties('motd=Hello\\: caf\\u00e9 \\#1\n'))).toEqual([
      { key: 'motd', value: 'Hello: café #1' }
    ])
  })

  it('accepts colon and whitespace separators', () => {
    expect(getEntries(parseProperties('a : 1\nb:2\nc   3\n'))).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' }
    ])
  })

  it('handles an empty file', () => {
    expect(serializeProperties(parseProperties(''))).toBe('')
  })
})

describe('setEntries', () => {
  it('edits in place, removes missing keys, appends new ones and escapes values', () => {
    const doc = setEntries(parseProperties(SAMPLE), [
      { key: 'motd', value: 'Hi: there é' },
      { key: 'server-port', value: '25566' },
      { key: 'level-seed', value: '' },
      { key: 'white-list', value: 'false' },
      { key: 'pvp', value: 'true' }
    ])
    expect(serializeProperties(doc)).toBe(
      [
        '#Minecraft server properties',
        '#Sat Oct 17 21:00:00 CEST 2026',
        'motd=Hi\\: there \\u00e9',
        'server-port=25566',
        'level-seed=',
        'white-list=false',
        'pvp=true',
        ''
      ].join('\n')
    )
  })
})

describe('file helpers', () => {
  it('readPropertiesFile returns [] when the file is missing', async () => {
    expect(await readPropertiesFile(await tempDir())).toEqual([])
  })

  it('updateProperties creates the file and merges later changes', async () => {
    const dir = await tempDir()
    await updateProperties(dir, { 'server-port': '25570', motd: 'x' })
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'server-port', value: '25570' },
      { key: 'motd', value: 'x' }
    ])
    await updateProperties(dir, { motd: 'y' })
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'server-port', value: '25570' },
      { key: 'motd', value: 'y' }
    ])
  })
})
