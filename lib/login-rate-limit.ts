type RateLimitEntry = {
  attempts: number
  resetAt: number
}

const WINDOW_MS = 15 * 60 * 1000
const MAX_PAIR_ATTEMPTS = 8
const MAX_IP_ATTEMPTS = 50
const MAX_ENTRIES = 10_000

const globalForRateLimit = globalThis as typeof globalThis & {
  loginRateLimitStore?: Map<string, RateLimitEntry>
}

const store = globalForRateLimit.loginRateLimitStore ?? new Map<string, RateLimitEntry>()
globalForRateLimit.loginRateLimitStore = store

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  )
}

function keys(request: Request, identifier: string) {
  const ip = clientIp(request)
  return {
    ip: `ip:${ip}`,
    pair: `pair:${ip}:${identifier}`,
  }
}

function activeEntry(key: string, now: number) {
  const entry = store.get(key)
  if (entry && entry.resetAt <= now) {
    store.delete(key)
    return undefined
  }
  return entry
}

function increment(key: string, now: number) {
  const entry = activeEntry(key, now)
  store.set(key, entry
    ? { ...entry, attempts: entry.attempts + 1 }
    : { attempts: 1, resetAt: now + WINDOW_MS })
}

function prune(now: number) {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
  while (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (oldestKey === undefined) break
    store.delete(oldestKey)
  }
}

export function consumeLoginAttempt(request: Request, identifier: string) {
  const now = Date.now()
  prune(now)
  const key = keys(request, identifier)
  const ipAttempts = activeEntry(key.ip, now)?.attempts ?? 0
  const pairAttempts = activeEntry(key.pair, now)?.attempts ?? 0
  if (ipAttempts >= MAX_IP_ATTEMPTS || pairAttempts >= MAX_PAIR_ATTEMPTS) return false
  increment(key.ip, now)
  increment(key.pair, now)
  return true
}

export function clearLoginFailures(request: Request, identifier: string) {
  const now = Date.now()
  const key = keys(request, identifier)
  store.delete(key.pair)
  const ipEntry = activeEntry(key.ip, now)
  if (!ipEntry) return
  if (ipEntry.attempts <= 1) store.delete(key.ip)
  else store.set(key.ip, { ...ipEntry, attempts: ipEntry.attempts - 1 })
}
