/**
 * Metadata kebijakan rute untuk prefilter `authorized()` di `auth.ts`.
 *
 * CLIENT-SAFE: tidak mengimpor Prisma maupun sesi.
 *
 * Prefilter ini adalah GERBANG AUTENTIKASI KASAR, bukan otoritas otorisasi.
 * Keputusan yang mengikat selalu diambil ulang di server dari database.
 * Modul ini hanya menjawab satu pertanyaan: sebuah path boleh dilihat publik,
 * atau wajib login?
 *
 * FAIL CLOSED: path yang tidak dikenal diperlakukan sebagai permukaan
 * terlindungi (wajib login). Menambah halaman baru tidak pernah secara tidak
 * sengaja membuatnya publik — yang publik harus didaftarkan eksplisit di sini.
 */

export type RoutePolicy = "public" | "authenticated"

/// Permukaan yang memang harus terbaca tanpa login.
/// Setiap entri butuh alasan; tanpa alasan, jangan ditambahkan.
const PUBLIC_ROUTES: readonly { path: string; method?: string; reason: string }[] = [
  {
    path: "/login",
    reason: "halaman masuk itu sendiri",
  },
  {
    path: "/app-logo",
    method: "GET",
    reason:
      "logo dipakai halaman login yang belum terautentikasi; PUT/DELETE tetap dijaga guard server",
  },
]

/**
 * Kebijakan untuk sebuah path.
 *
 * Pencocokan sengaja dibuat persis (bukan prefix) supaya sebuah entri publik
 * tidak pernah tanpa sengaja mempublikasikan seluruh subtree di bawahnya.
 */
export function routePolicy(path: string, method = "GET"): RoutePolicy {
  for (const route of PUBLIC_ROUTES) {
    if (route.path !== path) continue
    if (route.method && route.method !== method) continue
    return "public"
  }
  return "authenticated"
}

export function isPublicRoute(path: string, method = "GET"): boolean {
  return routePolicy(path, method) === "public"
}

/**
 * Modul inti (absensi, rekap, siswa, guru, wali kelas, buku kerja) TIDAK lagi
 * memiliki tapis otorisasi di lapisan ini.
 *
 * Sebelumnya ada daftar rute yang ditapis berdasarkan `User.role` di dalam JWT.
 * Daftar itu dihapus pada Phase 4: setiap halaman tersebut kini memanggil
 * `requirePermission()` di server, sehingga otoritasnya adalah database saat
 * ini. Menapis ulang di sini memakai klaim token akan membuat pencabutan/
 * pemberian hak baru berlaku hanya setelah pengguna keluar-masuk.
 */
