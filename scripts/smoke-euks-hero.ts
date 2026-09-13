/**
 * Smoke test HTTP untuk foto hero E-UKS dan render Halaman Utama.
 *
 * Menguji CRUD foto hero (tambah, ganti foto, urutkan, toggle, hapus) plus
 * bukti bahwa Halaman Utama benar-benar merender hero, pengurus, dan fasilitas
 * — termasuk saat belum ada foto hero sama sekali.
 *
 * Semua entri yang dibuat script ini dihapus lagi di akhir, sehingga data
 * E-UKS yang sudah ada tidak bertambah.
 *
 * Guard: menolak jalan bila schema bukan sismepda_local.
 */
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const BASE = "http://localhost:3000"
const cs = process.env.DATABASE_URL ?? ""
const schema = databaseSchema(cs)
if (schema !== "sismepda_local") {
  console.error(`Menolak jalan: butuh schema "sismepda_local", dapat "${schema}".`)
  process.exit(1)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs }, { schema }) })

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

/** PNG 1x1 valid — cukup untuk menguji deteksi magic bytes dan penyimpanan. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)
/** JPEG 1x1 valid — dipakai untuk membuktikan "ganti foto" benar-benar berganti. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
)

class Session {
  private cookies = new Map<string, string>()
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";")
      const index = pair.indexOf("=")
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }
  async fetch(path: string, init: RequestInit = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: this.header() },
    })
    this.absorb(response)
    return response
  }
  async login(identifier: string, password: string) {
    const { csrfToken } = await (await this.fetch("/api/auth/csrf")).json()
    await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ identifier, password, csrfToken, callbackUrl: BASE }).toString(),
    })
    const session = await (await this.fetch("/api/auth/session")).json()
    return Boolean(session?.user?.id)
  }
  async json(path: string, method: string, payload: unknown) {
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    let data: Record<string, unknown> = {}
    try {
      data = await response.json()
    } catch {
      /* body bukan JSON */
    }
    return { status: response.status, data }
  }
  async upload(path: string, bytes: Buffer, filename: string, type: string) {
    const form = new FormData()
    form.set("photo", new Blob([new Uint8Array(bytes)], { type }), filename)
    const response = await this.fetch(path, { method: "PUT", body: form })
    let data: Record<string, unknown> = {}
    try {
      data = await response.json()
    } catch {
      /* body bukan JSON */
    }
    return { status: response.status, data }
  }
  async text(path: string) {
    const response = await this.fetch(path)
    return { status: response.status, body: await response.text() }
  }
}

