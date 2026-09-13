/**
 * Proteksi same-origin untuk mutasi berkewenangan.
 *
 * Auth.js v5 memasang CSRF token pada endpoint sign-in miliknya sendiri; route
 * handler kustom di `app/api/**` TIDAK ikut terlindungi. Karena sesi memakai
 * cookie, mutasi RBAC/akun/kredensial harus memverifikasi origin sendiri.
 *
 * Keputusan desain:
 *
 *   - Origin tepercaya berasal dari KONFIGURASI server (`APP_ORIGIN`/`AUTH_URL`),
 *     tidak pernah dari `Host` atau `X-Forwarded-Host`. Header itu dikendalikan
 *     klien di banyak topologi proxy, sehingga memercayainya sama saja dengan
 *     tidak memeriksa.
 *   - Fail closed: mutasi tanpa header `Origin` ditolak, dan daftar tepercaya
 *     yang kosong menolak semuanya. Konfigurasi yang belum diisi harus
 *     mematahkan mutasi, bukan membuka pintu.
 *   - Perbandingan dilakukan atas origin hasil parse (skema + host + port),
 *     bukan atas substring, agar `evil-sekolah.example.id` tidak lolos.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type SameOriginRequest = {
  method: string
  headers: Headers
}

export type SameOriginResult =
  | { ok: true }
  | { ok: false; status: 403; error: string }

/**
 * Mengumpulkan origin tepercaya dari environment.
 *
 * Di produksi tanpa konfigurasi, hasilnya sengaja kosong: lebih baik seluruh
 * mutasi gagal terang-terangan daripada menebak origin dari header permintaan.
 */
export function resolveTrustedOrigins(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string[] {
  const origins = new Set<string>()

  for (const raw of [env.APP_ORIGIN, env.AUTH_URL, env.NEXTAUTH_URL]) {
    const origin = toOrigin(raw)
    if (origin) origins.add(origin)
  }

  if (origins.size === 0 && env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000")
    origins.add("http://127.0.0.1:3000")
  }

  return [...origins]
}

function toOrigin(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Memverifikasi bahwa permintaan mutasi datang dari origin aplikasi sendiri.
 *
 * Panggil SEBELUM menyentuh database: permintaan lintas origin harus gagal
 * tanpa menimbulkan penulisan apa pun.
 */
export function verifySameOrigin(
  request: SameOriginRequest,
  trustedOrigins: readonly string[] = resolveTrustedOrigins(process.env),
): SameOriginResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true }
  }

  const origin = toOrigin(request.headers.get("origin"))
  if (!origin) {
    return { ok: false, status: 403, error: "Permintaan ditolak: origin tidak dikenali." }
  }

  if (!trustedOrigins.includes(origin)) {
    return { ok: false, status: 403, error: "Permintaan ditolak: origin tidak tepercaya." }
  }

  return { ok: true }
}
