/**
 * Smoke test HTTP untuk CRUD + foto Pengurus & Fasilitas UKS.
 *
 * Menjalankan seluruh skenario penerimaan terhadap dev server yang hidup,
 * memakai akun uji lokal (ADMIN). Setiap entri yang dibuat script ini juga
 * dihapus lagi di akhir, sehingga data E-UKS yang sudah ada tidak bertambah.
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
}

async function main() {
  const email = process.env.DEV_TEST_USER_EMAIL!
  const password = process.env.DEV_TEST_USER_PASSWORD!
  const admin = new Session()
  if (!(await admin.login(email, password))) throw new Error("Login akun uji lokal gagal")
  console.log("Login admin uji: OK")

  const teacher = await prisma.user.findFirst({
    where: { role: "GURU", active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, photoUpdatedAt: true },
  })
  if (!teacher) throw new Error("Butuh satu akun GURU aktif")

  const createdOfficers: string[] = []
  const createdFacilities: string[] = []

  /* ================= PENGURUS ================= */
  console.log("\n== PENGURUS UKS ==")

  // 1. Tambah tanpa foto.
  const plain = await admin.json("/api/e-uks/officers", "POST", {
    userId: null,
    name: "Uji Pengurus Tanpa Foto",
    role: "Anggota Uji",
  })
  check("1. tambah pengurus tanpa foto", plain.status === 201, `status ${plain.status}`)
  const plainId = String(plain.data.id ?? "")
  if (plainId) createdOfficers.push(plainId)

  // 9. Entri tanpa foto = kondisi baris lama sebelum fitur foto ada.
  const plainRow = await prisma.euksOfficer.findUnique({
    where: { id: plainId },
    select: { photoData: true, photoUpdatedAt: true },
  })
  check(
    "9. pengurus lama tanpa foto tetap valid (kolom NULL)",
    plainRow?.photoData === null && plainRow?.photoUpdatedAt === null,
  )
  const noPhoto = await admin.fetch(`/api/e-uks/officers/${plainId}/photo`)
  check("9b. GET foto yang belum ada -> 404, bukan error server", noPhoto.status === 404, `status ${noPhoto.status}`)

  // 2. Tambah dengan foto (entri dibuat dulu, lalu foto diunggah).
  const withPhoto = await admin.json("/api/e-uks/officers", "POST", {
    userId: teacher.id,
    name: teacher.name,
    role: "Pembina Uji",
  })
  check("2a. tambah pengurus tertaut guru", withPhoto.status === 201, `status ${withPhoto.status}`)
  const photoId = String(withPhoto.data.id ?? "")
  if (photoId) createdOfficers.push(photoId)

  const up = await admin.upload(`/api/e-uks/officers/${photoId}/photo`, PNG, "a.png", "image/png")
  check("2b. unggah foto pengurus", up.status === 200 && typeof up.data.photoUrl === "string", `status ${up.status}`)

  const served = await admin.fetch(`/api/e-uks/officers/${photoId}/photo`)
  check(
    "2c. foto tersaji dengan MIME hasil deteksi magic bytes",
    served.status === 200 && served.headers.get("content-type") === "image/png",
    `${served.status} ${served.headers.get("content-type")}`,
  )

  // Foto pengurus TIDAK boleh menyentuh foto akun guru.
  const teacherAfter = await prisma.user.findUnique({
    where: { id: teacher.id },
    select: { name: true, photoUpdatedAt: true },
  })
  check(
    "2d. akun guru tidak ikut berubah saat foto pengurus diunggah",
    teacherAfter?.name === teacher.name &&
      String(teacherAfter?.photoUpdatedAt) === String(teacher.photoUpdatedAt),
  )

  // 3. Edit nama/jabatan.
  const edited = await admin.json("/api/e-uks/officers", "PATCH", {
    id: plainId,
    name: "Uji Pengurus Diubah",
    role: "Sekretaris Uji",
  })
  check(
    "3. edit nama & jabatan",
    edited.status === 200 && edited.data.name === "Uji Pengurus Diubah" && edited.data.role === "Sekretaris Uji",
    `status ${edited.status}`,
  )

  // 4. Ganti foto: byte dan penanda waktu harus berubah.
  const before = await prisma.euksOfficer.findUnique({
    where: { id: photoId },
    select: { photoMimeType: true, photoUpdatedAt: true },
  })
  await new Promise((r) => setTimeout(r, 5))
  const replaced = await admin.upload(`/api/e-uks/officers/${photoId}/photo`, JPEG, "b.jpg", "image/jpeg")
  const after = await prisma.euksOfficer.findUnique({
    where: { id: photoId },
    select: { photoMimeType: true, photoUpdatedAt: true },
  })
  check(
    "4. ganti foto menimpa byte lama (tidak ada orphan) & cache-buster berubah",
    replaced.status === 200 &&
      before?.photoMimeType === "image/png" &&
      after?.photoMimeType === "image/jpeg" &&
      Number(after?.photoUpdatedAt) !== Number(before?.photoUpdatedAt),
  )

  // 5. Hapus foto saja -> kembali placeholder, entri tetap ada.
  const cleared = await admin.fetch(`/api/e-uks/officers/${photoId}/photo`, { method: "DELETE" })
  const clearedRow = await prisma.euksOfficer.findUnique({
    where: { id: photoId },
    select: { id: true, photoData: true, photoMimeType: true, photoUpdatedAt: true },
  })
  check(
    "5. hapus foto saja -> kolom NULL, entri pengurus tetap ada",
    cleared.status === 200 &&
      clearedRow !== null &&
      clearedRow.photoData === null &&
      clearedRow.photoMimeType === null &&
      clearedRow.photoUpdatedAt === null,
  )

  // Validasi file: format tidak didukung ditolak.
  const badFormat = await admin.upload(
    `/api/e-uks/officers/${photoId}/photo`,
    Buffer.from("bukan gambar sama sekali"),
    "x.png",
    "image/png",
  )
  check("5b. file non-gambar ditolak 415 walau content-type mengaku PNG", badFormat.status === 415, `status ${badFormat.status}`)

  // 7. Reorder.
  const firstBefore = await prisma.euksOfficer.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  })
  const lastId = firstBefore[firstBefore.length - 1]!.id
  const moved = await admin.json("/api/e-uks/officers", "PATCH", { id: lastId, move: "up" })
  const orderAfter = await prisma.euksOfficer.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  })
  check(
    "7. reorder naik menukar posisi dengan tetangga",
    moved.status === 200 &&
      firstBefore.length > 1 &&
      orderAfter[orderAfter.length - 2]!.id === lastId,
  )
  await admin.json("/api/e-uks/officers", "PATCH", { id: lastId, move: "down" })

  // 8. Toggle aktif/nonaktif — data harus tetap ada.
  const off = await admin.json("/api/e-uks/officers", "PATCH", { id: plainId, active: false })
  const offRow = await prisma.euksOfficer.findUnique({ where: { id: plainId }, select: { active: true } })
  const on = await admin.json("/api/e-uks/officers", "PATCH", { id: plainId, active: true })
  check(
    "8. toggle nonaktif menyimpan data (bukan hapus) lalu bisa diaktifkan lagi",
    off.status === 200 && offRow?.active === false && on.status === 200,
  )

  // 6. Delete pengurus — akun guru tidak boleh ikut terhapus.
  const del = await admin.json("/api/e-uks/officers", "DELETE", { id: photoId })
  const gone = await prisma.euksOfficer.findUnique({ where: { id: photoId } })
  const teacherStill = await prisma.user.findUnique({ where: { id: teacher.id }, select: { id: true } })
  check(
    "6. delete menghapus entri pengurus saja, akun guru utuh",
    del.status === 200 && gone === null && teacherStill !== null,
  )
  createdOfficers.splice(createdOfficers.indexOf(photoId), 1)

  /* ================= FASILITAS ================= */
  console.log("\n== FASILITAS UKS ==")

  // 10. Tambah tanpa foto.
  const facPlain = await admin.json("/api/e-uks/facilities", "POST", {
    name: "Uji Fasilitas Tanpa Foto",
    quantity: 2,
    note: "catatan uji",
  })
  check("10. tambah fasilitas tanpa foto", facPlain.status === 201, `status ${facPlain.status}`)
  const facPlainId = String(facPlain.data.id ?? "")
  if (facPlainId) createdFacilities.push(facPlainId)

  // 11. Tambah lalu unggah foto.
  const facPhoto = await admin.json("/api/e-uks/facilities", "POST", {
    name: "Uji Fasilitas Berfoto",
    quantity: null,
    note: "",
  })
  const facPhotoId = String(facPhoto.data.id ?? "")
  if (facPhotoId) createdFacilities.push(facPhotoId)
  const facUp = await admin.upload(`/api/e-uks/facilities/${facPhotoId}/photo`, PNG, "f.png", "image/png")
  const facServed = await admin.fetch(`/api/e-uks/facilities/${facPhotoId}/photo`)
  check(
    "11. tambah fasilitas + unggah foto lalu tersaji",
    facPhoto.status === 201 && facUp.status === 200 && facServed.status === 200,
    `create ${facPhoto.status} upload ${facUp.status} get ${facServed.status}`,
  )

  // 12. Edit fasilitas — tidak boleh membuat duplikat.
  const countBefore = await prisma.euksFacility.count()
  const facEdit = await admin.json("/api/e-uks/facilities", "PATCH", {
    id: facPlainId,
    name: "Uji Fasilitas Diubah",
    quantity: 7,
    note: "catatan baru",
  })
  const countAfter = await prisma.euksFacility.count()
  check(
    "12. edit fasilitas mengubah baris yang sama (tanpa duplikat)",
    facEdit.status === 200 &&
      facEdit.data.name === "Uji Fasilitas Diubah" &&
      facEdit.data.quantity === 7 &&
      countBefore === countAfter,
    `status ${facEdit.status}`,
  )

  // 13. Ganti foto fasilitas.
  const facBefore = await prisma.euksFacility.findUnique({
    where: { id: facPhotoId },
    select: { photoMimeType: true },
  })
  const facReplaced = await admin.upload(`/api/e-uks/facilities/${facPhotoId}/photo`, JPEG, "f.jpg", "image/jpeg")
  const facAfter = await prisma.euksFacility.findUnique({
    where: { id: facPhotoId },
    select: { photoMimeType: true },
  })
  check(
    "13. ganti foto fasilitas menimpa byte lama",
    facReplaced.status === 200 &&
      facBefore?.photoMimeType === "image/png" &&
      facAfter?.photoMimeType === "image/jpeg",
  )

  // 15. Toggle fasilitas.
  const facOff = await admin.json("/api/e-uks/facilities", "PATCH", { id: facPlainId, active: false })
  const facOffRow = await prisma.euksFacility.findUnique({
    where: { id: facPlainId },
    select: { active: true },
  })
  await admin.json("/api/e-uks/facilities", "PATCH", { id: facPlainId, active: true })
  check(
    "15. toggle fasilitas menyimpan data, tidak menghapus",
    facOff.status === 200 && facOffRow?.active === false,
  )

  // 14. Delete fasilitas, foto ikut hilang bersama barisnya.
  const facDel = await admin.json("/api/e-uks/facilities", "DELETE", { id: facPhotoId })
  const facGone = await prisma.euksFacility.findUnique({ where: { id: facPhotoId } })
  check("14. delete fasilitas menghapus entri beserta fotonya", facDel.status === 200 && facGone === null)
  createdFacilities.splice(createdFacilities.indexOf(facPhotoId), 1)

  /* ============ REGRESI HALAMAN E-UKS ============ */
  console.log("\n== REGRESI HALAMAN ==")
  for (const path of ["/e-uks", "/e-uks/pengaturan", "/e-uks/riwayat-kunjungan", "/e-uks/pantauan-kesehatan"]) {
    const page = await admin.fetch(path)
    check(`halaman ${path} tetap merender`, page.status === 200, `status ${page.status}`)
  }

  /* ============ BERSIH-BERSIH ============ */
  for (const id of createdOfficers) await prisma.euksOfficer.deleteMany({ where: { id } })
  for (const id of createdFacilities) await prisma.euksFacility.deleteMany({ where: { id } })
  console.log(`\nEntri uji dibersihkan: ${createdOfficers.length} pengurus, ${createdFacilities.length} fasilitas`)

  console.log(failures === 0 ? "\nSEMUA SKENARIO LULUS" : `\n${failures} SKENARIO GAGAL`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("Smoke test gagal:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
