import { describe, expect, it } from 'vitest'
import { runJava } from './run'

describe('runJava', () => {
  it('streams stdout and stderr lines and resolves with the exit code', async () => {
    const lines: string[] = []
    const code = await runJava(
      process.execPath,
      ['-e', "console.log('one'); console.error('two'); process.exit(3)"],
      process.cwd(),
      (line) => lines.push(line)
    )
    expect(code).toBe(3)
    expect(lines.sort()).toEqual(['one', 'two'])
  })

  it('rejects with JAVA_SPAWN when the executable does not exist', async () => {
    await expect(
      runJava('C:/definitely/not/here/java.exe', [], process.cwd(), () => {})
    ).rejects.toMatchObject({ code: 'JAVA_SPAWN' })
  })
})