async function main() {
  const email = process.env.DEV_TEST_USER_EMAIL!
  const password = process.env.DEV_TEST_USER_PASSWORD!
  const admin = new Session()
  if (!(await admin.login(email, password))) throw new Error("Login akun uji lokal gagal")
  console.log("Login admin uji: OK")

  const created: string[] = []

  /* ===== HALAMAN UTAMA TANPA FOTO HERO ===== */
  console.log("\n== HERO TANPA FOTO ==")

  const preexisting = await prisma.euksHeroImage.count()
  const home0 = await admin.text("/e-uks")
  check("1. Halaman Utama merender tanpa foto hero", home0.status === 200, `status ${home0.status}`)
  check(
    "2. hero menampilkan eyebrow identitas, bukan PageHeading dashboard",
    home0.body.includes("Unit Kesehatan Sekolah"),
  )
  if (preexisting === 0) {
    // Latar bawaan dipakai: tidak ada elemen <img> hero sama sekali.
    check(
      "3. tanpa foto hero, tidak ada img hero yang dirender",
      !home0.body.includes("/api/e-uks/hero-images/"),
    )
  } else {
    console.log(`SKIP  3. sudah ada ${preexisting} entri hero sebelumnya`)
  }

  /* ===== CRUD FOTO HERO ===== */
  console.log("\n== CRUD FOTO HERO ==")

  // 4. Tambah entri pertama.
  const first = await admin.json("/api/e-uks/hero-images", "POST", { caption: "Uji Hero Satu" })
  check("4. tambah entri hero", first.status === 201, `status ${first.status}`)
  const firstId = String(first.data.id ?? "")
  if (firstId) created.push(firstId)

  // 5. Entri baru belum punya foto; halaman harus melewatinya, bukan
  //    merender slide kosong.
  const homeNoBytes = await admin.text("/e-uks")
  check(
    "5. entri hero tanpa byte foto dilewati halaman",
    homeNoBytes.status === 200 && !homeNoBytes.body.includes(`/api/e-uks/hero-images/${firstId}`),
  )

  // 6. Unggah foto.
  const up1 = await admin.upload(`/api/e-uks/hero-images/${firstId}/photo`, PNG, "hero.png", "image/png")
  const row1 = await prisma.euksHeroImage.findUnique({
    where: { id: firstId },
    select: { photoMimeType: true, photoUpdatedAt: true },
  })
  check(
    "6. unggah foto hero tersimpan sebagai PNG",
    up1.status === 200 && row1?.photoMimeType === "image/png" && row1?.photoUpdatedAt !== null,
  )

  // 7. Sekarang slide-nya harus muncul di halaman.
  const homeWith = await admin.text("/e-uks")
  check(
    "7. slide hero muncul di Halaman Utama setelah foto ada",
    homeWith.body.includes(`/api/e-uks/hero-images/${firstId}`),
  )

  // 8. Byte foto bisa diambil dan cache-nya immutable.
  const bytes = await admin.fetch(`/api/e-uks/hero-images/${firstId}/photo`)
  check(
    "8. GET foto hero mengembalikan byte dengan cache immutable",
    bytes.status === 200 &&
      bytes.headers.get("content-type") === "image/png" &&
      (bytes.headers.get("cache-control") ?? "").includes("immutable"),
  )

  // 9. Ganti foto: PNG -> JPEG.
  const up2 = await admin.upload(`/api/e-uks/hero-images/${firstId}/photo`, JPEG, "hero.jpg", "image/jpeg")
  const row2 = await prisma.euksHeroImage.findUnique({
    where: { id: firstId },
    select: { photoMimeType: true },
  })
  check(
    "9. ganti foto hero benar-benar mengganti byte",
    up2.status === 200 && row2?.photoMimeType === "image/jpeg",
  )

  // 10. Tolak berkas yang bukan gambar, dinilai dari magic bytes.
  const bogus = await admin.upload(
    `/api/e-uks/hero-images/${firstId}/photo`,
    Buffer.from("ini teks biasa, bukan gambar"),
    "hero.png",
    "image/png",
  )
  check("10. berkas non-gambar ditolak 415", bogus.status === 415, `status ${bogus.status}`)

  /* ===== URUTAN SLIDE ===== */
  console.log("\n== URUTAN SLIDE ==")

  const second = await admin.json("/api/e-uks/hero-images", "POST", { caption: "Uji Hero Dua" })
  const secondId = String(second.data.id ?? "")
  if (secondId) created.push(secondId)
  await admin.upload(`/api/e-uks/hero-images/${secondId}/photo`, PNG, "hero2.png", "image/png")

  const orderBefore = await prisma.euksHeroImage.findMany({
    where: { id: { in: [firstId, secondId] } },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  })
  check(
    "11. entri baru masuk di urutan belakang",
    orderBefore.at(0)?.id === firstId && orderBefore.at(-1)?.id === secondId,
  )

  // 12. Naikkan entri kedua; urutannya harus bertukar.
  const moved = await admin.json("/api/e-uks/hero-images", "PATCH", { id: secondId, move: "up" })
  const orderAfter = await prisma.euksHeroImage.findMany({
    where: { id: { in: [firstId, secondId] } },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  })
  check(
    "12. move up menukar urutan slide",
    moved.status === 200 && orderAfter.at(0)?.id === secondId && orderAfter.at(-1)?.id === firstId,
  )

  // 13. Urutan di halaman mengikuti sortOrder, bukan urutan pembuatan.
  const homeOrdered = await admin.text("/e-uks")
  const posSecond = homeOrdered.body.indexOf(`/api/e-uks/hero-images/${secondId}`)
  const posFirst = homeOrdered.body.indexOf(`/api/e-uks/hero-images/${firstId}`)
  check(
    "13. Halaman Utama merender slide sesuai urutan tersimpan",
    posSecond >= 0 && posFirst >= 0 && posSecond < posFirst,
    `posisi ${posSecond} vs ${posFirst}`,
  )

  // 14. Batas atas jumlah slide tidak diberlakukan (sesuai permintaan).
  const third = await admin.json("/api/e-uks/hero-images", "POST", { caption: "Uji Hero Tiga" })
  check("14. tidak ada batas maksimum jumlah foto hero", third.status === 201)
  if (third.data.id) created.push(String(third.data.id))

  /* ===== TOGGLE & HAPUS ===== */
  console.log("\n== TOGGLE & HAPUS ==")

  // 15. Nonaktif mengeluarkan slide dari carousel tanpa menghapus byte-nya.
  const off = await admin.json("/api/e-uks/hero-images", "PATCH", { id: secondId, active: false })
  const offRow = await prisma.euksHeroImage.findUnique({
    where: { id: secondId },
    select: { active: true, photoData: true },
  })
  const homeOff = await admin.text("/e-uks")
  check(
    "15. nonaktif menyembunyikan slide tapi byte foto tetap tersimpan",
    off.status === 200 &&
      offRow?.active === false &&
      offRow?.photoData !== null &&
      !homeOff.body.includes(`/api/e-uks/hero-images/${secondId}`),
  )
  await admin.json("/api/e-uks/hero-images", "PATCH", { id: secondId, active: true })

  // 16. Hapus foto saja: entri tetap ada, byte-nya hilang.
  const photoGone = await admin.fetch(`/api/e-uks/hero-images/${secondId}/photo`, { method: "DELETE" })
  const stillThere = await prisma.euksHeroImage.findUnique({
    where: { id: secondId },
    select: { photoData: true, photoUpdatedAt: true },
  })
  check(
    "16. hapus foto menyisakan entri dengan kolom foto NULL",
    photoGone.status === 200 &&
      stillThere !== null &&
      stillThere.photoData === null &&
      stillThere.photoUpdatedAt === null,
  )

  // 17. Hapus entri sepenuhnya.
  const del = await admin.json("/api/e-uks/hero-images", "DELETE", { id: secondId })
  const gone = await prisma.euksHeroImage.findUnique({ where: { id: secondId } })
  check("17. delete menghapus entri hero beserta fotonya", del.status === 200 && gone === null)
  created.splice(created.indexOf(secondId), 1)

  /* ===== SEKSI PENGURUS & FASILITAS DI HALAMAN ===== */
  console.log("\n== SEKSI HALAMAN UTAMA ==")

  const home = await admin.text("/e-uks")
  check("18. seksi Pengurus UKS dirender", home.body.includes("Pengurus UKS"))
  check("19. seksi Fasilitas UKS dirender", home.body.includes("Fasilitas UKS"))
  check("20. seksi statistik dirender setelah profil", home.body.includes("Ringkasan Kunjungan"))

  // Statistik harus berada SETELAH pengurus dan fasilitas dalam urutan DOM.
  const posOfficers = home.body.indexOf("Pengurus UKS")
  const posFacilities = home.body.indexOf("Fasilitas UKS")
  const posStats = home.body.indexOf("Ringkasan Kunjungan")
  check(
    "21. hierarki halaman: pengurus → fasilitas → statistik",
    posOfficers < posFacilities && posFacilities < posStats,
    `${posOfficers} / ${posFacilities} / ${posStats}`,
  )

  // Seksi kosong tetap tampil dengan ajakan ke pengaturan, bukan hilang.
  const activeOfficers = await prisma.euksOfficer.count({ where: { active: true } })
  if (activeOfficers === 0) {
    check(
      "22. seksi pengurus kosong menampilkan empty state",
      home.body.includes("Belum ada pengurus UKS"),
    )
  } else {
    console.log(`SKIP  22. sudah ada ${activeOfficers} pengurus aktif`)
  }

  /* ===== REGRESI HALAMAN LAIN ===== */
  console.log("\n== REGRESI HALAMAN ==")
  for (const path of [
    "/e-uks/pengaturan",
    "/e-uks/riwayat-kunjungan",
    "/e-uks/pantauan-kesehatan",
  ]) {
    const page = await admin.fetch(path)
    check(`halaman ${path} tetap merender`, page.status === 200, `status ${page.status}`)
  }

  /* ===== BERSIH-BERSIH ===== */
  for (const id of created) await prisma.euksHeroImage.deleteMany({ where: { id } })
  const remaining = await prisma.euksHeroImage.count()
  console.log(`\nEntri uji dibersihkan: ${created.length} foto hero`)
  check("23. jumlah entri hero kembali seperti sebelum uji", remaining === preexisting)

  console.log(failures === 0 ? "\nSEMUA SKENARIO LULUS" : `\n${failures} SKENARIO GAGAL`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("Smoke test gagal:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
