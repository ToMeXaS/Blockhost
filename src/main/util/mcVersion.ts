/** Leading numeric part of a Minecraft version: "1.21.4" -> [1,21,4], "26.4-snapshot-4" -> [26,4]. */
export function parseMcVersion(version: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(version)
  return match ? match[1].split('.').map(Number) : null
}

/** Negative if a < b, positive if a > b, 0 if equal (missing parts count as 0). */
export function compareMcVersions(a: string, b: string): number {
  const pa = parseMcVersion(a) ?? []
  const pb = parseMcVersion(b) ?? []
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
