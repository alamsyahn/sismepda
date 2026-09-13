import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  accountNav,
  activeNavGroupId,
  activeNavHref,
  flattenNav,
  isNavGroup,
  mainNav,
  seedActiveGroup,
  visibleNavEntries,
  visibleNavItems,
} from "../lib/nav"

/**
 * Grant lengkap modul inti (setara administrator setelah backfill). Menu kini
 * disaring berdasarkan permission, bukan nama peran, sehingga fixture-nya pun
 * berupa daftar grant.
 */
const ADMIN_GRANTS = [
  "attendance.dashboard.read.all",
  "attendance.reports.read.all",
  "attendance.read.all",
  "attendance.export.all",
  "students.master.read",
  "students.master.export",
  "teachers.accounts.read",
  "teachers.accounts.export",
  "teachers.directory.read",
  "homerooms.read",
  "homerooms.export",
  "school.holidays.export",
  "school.settings.read",
  "bos.read",
  "sarpras.read",
  "euks.content.read",
  "euks.overview.read",
  "euks.monitoring.read",
  "euks.visits.read",
  "euks.profile.update",
  "workbook.supervision.read",
  "reports.whatsapp.read.all",
]

/// Guru kelas: hanya kelas binaan, tanpa data master maupun laporan sekolah.
const GURU_GRANTS = [
  "attendance.dashboard.read.assigned_classes",
  "attendance.reports.read.assigned_classes",
  "attendance.read.assigned_classes",
  "attendance.export.assigned_classes",
  "teachers.directory.read",
]

const admin = { grants: ADMIN_GRANTS }
const guru = { grants: GURU_GRANTS }
const guruSupervisor = {
  grants: [...GURU_GRANTS, "workbook.supervision.read"],
}

/**
 * Menyuntikkan kolom legacy yang SUDAH TIDAK ADA di `NavViewer`.
 *
 * Dipakai khusus untuk membuktikan bahwa flag legacy tidak memberi akses.
 * Cast diperlukan justru karena tipenya sudah dipersempit — itulah buktinya.
 */
const withLegacy = (viewer: { grants: readonly string[] }, legacy: Record<string, unknown>) =>
  ({ ...viewer, ...legacy }) as Parameters<typeof visibleNavEntries>[1]


test("dashboard tetap top-level dan terlihat untuk semua role", () => {
  for (const viewer of [admin, guru]) {
    const entries = visibleNavEntries(mainNav, viewer)
    const first = entries[0]
    assert.ok(first && !isNavGroup(first))
    assert.equal(first.href, "/")
  }
})

test("group tanpa child yang diizinkan tidak dirender", () => {
  const entries = visibleNavEntries(mainNav, guru)
  const ids = entries.filter(isNavGroup).map((group) => group.id)
  assert.ok(!ids.includes("data-master"), "GURU tidak boleh melihat Data Master")

  const kurikulum = entries.filter(isNavGroup).find((group) => group.id === "kurikulum")
  assert.deepEqual(kurikulum?.children.map((child) => child.href), ["/guru/direktori"])
})

test("capability supervisi buku kerja mengikuti guard server", () => {
  const forGuru = visibleNavEntries(mainNav, guru)
  const forSupervisor = visibleNavEntries(mainNav, guruSupervisor)
  const hrefs = (entries: ReturnType<typeof visibleNavEntries>) => flattenNav(entries).map((item) => item.href)

  assert.ok(!hrefs(forGuru).includes("/supervisi-buku-kerja"))
  assert.ok(hrefs(forSupervisor).includes("/supervisi-buku-kerja"))
  assert.ok(hrefs(visibleNavEntries(mainNav, admin)).includes("/supervisi-buku-kerja"))
})

test("data master admin memakai route gabungan siswa & guru", () => {
  const group = visibleNavEntries(mainNav, admin)
    .filter(isNavGroup)
    .find((entry) => entry.id === "data-master")
  assert.deepEqual(group?.children.map((child) => child.href), ["/siswa", "/guru", "/wali-kelas/input"])
})

test("active route memilih href paling spesifik", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.equal(activeNavHref(entries, "/"), "/")
  assert.equal(activeNavHref(entries, "/rekap-kelas"), "/rekap-kelas")
  assert.equal(activeNavHref(entries, "/siswa"), "/siswa")
  assert.equal(activeNavHref(entries, "/siswa/input"), "/siswa")
  assert.equal(activeNavHref(entries, "/guru/direktori"), "/guru/direktori")
  assert.equal(activeNavHref(entries, "/guru/input"), "/guru")
  assert.equal(activeNavHref(entries, "/supervisi-buku-kerja/kelola"), "/supervisi-buku-kerja")
  assert.equal(activeNavHref(entries, "/tidak-ada"), null)
})

test("dashboard tidak aktif di halaman lain", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.notEqual(activeNavHref(entries, "/rekap-siswa"), "/")
})

