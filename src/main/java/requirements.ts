import { compareMcVersions, parseMcVersion } from '../util/mcVersion'

/** Temurin LTS majors Blockhost installs. */
export const JAVA_MAJORS = [8, 17, 21, 25] as const

/** Maps a required Java major (e.g. Mojang's 16 for 1.17) to the LTS that satisfies it. */
export function normalizeJavaMajor(major: number): number {
  for (const lts of JAVA_MAJORS) if (major <= lts) return lts
  return major
}

/** Used when the Mojang version metadata is unavailable (offline or unknown version). */
export function fallbackJavaMajor(mcVersion: string): number {
  const parts = parseMcVersion(mcVersion)
  if (!parts || parts[0] !== 1) return 25
  if (compareMcVersions(mcVersion, '1.20.5') >= 0) return 21
  if (compareMcVersions(mcVersion, '1.17') >= 0) return 17
  return 8
}
