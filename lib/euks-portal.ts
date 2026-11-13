export const EUKS_PORTAL_ORIGIN = "https://uks.smpn2blitar.sch.id"

export function loginDestination(value: string | null, origin: string): string {
  if (!value) return "/"
  try {
    const target = new URL(value, origin)
    if (target.origin === origin) return target.href
    if (target.origin === EUKS_PORTAL_ORIGIN && target.pathname === "/" && !target.search) return target.href
  } catch {
    return "/"
  }
  return "/"
}