test("account nav: profil terbuka, pengaturan menerima setiap domain yang dirender", () => {
  assert.deepEqual(accountNav.map((item) => item.href), [
    "/profil",
    "/pengaturan",
    "/pengaturan/pengguna",
    "/pengaturan/akses",
    "/pengaturan/audit",
  ])
  assert.deepEqual(accountNav.find((item) => item.href === "/pengaturan/audit")?.permissions, [
    "rbac.audit.read",
  ])
  // "Profil Saya" sengaja tanpa daftar permission: setiap sesi sah memilikinya.
  // Administrasi RBAC TIDAK boleh ikut kategori ini — bila salah satu kehilangan
  // daftar permission-nya, tautannya akan tampil bagi setiap guru.
  assert.deepEqual(
    accountNav.filter((item) => !item.permissions?.length).map((item) => item.href),
    ["/profil"],
  )
  assert.deepEqual(accountNav.find((item) => item.href === "/pengaturan")?.permissions, [
    "school.settings.read",
    "school.settings.update",
    "school.class_access.manage",
    "school.branding.update",
    "school.holidays.read",
    "school.holidays.create",
    "school.holidays.update",
    "school.holidays.delete",
    "school.holidays.export",
    "database.backup",
    "database.restore",
  ])
})

test("visibleNavItems tetap kompatibel sebagai daftar datar", () => {
  const hrefs = visibleNavItems(admin).map((item) => item.href)
  assert.ok(hrefs.includes("/"))
  assert.ok(hrefs.includes("/pengaturan"))
  assert.equal(new Set(hrefs).size, hrefs.length, "tidak boleh ada href duplikat")
})

test("BOS hanya terlihat dari grant RBAC terkini", () => {
  const hrefs = (viewer: Parameters<typeof visibleNavEntries>[1]) =>
    flattenNav(visibleNavEntries(mainNav, viewer)).map((item) => item.href)

  assert.ok(!hrefs(guru).includes("/bos"), "GURU polos tidak boleh melihat menu BOS")
  assert.ok(hrefs({ grants: [...GURU_GRANTS, "bos.read"] }).includes("/bos"))
  assert.ok(!hrefs(withLegacy({ grants: GURU_GRANTS }, { canViewBos: true })).includes("/bos"))
})

test("BOS adalah menu utama tepat di bawah E-UKS", () => {
  const entries = visibleNavEntries(mainNav, admin)
  const ids = entries.map((entry) => (isNavGroup(entry) ? entry.id : entry.href))
  const bosIndex = ids.indexOf("/bos")

  assert.ok(bosIndex > -1, "BOS harus ada di navigasi utama")
  assert.equal(ids[bosIndex - 1], "e-uks", "BOS tepat di bawah E-UKS")

  const bos = entries[bosIndex]
  assert.ok(!isNavGroup(bos), "BOS bukan group/submenu")
})

test("E-UKS adalah group di antara Kurikulum dan BOS", () => {
  const entries = visibleNavEntries(mainNav, admin)
  const ids = entries.map((entry) => (isNavGroup(entry) ? entry.id : entry.href))
  const euksIndex = ids.indexOf("e-uks")

  assert.ok(euksIndex > -1, "E-UKS harus ada di navigasi utama")
  assert.equal(ids[euksIndex - 1], "kurikulum", "E-UKS tepat di bawah Kurikulum")
  assert.equal(ids[euksIndex + 1], "/bos", "E-UKS tepat di atas BOS")

  const euks = entries[euksIndex]
  assert.ok(isNavGroup(euks), "E-UKS berupa group/submenu")
  assert.deepEqual(euks.children.map((child) => child.href), [
    "/e-uks",
    "/e-uks/pantauan-kesehatan",
    "/e-uks/riwayat-kunjungan",
    "/e-uks/pengaturan",
  ])
})

test("submenu E-UKS mengikuti permission masing-masing", () => {
  const hrefs = (grants: readonly string[]) =>
    flattenNav(visibleNavEntries(mainNav, { grants })).map((item) => item.href)

  assert.ok(!hrefs(GURU_GRANTS).includes("/e-uks"))
  assert.ok(hrefs([...GURU_GRANTS, "euks.content.read"]).includes("/e-uks"))
  assert.ok(hrefs([...GURU_GRANTS, "euks.monitoring.read"]).includes("/e-uks/pantauan-kesehatan"))
  assert.ok(hrefs([...GURU_GRANTS, "euks.visits.read"]).includes("/e-uks/riwayat-kunjungan"))
  assert.ok(!hrefs([...GURU_GRANTS, "euks.visits.create"]).includes("/e-uks/pengaturan"))
})

test("Pengaturan E-UKS tampil dari permission konfigurasi, bukan ADMIN legacy", () => {
  const hrefs = (viewer: Parameters<typeof visibleNavEntries>[1]) =>
    flattenNav(visibleNavEntries(mainNav, viewer)).map((item) => item.href)

  assert.ok(hrefs({ grants: [...GURU_GRANTS, "euks.profile.update"] }).includes("/e-uks/pengaturan"))
  // Nama peran ADMIN legacy tidak memberi akses apa pun.
  assert.ok(!hrefs(withLegacy({ grants: GURU_GRANTS }, { role: "ADMIN" })).includes("/e-uks/pengaturan"))
})

