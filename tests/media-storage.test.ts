/**
 * Penyimpanan media kanonik: kunci, backend filesystem, dan fallback legacy.
 *
 * Seluruh test memakai direktori sementara lewat MEDIA_STORAGE_ROOT. Tidak ada
 * satu pun yang menulis ke `.media/` project, ke direktori pengguna, apalagi ke
 * penyimpanan produksi.
 */

import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { after, before, describe } from "node:test"

import {
  assertValidMediaKey,
  generateMediaKey,
  isValidMediaKey,
  mediaCategoryOf,
  MediaKeyError,
  MEDIA_CATEGORIES,
  MEDIA_SCOPES,
  extensionForMimeType,
} from "@/lib/media-keys"
import {
  FilesystemMediaStorage,
  MediaStorageError,
  mediaStorage,
  mediaStorageRoot,
  storeMedia,
} from "@/lib/server-media-storage"
import { resolveMedia } from "@/lib/server-media"

let root = ""
const originalRoot = process.env.MEDIA_STORAGE_ROOT

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sismepda-media-"))
  process.env.MEDIA_STORAGE_ROOT = root
})

after(async () => {
  if (originalRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT
  else process.env.MEDIA_STORAGE_ROOT = originalRoot
  if (root) await rm(root, { recursive: true, force: true })
})

const bytesOf = (text: string) => new Uint8Array(Buffer.from(text, "utf8"))

describe("kunci media", () => {
  test("kunci yang dihasilkan selalu acak, berada di scope-nya, dan valid", () => {
    const first = generateMediaKey("euks/hero", "image/webp")
    const second = generateMediaKey("euks/hero", "image/webp")
    assert.notEqual(first, second, "kunci harus unik per unggahan")
    assert.match(first, /^euks\/hero\/[0-9a-f-]{36}\.webp$/)
    assert.ok(isValidMediaKey(first))
  })

  test("ekstensi berasal dari MIME hasil deteksi, bukan nama berkas", () => {
    assert.equal(extensionForMimeType("image/jpeg"), "jpg")
    assert.equal(extensionForMimeType("image/svg+xml"), "svg")
    // MIME tak dikenal tetap menghasilkan kunci valid, bukan lemparan.
    assert.equal(extensionForMimeType("application/x-unknown"), "bin")
    assert.ok(isValidMediaKey(generateMediaKey("users/avatar", "application/x-unknown")))
  })

  test("setiap scope terdaftar memetakan ke kategori yang dikenal", () => {
    for (const [name, scope] of Object.entries(MEDIA_SCOPES)) {
      assert.ok(
        MEDIA_CATEGORIES.includes(scope.category),
        `scope ${name} memakai kategori tak terdaftar`,
      )
      assert.ok(scope.prefix.startsWith(`${scope.category}/`))
    }
  })

  test("kunci berbahaya ditolak", () => {
    const rejected = [
      "../secret.txt",
      "users/../../etc/passwd",
      "users/avatar/../../../etc/passwd",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "users\\avatar\\a.jpg",
      "users/avatar/a.jpg\u0000.png",
      "unknown/avatar/a.jpg",
      "avatar.jpg",
      "",
      "users/avatar/a",
      `users/avatar/${"a".repeat(300)}.jpg`,
      null,
      undefined,
      42,
    ]
    for (const key of rejected) {
      assert.equal(isValidMediaKey(key), false, `seharusnya ditolak: ${String(key)}`)
      assert.throws(() => assertValidMediaKey(key), MediaKeyError)
    }
  })

  test("pesan penolakan tidak membocorkan nilai yang ditolak", () => {
    try {
      assertValidMediaKey("../../etc/shadow")
      assert.fail("seharusnya melempar")
    } catch (error) {
      assert.ok(error instanceof MediaKeyError)
      assert.equal(error.message.includes("etc/shadow"), false)
    }
  })

  test("kategori dapat dibaca kembali dari kunci", () => {
    assert.equal(mediaCategoryOf("sarpras/item/abc.jpg"), "sarpras")
    assert.equal(mediaCategoryOf("tidakada/x.jpg"), null)
  })
})

describe("backend filesystem", () => {
  test("put lalu get mengembalikan byte yang sama", async () => {
    const key = generateMediaKey("users/avatar", "image/png")
    await mediaStorage().put(key, bytesOf("halo"))
    const read = await mediaStorage().get(key)
    assert.deepEqual(read, bytesOf("halo"))
  })

  test("jalur bersarang per kategori dibuat otomatis", async () => {
    const key = generateMediaKey("euks/officer", "image/jpeg")
    await mediaStorage().put(key, bytesOf("x"))
    assert.ok(existsSync(path.join(root, ...key.split("/"))))
  })

  test("berkas yang tidak ada mengembalikan null, bukan lemparan", async () => {
    const missing = "users/avatar/00000000-0000-4000-8000-000000000000.jpg"
    assert.equal(await mediaStorage().get(missing), null)
    assert.equal(await mediaStorage().size(missing), null)
    assert.equal(await mediaStorage().exists(missing), false)
  })

  test("delete idempoten dan tidak melempar untuk berkas yang sudah hilang", async () => {
    const key = generateMediaKey("users/avatar", "image/png")
    await mediaStorage().put(key, bytesOf("x"))
    await mediaStorage().delete(key)
    await mediaStorage().delete(key)
    assert.equal(await mediaStorage().exists(key), false)
  })

  test("kunci path traversal ditolak sebelum menyentuh filesystem", async () => {
    const storage = mediaStorage()
    await assert.rejects(() => storage.get("../../etc/passwd"), MediaKeyError)
    await assert.rejects(() => storage.put("../escape.txt", bytesOf("x")), MediaKeyError)
    await assert.rejects(() => storage.delete("users/../../escape.txt"), MediaKeyError)
  })

  test("tidak ada berkas yang tertulis di luar akar penyimpanan", async () => {
    const outside = path.join(root, "..", "bocor.txt")
    await assert.rejects(
      () => mediaStorage().put("../bocor.txt", bytesOf("x")),
      MediaKeyError,
    )
    assert.equal(existsSync(outside), false)
  })

  test("akar penyimpanan mengikuti MEDIA_STORAGE_ROOT", () => {
    assert.equal(mediaStorageRoot(), path.resolve(root))
  })

  test("penulisan bersifat atomik: tidak ada berkas .tmp yang tertinggal", async () => {
    const key = generateMediaKey("branding/app-logo", "image/png")
    await mediaStorage().put(key, bytesOf("konten"))
    const directory = path.join(root, "branding", "app-logo")
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(directory)
    assert.equal(
      entries.some((entry) => entry.endsWith(".tmp")),
      false,
    )
  })

  test("storeMedia mengembalikan kunci, MIME, dan ukuran yang benar", async () => {
    const payload = bytesOf("gambar-palsu")
    const stored = await storeMedia("sarpras/item", payload, "image/jpeg")
    assert.equal(stored.size, payload.byteLength)
    assert.equal(stored.mimeType, "image/jpeg")
    assert.deepEqual(await mediaStorage().get(stored.key), payload)
  })

  test("penulisan yang gagal melempar MediaStorageError, bukan error mentah", async () => {
    // Akar diarahkan ke sebuah BERKAS, sehingga mkdir di dalamnya pasti gagal.
    const filePath = path.join(root, "bukan-direktori")
    await writeFile(filePath, "x")
    const broken = new FilesystemMediaStorage(filePath)
    await assert.rejects(
      () => broken.put("users/avatar/a.jpg", bytesOf("x")),
      MediaStorageError,
    )
  })
})

describe("kompatibilitas baca legacy", () => {
  test("kunci baru dibaca dari penyimpanan", async () => {
    const stored = await storeMedia("users/avatar", bytesOf("baru"), "image/png")
    const media = await resolveMedia({ key: stored.key, mimeType: stored.mimeType })
    assert.equal(media?.source, "storage")
    assert.deepEqual(media?.bytes, bytesOf("baru"))
    assert.equal(media?.mimeType, "image/png")
  })

  test("record yang hanya punya bytea legacy tetap terbaca", async () => {
    const media = await resolveMedia({
      key: null,
      mimeType: "image/jpeg",
      legacyBytes: bytesOf("lama"),
    })
    assert.equal(media?.source, "legacy")
    assert.deepEqual(media?.bytes, bytesOf("lama"))
  })

  test("tanpa kunci dan tanpa bytea mengembalikan null (perilaku gambar kosong)", async () => {
    assert.equal(await resolveMedia({ key: null, mimeType: null, legacyBytes: null }), null)
    assert.equal(await resolveMedia({}), null)
  })

  test("kunci menang atas bytea ketika keduanya ada", async () => {
    const stored = await storeMedia("users/avatar", bytesOf("versi-baru"), "image/png")
    const media = await resolveMedia({
      key: stored.key,
      mimeType: stored.mimeType,
      legacyBytes: bytesOf("versi-lama"),
    })
    assert.equal(media?.source, "storage")
    assert.deepEqual(media?.bytes, bytesOf("versi-baru"))
  })

  test("berkas hilang tetapi bytea masih ada → jatuh ke legacy, bukan error", async () => {
    const media = await resolveMedia({
      key: "users/avatar/00000000-0000-4000-8000-000000000001.jpg",
      mimeType: "image/jpeg",
      legacyBytes: bytesOf("cadangan"),
    })
    assert.equal(media?.source, "legacy")
  })

  test("kunci rusak tidak pernah membaca berkas sembarang di server", async () => {
    // Ada berkas nyata di luar akar; kunci jahat tidak boleh menjangkaunya.
    const secret = path.join(root, "..", `rahasia-${process.pid}.txt`)
    await writeFile(secret, "RAHASIA")
    try {
      const media = await resolveMedia({
        key: `../rahasia-${process.pid}.txt`,
        mimeType: "text/plain",
        legacyBytes: null,
      })
      assert.equal(media, null)
      assert.equal(await readFile(secret, "utf8"), "RAHASIA")
    } finally {
      await rm(secret, { force: true })
    }
  })

  test("kunci rusak dengan bytea tersedia tetap menyajikan legacy", async () => {
    const media = await resolveMedia({
      key: "../../etc/passwd",
      mimeType: "image/png",
      legacyBytes: bytesOf("aman"),
    })
    assert.equal(media?.source, "legacy")
    assert.deepEqual(media?.bytes, bytesOf("aman"))
  })

  test("bytea kosong diperlakukan sebagai tidak ada gambar", async () => {
    const media = await resolveMedia({
      key: null,
      mimeType: "image/png",
      legacyBytes: new Uint8Array(0),
    })
    assert.equal(media, null)
  })
})

describe("kontrak script migrasi", () => {
  test("script migrasi tidak pernah menulis null ke kolom bytes legacy", async () => {
    const source = await readFile(path.join(process.cwd(), "scripts", "migrate-media.ts"), "utf8")
    for (const column of [
      "photoData",
      "logoData",
      "appLogoData",
      "faviconData",
    ]) {
      assert.equal(
        source.includes(`${column}: null`),
        false,
        `script migrasi tidak boleh mengosongkan ${column}`,
      )
    }
    assert.equal(source.includes("data: null"), false)
    assert.equal(source.includes("deleteMany"), false)
    assert.equal(source.includes("$executeRaw"), false)
  })

  test("migrasi Prisma untuk media bersifat aditif", async () => {
    const raw = await readFile(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260914160000_add_media_storage_keys",
        "migration.sql",
      ),
      "utf8",
    )
    // Komentar dibuang lebih dulu: berkas ini MENJELASKAN bahwa tidak ada DROP
    // COLUMN, sehingga memindai teks mentah akan menuduh dokumentasinya sendiri.
    const sql = raw
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
    assert.equal(/DROP\s+COLUMN/i.test(sql), false, "migrasi tidak boleh menghapus kolom")
    assert.equal(/DROP\s+TABLE/i.test(sql), false, "migrasi tidak boleh menghapus tabel")
    assert.equal(/\bUPDATE\b/i.test(sql), false, "migrasi tidak boleh menulis ulang data")
    assert.equal(/\bDELETE\b/i.test(sql), false)
    assert.ok(/ADD COLUMN/i.test(sql))
    // Satu-satunya pelonggaran yang diizinkan pada fase ini.
    assert.ok(/ALTER COLUMN "data" DROP NOT NULL/i.test(sql))
  })

  test("setiap model bermedia legacy punya sumber migrasi", async () => {
    const source = await readFile(path.join(process.cwd(), "scripts", "migrate-media.ts"), "utf8")
    for (const label of [
      "User.photo",
      "EuksHeroImage.photo",
      "EuksHeroLogo.logo",
      "EuksOfficer.photo",
      "EuksFacility.photo",
      "SchoolSetting.appLogo",
      "SchoolSetting.favicon",
      "SarprasPhoto.data",
    ]) {
      assert.ok(source.includes(label), `sumber migrasi ${label} hilang`)
    }
  })

  test("schema Prisma masih memuat seluruh kolom biner legacy", async () => {
    const schema = await readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8")
    for (const column of [
      "photoData Bytes?",
      "logoData Bytes?",
      "faviconData Bytes?",
      "appLogoData Bytes?",
    ]) {
      assert.ok(schema.includes(column), `kolom legacy ${column} tidak boleh dihapus`)
    }
  })
})

describe("idempotensi dan pemulihan migrasi", () => {
  test("menulis ulang kunci yang sama menghasilkan isi terbaru, bukan berkas ganda", async () => {
    const key = generateMediaKey("euks/facility", "image/png")
    await mediaStorage().put(key, bytesOf("v1"))
    await mediaStorage().put(key, bytesOf("v2"))
    assert.deepEqual(await mediaStorage().get(key), bytesOf("v2"))
  })

  test("media bertahan melewati instance penyimpanan baru (simulasi restart)", async () => {
    const stored = await storeMedia("euks/hero", bytesOf("bertahan"), "image/webp")
    // Instance baru pada akar yang sama = proses/container baru pada volume sama.
    const restarted = new FilesystemMediaStorage(root)
    assert.deepEqual(await restarted.get(stored.key), bytesOf("bertahan"))
  })

  test("direktori kategori boleh sudah ada sebelumnya", async () => {
    await mkdir(path.join(root, "students", "photo"), { recursive: true })
    const stored = await storeMedia("students/photo", bytesOf("x"), "image/jpeg")
    assert.ok(stored.key.startsWith("students/photo/"))
  })
})
