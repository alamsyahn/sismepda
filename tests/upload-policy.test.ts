import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  DEFAULT_GLOBAL_LIMITS,
  MAX_CONFIGURABLE_UPLOAD_BYTES,
  MIN_CONFIGURABLE_UPLOAD_BYTES,
  UploadPolicyError,
  assertUploadAllowed,
  isValidLimitBytes,
  resolveUploadPolicy,
} from "../lib/upload-policy"
import {
  UPLOAD_CATEGORIES,
  UPLOAD_SLOTS,
  configurableUploadSlots,
  findUploadSlot,
  formatBytes,
  mbToBytes,
} from "../lib/upload-slots"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

// --- Registry -------------------------------------------------------------

test("kunci slot unik", () => {
  const keys = UPLOAD_SLOTS.map((slot) => slot.key)
  assert.equal(new Set(keys).size, keys.length, "kunci slot ganda membuat override admin saling menimpa")
})

test("metadata setiap slot lengkap dan kategorinya dikenal", () => {
  for (const slot of UPLOAD_SLOTS) {
    assert.match(slot.key, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, `kunci tidak sesuai konvensi: ${slot.key}`)
    assert.ok(slot.label.trim().length > 0, `label kosong: ${slot.key}`)
    assert.ok(slot.module.trim().length > 0, `module kosong: ${slot.key}`)
    assert.ok(UPLOAD_CATEGORIES.includes(slot.category), `kategori asing: ${slot.key}`)
    if (slot.defaultMaxBytes !== undefined) {
      assert.ok(
        Number.isSafeInteger(slot.defaultMaxBytes) && slot.defaultMaxBytes > 0,
        `defaultMaxBytes tidak wajar: ${slot.key}`,
      )
    }
  }
})

test("slot non-configurable dinyatakan eksplisit, bukan diam-diam hilang dari UI", () => {
  const hidden = UPLOAD_SLOTS.filter((slot) => slot.configurable === false)
  const configurable = configurableUploadSlots()
  assert.equal(configurable.length + hidden.length, UPLOAD_SLOTS.length)
  for (const slot of hidden) {
    assert.ok(slot.description && slot.description.length > 0, `slot tersembunyi wajib beralasan: ${slot.key}`)
  }
})

// --- Resolver -------------------------------------------------------------

test("slot tanpa override memakai batas bawaannya", () => {
  const policy = resolveUploadPolicy("profile.user.photo", {})
  assert.equal(policy.maxBytes, findUploadSlot("profile.user.photo")?.defaultMaxBytes)
  assert.equal(policy.source, "slot_default")
})

test("override slot mengalahkan default global maupun bawaan slot", () => {
  const policy = resolveUploadPolicy("profile.user.photo", {
    globalLimits: { image: mbToBytes(7) },
    slotOverrides: { "profile.user.photo": mbToBytes(3) },
  })
  assert.equal(policy.maxBytes, mbToBytes(3))
  assert.equal(policy.source, "override")
})

test("slot tanpa batas bawaan jatuh ke default kategori", () => {
  // Slot sintetis tidak dipakai di sini: yang diuji adalah perilaku fallback
  // pada slot terdaftar yang memang tidak mendeklarasikan defaultMaxBytes.
  const slot = UPLOAD_SLOTS.find((entry) => entry.defaultMaxBytes === undefined)
  if (!slot) return
  const policy = resolveUploadPolicy(slot.key, {})
  assert.equal(policy.maxBytes, DEFAULT_GLOBAL_LIMITS[slot.category])
})

test("default global admin dipakai saat slot tak punya bawaan sendiri", () => {
  const slot = UPLOAD_SLOTS.find((entry) => entry.defaultMaxBytes === undefined)
  if (!slot) return
  const policy = resolveUploadPolicy(slot.key, { globalLimits: { [slot.category]: mbToBytes(9) } })
  assert.equal(policy.maxBytes, mbToBytes(9))
})

test("slot tidak dikenal gagal tertutup, bukan tanpa batas", () => {
  assert.throws(
    () => resolveUploadPolicy("modul.tidak.terdaftar", {}),
    (error: unknown) => error instanceof UploadPolicyError && error.code === "UPLOAD_SLOT_UNKNOWN",
  )
})

test("konfigurasi rusak diabaikan, bukan melonggarkan batas", () => {
  for (const broken of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, MAX_CONFIGURABLE_UPLOAD_BYTES + 1, 1.5]) {
    const policy = resolveUploadPolicy("profile.user.photo", {
      slotOverrides: { "profile.user.photo": broken },
    })
    assert.equal(
      policy.maxBytes,
      findUploadSlot("profile.user.photo")?.defaultMaxBytes,
      `nilai rusak ${broken} seharusnya tidak dipakai`,
    )
  }
})

