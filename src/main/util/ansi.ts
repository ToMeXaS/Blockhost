const ANSI_PATTERN = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}
