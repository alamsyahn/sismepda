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
 * Permukaan yang masih dijaga prefilter berbasis `User.role` di dalam JWT.
 *
 * PENINGGALAN LEGACY, bukan model target. Daftar ini tetap ada selama Phase 2
 * karena halaman-halaman tersebut BELUM memiliki guard server sendiri:
 * menghapusnya sekarang akan membuka rute terlindungi, sedangkan
 * menggantinya dengan guard RBAC akan mengunci semua orang selama `UserRole`
 * belum di-backfill (Phase 3).
 *
 * Daftar ini dihapus pada Phase 4, ketika tiap halaman memanggil
 * `requirePermission()` dengan key spesifik dan database menjadi satu-satunya
 * otoritas. Sampai saat itu, ia hanya boleh MEMPERSEMPIT akses, tidak pernah
 * memperluas: keputusan akhir tetap di server.
 */
export const LEGACY_ADMIN_PREFILTER_ROUTES: readonly string[] = [
  "/siswa/input",
  "/siswa/kelola",
  "/guru/input",
  "/guru/kelola",
  "/wali-kelas/input",
  "/pengaturan",
  "/supervisi-buku-kerja/kelola",
]

/// Halaman gabungan yang dicocokkan persis, agar profil siswa/guru
/// (`/siswa/<id>`, `/guru/<id>`, `/guru/direktori`) tetap terbuka untuk guru.
export const LEGACY_ADMIN_PREFILTER_EXACT_ROUTES: readonly string[] = ["/siswa", "/guru"]

export function isLegacyAdminPrefilterRoute(path: string): boolean {
  if (LEGACY_ADMIN_PREFILTER_EXACT_ROUTES.includes(path)) return true
  return LEGACY_ADMIN_PREFILTER_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  )
}