test("batas konfigurasi punya lantai dan plafon", () => {
  assert.equal(isValidLimitBytes(MIN_CONFIGURABLE_UPLOAD_BYTES), true)
  assert.equal(isValidLimitBytes(MAX_CONFIGURABLE_UPLOAD_BYTES), true)
  assert.equal(isValidLimitBytes(MIN_CONFIGURABLE_UPLOAD_BYTES - 1), false)
  assert.equal(isValidLimitBytes(MAX_CONFIGURABLE_UPLOAD_BYTES + 1), false)
  assert.equal(isValidLimitBytes(-5), false)
  assert.equal(isValidLimitBytes(Number.NaN), false)
  assert.equal(isValidLimitBytes(2.5), false)
})

// --- Validasi unggah ------------------------------------------------------

const SLOT = "profile.user.photo"
const imagePolicy = resolveUploadPolicy(SLOT, {})

test("berkas tepat pada batas diterima", () => {
  assert.doesNotThrow(() =>
    assertUploadAllowed(SLOT, { size: imagePolicy.maxBytes, detectedMimeType: "image/png" }),
  )
})

test("berkas di bawah batas diterima", () => {
  assert.doesNotThrow(() =>
    assertUploadAllowed(SLOT, { size: imagePolicy.maxBytes - 1, detectedMimeType: "image/jpeg" }),
  )
})

test("berkas melewati batas ditolak dengan 413 dan menyebut angkanya", () => {
  assert.throws(
    () => assertUploadAllowed(SLOT, { size: imagePolicy.maxBytes + 1, fileName: "foto.jpg" }),
    (error: unknown) => {
      assert.ok(error instanceof UploadPolicyError)
      assert.equal(error.code, "FILE_TOO_LARGE")
      assert.equal(error.status, 413)
      assert.match(error.message, /foto\.jpg/)
      assert.match(error.message, new RegExp(formatBytes(imagePolicy.maxBytes).replace(".", "\\.")))
      return true
    },
  )
})

test("tipe di luar daftar ditolak dengan 415", () => {
  assert.throws(
    () => assertUploadAllowed(SLOT, { size: 10, detectedMimeType: "application/zip" }),
    (error: unknown) =>
      error instanceof UploadPolicyError &&
      error.code === "FILE_TYPE_NOT_ALLOWED" &&
      error.status === 415,
  )
})

test("tipe tak terdeteksi ditolak, bukan dianggap boleh", () => {
  assert.throws(
    () => assertUploadAllowed(SLOT, { size: 10, detectedMimeType: null }),
    (error: unknown) => error instanceof UploadPolicyError && error.status === 415,
  )
})

test("kategori dokumen memakai default globalnya sendiri", () => {
  const doc = resolveUploadPolicy("students.import.csv", {})
  const image = resolveUploadPolicy("profile.user.photo", {})
  assert.equal(doc.slot.category, "document")
  assert.equal(image.slot.category, "image")
  assert.notEqual(DEFAULT_GLOBAL_LIMITS.document, DEFAULT_GLOBAL_LIMITS.image)
})

// --- Grandfathering & replacement ----------------------------------------

test("menurunkan batas tidak menyentuh berkas yang sudah tersimpan", () => {
  // Berkas lama 8 MB, kebijakan baru 5 MB. Grandfathering diwujudkan sebagai
  // ketiadaan jalur revalidasi: satu-satunya gerbang ukuran dipanggil saat
  // menerima unggahan, dan tidak ada pemindaian atas data tersimpan.
  const server = read("lib/server-upload-policy.ts")
  // Pembacaan yang diizinkan hanyalah tabel konfigurasi itu sendiri; tidak
  // boleh ada kueri ke tabel yang menyimpan berkas, dan tidak boleh ada tulis
  // massal apa pun.
  assert.ok(
    !/updateMany|deleteMany/.test(server),
    "modul kebijakan tidak boleh mengubah data tersimpan secara massal",
  )
  // Dua tabel konfigurasi ini saja: default global pada SchoolSetting dan
  // override per slot. Tabel mana pun yang menyimpan berkas berarti ada jalur
  // pemindaian atas unggahan lama.
  const CONFIG_MODELS = new Set(["schoolSetting", "uploadPolicyOverride"])
  for (const match of server.matchAll(/prisma\.([A-Za-z]+)\./g)) {
    assert.ok(
      CONFIG_MODELS.has(match[1]),
      `modul kebijakan hanya boleh menyentuh tabel konfigurasi, bukan ${match[1]}`,
    )
  }
  const policyModule = read("lib/upload-policy.ts")
  assert.ok(
    !/revalidat|migrat|rescan/i.test(policyModule),
    "tidak boleh ada jalur revalidasi massal atas unggahan lama",
  )
})

