/** Turns arbitrary text chunks into complete lines (LF or CRLF). */
export class LineSplitter {
  private buffer = ''
  private readonly onLine: (line: string) => void

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine
  }

  push(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    for (const part of parts) this.onLine(part.replace(/\r$/, ''))
  }

  flush(): void {
    if (!this.buffer) return
    const rest = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    this.onLine(rest)
  }
}
