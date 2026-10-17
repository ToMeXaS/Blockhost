import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { AppError } from '../errors'

/**
 * Extracts a zip archive using Windows' built-in `tar.exe`, which is dramatically faster and
 * more reliable here than the `extract-zip`/`yauzl` npm package.
 *
 * Runs with `cwd` set to the zip's own directory and passes relative arguments, since `tar.exe`
 * on Windows can mishandle absolute paths that contain non-ASCII characters or spaces.
 */
export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return mkdir(destDir, { recursive: true }).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const tarExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        const zipDir = dirname(zipPath)
        execFile(
          tarExe,
          ['-xf', basename(zipPath), '-C', relative(zipDir, destDir)],
          { cwd: zipDir, windowsHide: true },
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