test("active state E-UKS bekerja untuk seluruh route modul", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.equal(activeNavHref(entries, "/e-uks"), "/e-uks")
  assert.equal(activeNavHref(entries, "/e-uks/pantauan-kesehatan"), "/e-uks/pantauan-kesehatan")
  assert.equal(activeNavHref(entries, "/e-uks/riwayat-kunjungan"), "/e-uks/riwayat-kunjungan")
  assert.equal(activeNavHref(entries, "/e-uks/pengaturan"), "/e-uks/pengaturan")
  // Halaman utama dicocokkan persis agar tidak ikut aktif di sub-route.
  assert.notEqual(activeNavHref(entries, "/e-uks/riwayat-kunjungan"), "/e-uks")
})

test("expanded state E-UKS terbuka untuk setiap sub-route", () => {
  const entries = visibleNavEntries(mainNav, admin)
  for (const path of [
    "/e-uks",
    "/e-uks/pantauan-kesehatan",
    "/e-uks/riwayat-kunjungan",
    "/e-uks/pengaturan",
  ]) {
    assert.equal(activeNavGroupId(entries, activeNavHref(entries, path)), "e-uks", path)
  }
})

test("route BOS aktif termasuk sub-halaman akses", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.equal(activeNavHref(entries, "/bos"), "/bos")
  assert.equal(activeNavHref(entries, "/bos/akses"), "/bos")
})

test("Sarpras adalah menu utama tepat di bawah BOS", () => {
  const entries = visibleNavEntries(mainNav, admin)
  const ids = entries.map((entry) => (isNavGroup(entry) ? entry.id : entry.href))
  const sarprasIndex = ids.indexOf("/sarpras")

  assert.ok(sarprasIndex > -1, "Sarpras harus ada di navigasi utama")
  assert.equal(ids[sarprasIndex - 1], "/bos", "Sarpras tepat di bawah BOS")
  assert.equal(ids[sarprasIndex + 1], "komunikasi-data", "Sarpras tepat di atas Komunikasi & Data")

  const sarpras = entries[sarprasIndex]
  assert.ok(!isNavGroup(sarpras), "Sarpras bukan group/submenu")
})

test("Sarpras hanya terlihat dari grant read RBAC terkini", () => {
  const hrefs = (viewer: Parameters<typeof visibleNavEntries>[1]) =>
    flattenNav(visibleNavEntries(mainNav, viewer)).map((item) => item.href)

  assert.ok(!hrefs(guru).includes("/sarpras"), "GURU polos tidak boleh melihat menu Sarpras")
  assert.ok(hrefs({ grants: [...GURU_GRANTS, "sarpras.read"] }).includes("/sarpras"))
  assert.ok(!hrefs(withLegacy({ grants: GURU_GRANTS }, { canEditSarpras: true })).includes("/sarpras"))
})

test("route Sarpras aktif termasuk sub-halaman akses", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.equal(activeNavHref(entries, "/sarpras"), "/sarpras")
  assert.equal(activeNavHref(entries, "/sarpras/akses"), "/sarpras")
})

test("activeNavGroupId menemukan induk dari child yang aktif", () => {
  const entries = visibleNavEntries(mainNav, admin)
  assert.equal(activeNavGroupId(entries, activeNavHref(entries, "/absensi/input")), "absensi")
  assert.equal(activeNavGroupId(entries, activeNavHref(entries, "/rekap-sekolah")), "absensi")
  assert.equal(activeNavGroupId(entries, activeNavHref(entries, "/siswa")), "data-master")
  // Menu top-level tidak punya induk.
  assert.equal(activeNavGroupId(entries, activeNavHref(entries, "/bos")), null)
  assert.equal(activeNavGroupId(entries, null), null)
})

test("group aktif dibuka otomatis saat pertama kali menjadi aktif", () => {
  assert.deepEqual(seedActiveGroup({}, null, "absensi"), { absensi: true })
})

test("group aktif tetap bisa ditutup manual oleh pengguna", () => {
  // Pengguna menutup "absensi" padahal route anaknya sedang aktif.
  const closed = { absensi: false }
  // Render ulang berikutnya (route yang sama) tidak boleh memaksa terbuka.
  assert.deepEqual(seedActiveGroup(closed, "absensi", "absensi"), closed)
})

test("berpindah ke section lain membuka induk baru tanpa mengubah yang lain", () => {
  const state = { absensi: false }
  assert.deepEqual(seedActiveGroup(state, "absensi", "data-master"), {
    absensi: false,
    "data-master": true,
  })
})

test("kembali ke section yang tadinya ditutup akan membukanya lagi", () => {
  // absensi ditutup manual -> pindah ke data-master -> kembali ke absensi.
  const afterClose = seedActiveGroup({ absensi: false }, "absensi", "data-master")
  assert.deepEqual(seedActiveGroup(afterClose, "data-master", "absensi"), {
    absensi: true,
    "data-master": true,
  })
})

test("route tanpa induk tidak mengubah state accordion", () => {
  const state = { absensi: true }
  assert.deepEqual(seedActiveGroup(state, "absensi", null), state)
})
