import { execFile } from 'node:child_process'

/** Extracts the Java major from `java -version` output ("1.8.0_392" -> 8, "21.0.2" -> 21). */
export function parseJavaVersionOutput(output: string): number | null {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(output)
  if (!match) return null
  const first = Number(match[1])
  return first === 1 && match[2] ? Number(match[2]) : first
}

/** Runs `<javaPath> -version`; resolves the major version or null if it is not a working Java. */
export function probeJava(javaPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      javaPath,
      ['-version'],
      { timeout: 15_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return resolve(null)
        resolve(parseJavaVersionOutput(`${stderr}\n${stdout}`))
      }
    )
  })
}