test("penggantian berkas dinilai dengan kebijakan terbaru", () => {
  const tightenedConfig = { slotOverrides: { "euks.hero.image": mbToBytes(5) } }
  // Ukuran yang dulu sah (8 MB) kini ditolak saat dikirim ulang sebagai
  // pengganti — persis perilaku yang diminta.
  assert.throws(
    () =>
      assertUploadAllowed(
        "euks.hero.image",
        { size: mbToBytes(8), detectedMimeType: "image/jpeg" },
        tightenedConfig,
      ),
    (error: unknown) => error instanceof UploadPolicyError && error.code === "FILE_TOO_LARGE",
  )
  assert.doesNotThrow(() =>
    assertUploadAllowed(
      "euks.hero.image",
      { size: mbToBytes(4), detectedMimeType: "image/jpeg" },
      tightenedConfig,
    ),
  )
})

// --- Integrasi jalur unggah nyata ----------------------------------------

const UPLOAD_ROUTES = [
  "app/api/profile/photo/route.ts",
  "app/app-logo/route.ts",
  "app/favicon.ico/route.ts",
  "app/api/teachers/[teacherId]/photo/route.ts",
  "app/api/e-uks/officers/[officerId]/photo/route.ts",
  "app/api/e-uks/facilities/[facilityId]/photo/route.ts",
  "app/api/e-uks/hero-images/[imageId]/photo/route.ts",
  "app/api/e-uks/hero-logos/[logoId]/logo/route.ts",
  "app/api/sarpras/photos/route.ts",
  "app/api/admin/database/route.ts",
]

test("setiap route unggah menegakkan kebijakan pusat di server", () => {
  for (const path of UPLOAD_ROUTES) {
    const source = read(path)
    assert.match(
      source,
      /from "@\/lib\/server-upload-policy"/,
      `${path} tidak memakai penegakan terpusat`,
    )
    assert.match(
      source,
      /assertRequestSizeWithinSlot\(/,
      `${path} harus menolak payload kebesaran sebelum mem-parse formData`,
    )
  }
})

test("tidak ada lagi batas ukuran unggah yang ditulis langsung di route atau komponen", () => {
  // Penjaga sengaja sempit: hanya menangkap konstanta batas bergaya lama yang
  // dulu tersebar, sehingga tidak memicu alarm palsu pada aritmetika ukuran
  // untuk keperluan tampilan.
  for (const path of UPLOAD_ROUTES) {
    const source = read(path)
    assert.ok(
      !/const\s+MAX_[A-Z_]*(SIZE|BYTES)\s*=/.test(source),
      `${path} kembali mendefinisikan batas sendiri; daftarkan slot di lib/upload-slots.ts`,
    )
  }
})

test("slot yang dirujuk route benar-benar terdaftar", () => {
  for (const path of UPLOAD_ROUTES) {
    const source = read(path)
    for (const match of source.matchAll(/assert(?:RequestSizeWithinSlot|UploadAllowedForSlot)\(\s*"([^"]+)"/g)) {
      assert.ok(findUploadSlot(match[1]), `${path} memakai slot tak terdaftar: ${match[1]}`)
    }
  }
})

// --- Administrasi ---------------------------------------------------------

test("endpoint administrasi dijaga permission, bukan pemeriksaan peran ad hoc", () => {
  const source = read("app/api/admin/upload-policy/route.ts")
  assert.match(source, /requirePermission\("school\.upload_policy\.read"\)/)
  assert.match(source, /requirePermission\("school\.upload_policy\.update"\)/)
  assert.ok(!/role\s*===\s*"ADMIN"/.test(source), "jangan memeriksa peran langsung; pakai registry permission")
  assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(source), "jangan menanam email sebagai penanda admin")
})

test("otorisasi mendahului parsing payload pada PUT", () => {
  const source = read("app/api/admin/upload-policy/route.ts")
  const put = source.slice(source.indexOf("export async function PUT"))
  const guard = put.search(/requirePermission\(/)
  const parse = put.search(/\.parse\(|await request\.json\(\)/)
  assert.ok(guard !== -1 && parse !== -1)
  assert.ok(guard < parse, "penolakan harus 403, bukan 400 validasi")
})

test("UI administrasi menemukan slot dari registry, bukan daftar tersendiri", () => {
  const ui = read("components/settings/upload-policy-settings.tsx")
  assert.ok(
    !/UPLOAD_SLOTS\s*=|const\s+slots\s*=\s*\[/.test(ui),
    "UI tidak boleh punya daftar slot sendiri",
  )
  assert.match(ui, /data\.slots/, "UI harus merender slot kiriman endpoint registry")
  const route = read("app/api/admin/upload-policy/route.ts")
  assert.match(route, /configurableUploadSlots\(\)/, "endpoint harus menyusun daftar dari registry")
})

test("nilai konfigurasi kiriman klien tidak dipercaya apa adanya", () => {
  const route = read("app/api/admin/upload-policy/route.ts")
  assert.match(route, /isValidLimitBytes|MIN_CONFIGURABLE_UPLOAD_BYTES|MAX_CONFIGURABLE_UPLOAD_BYTES/)
  assert.match(route, /isUploadSlotKey|findUploadSlot/, "kunci slot kiriman klien wajib divalidasi ke registry")
})
