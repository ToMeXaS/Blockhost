import { spawn } from 'node:child_process'
import { AppError } from '../errors'
import { LineSplitter } from '../util/lines'

export type RunJava = (
  javaPath: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
) => Promise<number>

/** Runs a short-lived Java process (e.g. a mod loader installer) and streams its output lines. */
export const runJava: RunJava = (javaPath, args, cwd, onLine) =>
  new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd, windowsHide: true })
    const stdout = new LineSplitter(onLine)
    const stderr = new LineSplitter(onLine)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk))
    child.on('error', (err) =>
      reject(new AppError('JAVA_SPAWN', `Could not run Java: ${err.message}`))
    )
    child.on('close', (code) => {
      stdout.flush()
      stderr.flush()
      resolve(code ?? -1)
    })
  })
