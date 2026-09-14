/**
 * Fallback legacy diuji melalui ROUTE NYATA, bukan hanya helper.
 *
 * Test unit di `media-storage.test.ts` sudah membuktikan `resolveMedia()`
 * memilih sumber dengan benar. Yang belum terbukti adalah bahwa route penyaji
 * gambar benar-benar memakai jalur itu dan tetap mengembalikan HTTP yang benar
 * ketika berkas penyimpanan hilang.
 *
 * Test ini memanggil handler `GET` asli dari `app/app-logo/route.ts` — route
 * media yang tidak memerlukan sesi — terhadap database lokal.
 *
 * DILEWATI otomatis bila database tidak tersedia, sehingga `npm test` tetap
 * dapat dijalankan di mesin tanpa PostgreSQL. Bila dilewati, test ini tidak
 * memberi jaminan apa pun; jalankan dengan database untuk verifikasi nyata:
 *
 *     npx tsx scripts/with-db.ts local -- tsx --test tests/media-route-fallback.test.ts
 *
 * Tidak pernah menyentuh produksi: hanya memakai DATABASE_URL yang sedang aktif,
 * dan seluruh perubahan datanya dibatalkan di akhir.
 */

import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { mkdir, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const LEGACY_BYTES = Buffer.from("legacy-bytea-logo-payload")
const STORAGE_BYTES = Buffer.from("storage-file-logo-payload-berbeda")

/**
 * Akar penyimpanan dipatok ke direktori sementara SEBELUM modul penyimpanan
 * diimpor, karena akar dibaca saat modul dimuat. Karena itu direktori dibuat
 * secara sinkron di sini, bukan di dalam test body.
 */
const MEDIA_ROOT = mkdtempSync(path.join(tmpdir(), "sismepda-route-media-"))
process.env.MEDIA_STORAGE_ROOT = MEDIA_ROOT

test("route media: fallback legacy dan jalur penyimpanan baru", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL tidak tersedia")
    return
  }

  const { prisma } = await import("@/lib/prisma")
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    t.skip("database tidak dapat dihubungi")
    return
  }

  const { GET } = await import("@/app/app-logo/route")

  const existing = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: {
      appLogoKey: true,
      appLogoData: true,
      appLogoMimeType: true,
      appLogoUpdatedAt: true,
    },
  })

  t.after(async () => {
    // Kembalikan baris ke kondisi semula apa pun hasil test.
    if (existing) {
      await prisma.schoolSetting.update({ where: { id: "default" }, data: existing })
    }
    await rm(MEDIA_ROOT, { recursive: true, force: true })
  })

  if (!existing) {
    t.skip("SchoolSetting 'default' belum ada di database ini")
    return
  }

  const key = "branding/app-logo/00000000-0000-4000-8000-000000000abc.png"
  const absolute = path.join(MEDIA_ROOT, ...key.split("/"))
  await mkdir(path.dirname(absolute), { recursive: true })

  const request = () => new Request("http://localhost:3000/app-logo")

  await t.test("kunci + berkas ada → byte dari PENYIMPANAN", async () => {
    await writeFile(absolute, STORAGE_BYTES)
    await prisma.schoolSetting.update({
      where: { id: "default" },
      data: {
        appLogoKey: key,
        appLogoMimeType: "image/png",
        appLogoData: LEGACY_BYTES,
      },
    })

    const response = await GET(request())
    assert.equal(response.status, 200)
    const body = Buffer.from(await response.arrayBuffer())

    // Pembuktian yang sesungguhnya: byte berasal dari BERKAS, bukan bytea.
    // Kedua payload sengaja dibuat berbeda supaya fallback tidak bisa membuat
    // test ini lolos secara palsu.
    assert.deepEqual(body, STORAGE_BYTES)
    assert.notDeepEqual(body, LEGACY_BYTES)
  })

  await t.test("kunci ada + berkas HILANG + bytea ada → byte dari LEGACY", async () => {
    await rm(absolute, { force: true })

    const response = await GET(request())
    assert.equal(response.status, 200, "berkas hilang tidak boleh menjadi error")
    const body = Buffer.from(await response.arrayBuffer())
    assert.deepEqual(body, LEGACY_BYTES)
  })

  await t.test("kunci ada + berkas hilang + TANPA bytea → perilaku terkendali", async () => {
    await prisma.schoolSetting.update({
      where: { id: "default" },
      data: { appLogoKey: key, appLogoMimeType: "image/png", appLogoData: null },
    })

    const response = await GET(request())
    // Route ini jatuh ke aset default; yang penting ia TIDAK melempar dan tidak
    // mengembalikan 5xx — satu gambar hilang tidak boleh menjatuhkan halaman.
    assert.ok(response.status < 500, `status tidak boleh 5xx, dapat ${response.status}`)
    assert.ok([200, 302, 307, 404].includes(response.status), `status tak terduga: ${response.status}`)
  })

  await t.test("respons tidak membocorkan jalur filesystem server", async () => {
    const response = await GET(request())
    const headers = JSON.stringify([...response.headers.entries()])
    assert.ok(!headers.includes(MEDIA_ROOT), "header tidak boleh memuat jalur penyimpanan")

    const location = response.headers.get("location") ?? ""
    assert.ok(!location.includes(MEDIA_ROOT))
  })

  await t.test("berkas dipulihkan → kembali membaca dari penyimpanan", async () => {
    await writeFile(absolute, STORAGE_BYTES)
    await prisma.schoolSetting.update({
      where: { id: "default" },
      data: { appLogoKey: key, appLogoMimeType: "image/png", appLogoData: LEGACY_BYTES },
    })

    const response = await GET(request())
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), STORAGE_BYTES)

    // Byte legacy tetap utuh di database setelah seluruh rangkaian test.
    const row = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { appLogoData: true },
    })
    assert.ok(row?.appLogoData && row.appLogoData.byteLength > 0, "bytea legacy tidak boleh hilang")
  })

  await t.test("penyimpanan tidak menulis di luar akarnya", async () => {
    const entries = await readdir(MEDIA_ROOT)
    assert.deepEqual(entries, ["branding"])
  })
})
