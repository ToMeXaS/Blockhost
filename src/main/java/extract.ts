import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../errors'

/**
 * Extracts a zip archive using Windows' built-in `tar.exe`, which is dramatically faster and
 * more reliable here than the `extract-zip`/`yauzl` npm package.
 */
export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return mkdir(destDir, { recursive: true }).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const tarExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        execFile(
          tarExe,
          ['-xf', zipPath, '-C', destDir],
          { windowsHide: true },
          (err, _stdout, stderr) => {
            if (err) {
              reject(
                new AppError(
                  'JAVA_EXTRACT',
                  `Could not extract the Java archive: ${stderr || err.message}`
                )
              )
              return
            }
            resolve()
          }
        )
      })
  )
}
