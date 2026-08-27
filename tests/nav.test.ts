import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  accountNav,
  activeNavHref,
  flattenNav,
  isNavGroup,
  mainNav,
  visibleNavEntries,
  visibleNavItems,
} from "../lib/nav"

const admin = { role: "ADMIN" as const }
const guru = { role: "GURU" as const }
const guruSupervisor = { role: "GURU" as const, canViewWorkbookSupervision: true }

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

test("account nav memakai permission yang sama", () => {
  assert.deepEqual(
    accountNav.filter((item) => item.roles.includes("GURU")).map((item) => item.href),
    ["/profil"],
  )
  assert.deepEqual(accountNav.map((item) => item.href), ["/profil", "/pengaturan"])
})

test("visibleNavItems tetap kompatibel sebagai daftar datar", () => {
  const hrefs = visibleNavItems(admin).map((item) => item.href)
  assert.ok(hrefs.includes("/"))
  assert.ok(hrefs.includes("/pengaturan"))
  assert.equal(new Set(hrefs).size, hrefs.length, "tidak boleh ada href duplikat")
})
