import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { z } from "zod"

import { euksErrorResponse } from "../lib/euks-access"
import { MediaStorageError } from "../lib/server-media-storage"
import { UploadPolicyError } from "../lib/upload-policy"
import { MEDIA_SCOPES } from "../lib/media-keys"

/**
 * Regresi bug "Data E-UKS tidak valid" pada penambahan logo hero.
 *
 * Dua kegagalan berbeda sebelumnya menyatu menjadi satu pesan yang salah:
 * penyimpanan media yang gagal (EACCES di volume produksi) dilaporkan ke
 * pengguna seolah-olah nama/berkas yang diisi cacat. Test ini mengunci
 * pemisahan kelas error itu, dan mengunci kepemilikan direktori media yang
 * menjadi akar penyebabnya.
 */

const zodError = () => {
  try {
    z.object({ name: z.string().trim().min(1) }).parse({ name: "" })
    throw new Error("skema seharusnya menolak")
  } catch (error) {
    return error
  }
}

test("payload cacat menjadi 400, bukan 500", () => {
  const result = euksErrorResponse(zodError())
  assert.equal(result.status, 400)
  assert.equal(result.error, "Data E-UKS tidak valid")
})

test("kegagalan penyimpanan media tidak dilaporkan sebagai data tidak valid", () => {
  const result = euksErrorResponse(new MediaStorageError("Media gagal ditulis ke penyimpanan"))
  assert.equal(result.status, 500)
  assert.equal(result.error, "Gagal menyimpan berkas. Silakan coba lagi.")
  assert.notEqual(result.error, "Data E-UKS tidak valid")
})

test("kegagalan tak terduga tidak lagi menuduh data pengguna", () => {
  const result = euksErrorResponse(new Error("connect ECONNREFUSED"))
  assert.equal(result.status, 500)
  assert.equal(result.error, "Terjadi kesalahan pada server. Silakan coba lagi.")
})

test("respons error tidak pernah membawa stack, path, atau detail koneksi", () => {
  const hostile = new MediaStorageError("Media gagal ditulis ke penyimpanan", {
    cause: Object.assign(new Error("EACCES: permission denied, mkdir '/app/media/euks/hero-logo'"), {
      code: "EACCES",
    }),
  })
  const result = euksErrorResponse(hostile)
  for (const bocor of ["/app/media", "EACCES", "at ", "postgres", "prisma"]) {
    assert.ok(!result.error.includes(bocor), `pesan membocorkan "${bocor}": ${result.error}`)
  }
})

test("pelanggaran kebijakan unggah tetap membawa status dan pesannya sendiri", () => {
  // Penolakan berkas kebesaran/tidak didukung harus tetap informatif; perbaikan
  // error handler tidak boleh ikut menelan pesan-pesan ini.
  const tooLarge = euksErrorResponse(
    new UploadPolicyError("FILE_TOO_LARGE", "Berkas terlalu besar", 413),
  )
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.error, "Berkas terlalu besar")

  const unsupported = euksErrorResponse(
    new UploadPolicyError("FILE_TYPE_NOT_ALLOWED", "Format berkas tidak didukung", 415),
  )
  assert.equal(unsupported.status, 415)
  assert.equal(unsupported.error, "Format berkas tidak didukung")
})

test("image menyiapkan setiap scope media milik pengguna runtime", () => {
  // Akar penyebab bug: sub-direktori scope dibuat lazy saat runtime, sehingga
  // penulis pertama (migrator root) memilikinya dan aplikasi uid 1001 tidak
  // bisa lagi menulis unggahan baru ke sana.
  const dockerfile = readFileSync("Dockerfile", "utf8")
  for (const scope of Object.values(MEDIA_SCOPES)) {
    assert.ok(
      dockerfile.includes(`/app/media/${scope.prefix}`),
      `Dockerfile belum menyiapkan direktori scope ${scope.prefix}`,
    )
  }
  assert.ok(
    /chown -R nextjs:nodejs \/app\/media/.test(dockerfile),
    "Dockerfile harus men-chown seluruh pohon media ke pengguna runtime",
  )
})

test("migrator media berjalan sebagai pengguna runtime, bukan root", () => {
  const overlay = readFileSync("compose.media.yaml", "utf8")
  const migrateBlock = overlay.slice(overlay.indexOf("\n  migrate:"))
  assert.ok(
    /user:\s*"1001:1001"/.test(migrateBlock),
    "service migrate harus memakai user 1001:1001 agar tidak membuat direktori milik root",
  )
})
