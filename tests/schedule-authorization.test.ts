import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { PERMISSIONS } from "../lib/rbac-permissions"
import { ROLE_TEMPLATES } from "../lib/rbac-templates"
import {
  SCHEDULE_PAGE_PERMISSIONS,
  SCHEDULE_ROUTE_PERMISSIONS,
  SCHEDULE_TAB_LABELS,
  scheduleCapabilitiesFromGrants,
  visibleScheduleTabs,
} from "../lib/schedule-authorization"

const scheduleKeys = new Set(PERMISSIONS.filter((row) => row.module === "schedule").map((row) => row.key))

function capabilities(...grants: string[]) {
  return scheduleCapabilitiesFromGrants(new Set(grants))
}

test("setiap permission yang dijaga route benar-benar ada di katalog", () => {
  for (const [group, methods] of Object.entries(SCHEDULE_ROUTE_PERMISSIONS)) {
    for (const [method, key] of Object.entries(methods)) {
      assert.ok(scheduleKeys.has(key), `${group}.${method} memakai key tak dikenal: ${key}`)
    }
  }
})

test("permission pembuka halaman semuanya ada di katalog", () => {
  for (const key of SCHEDULE_PAGE_PERMISSIONS) {
    assert.ok(scheduleKeys.has(key), `key pembuka halaman tak dikenal: ${key}`)
  }
})

test("melihat jadwal sendiri tidak memberi hak melihat jadwal guru lain", () => {
  const view = capabilities("schedule.own.read")
  assert.equal(view.ownRead, true)
  assert.equal(view.teacherRead, false)
  assert.equal(view.manage, false)
  assert.equal(view.import, false)
  assert.equal(view.timeManage, false)
  assert.equal(view.rollback, false)
})

test("hak menambah jadwal tidak memberi hak mengubah, menghapus, atau mengimpor", () => {
  const cap = capabilities("schedule.classes.read", "schedule.entries.create")
  assert.equal(cap.entries.create, true)
  assert.equal(cap.entries.update, false)
  assert.equal(cap.entries.delete, false)
  assert.equal(cap.import, false)
})

test("hak membaca revisi tidak memberi hak rollback", () => {
  const cap = capabilities("schedule.revisions.read")
  assert.equal(cap.revisionsRead, true)
  assert.equal(cap.rollback, false)
})

test("tab yang tampil mengikuti permission, bukan nama role", () => {
  assert.deepEqual(visibleScheduleTabs(capabilities("schedule.own.read")), ["saya"])

  assert.deepEqual(
    visibleScheduleTabs(capabilities("schedule.own.read", "schedule.classes.read", "schedule.free_teachers.read")),
    ["saya", "kelas", "jam-kosong"],
  )

  assert.deepEqual(
    visibleScheduleTabs(
      capabilities(
        "schedule.own.read",
        "schedule.classes.read",
        "schedule.free_teachers.read",
        "schedule.entries.update",
        "schedule.time.manage",
      ),
    ),
    ["saya", "kelas", "jam-kosong", "kelola", "waktu"],
  )
})

test("pemakai non-guru yang boleh melihat jadwal guru lain tetap mendapat tab Jadwal Saya", () => {
  // Tanpa ini, kepala sekolah/TU tidak punya tempat untuk mencari jadwal guru.
  assert.deepEqual(visibleScheduleTabs(capabilities("schedule.teachers.read")), ["saya"])
})

test("tanpa permission Jadwal sama sekali, tidak ada tab yang tampil", () => {
  assert.deepEqual(visibleScheduleTabs(capabilities()), [])
  assert.deepEqual(visibleScheduleTabs(capabilities("attendance.read.assigned_classes")), [])
})

test("nama tab sesuai yang diminta, khususnya 'Jam Kosong Guru'", () => {
  assert.equal(SCHEDULE_TAB_LABELS["jam-kosong"], "Jam Kosong Guru")
  assert.notEqual(SCHEDULE_TAB_LABELS["jam-kosong"], "Guru Tersedia")
})

test("role bawaan guru hanya memperoleh permission MELIHAT jadwal", () => {
  const guru = ROLE_TEMPLATES.find((row) => row.key === "guru")
  assert.ok(guru)

  const jadwal = guru.permissionKeys.filter((key) => key.startsWith("schedule."))
  assert.deepEqual(jadwal.sort(), [
    "schedule.classes.read",
    "schedule.free_teachers.read",
    "schedule.own.read",
  ])

  for (const forbidden of [
    "schedule.teachers.read",
    "schedule.entries.create",
    "schedule.entries.update",
    "schedule.entries.delete",
    "schedule.time.manage",
    "schedule.import",
    "schedule.revisions.rollback",
  ]) {
    assert.ok(!guru.permissionKeys.includes(forbidden), `role guru tidak boleh memuat ${forbidden}`)
  }
})

test("modul Jadwal tidak menyentuh role legacy_guru", () => {
  // Migrasi legacy_guru → guru dikerjakan admin secara manual dan berada di
  // luar modul ini; template apa pun yang menambahkan permission Jadwal ke
  // legacy_guru akan mendahului keputusan itu.
  const legacy = ROLE_TEMPLATES.find((row) => row.key === "legacy_guru")
  assert.equal(legacy, undefined)
})

test("populasi guru ditentukan role key `guru`, bukan nama tampilan role", () => {
  const source = readFileSync(new URL("../lib/server-schedule.ts", import.meta.url), "utf8")

  assert.match(source, /TEACHER_ROLE_KEY = "guru"/)
  assert.match(source, /role: \{ key: TEACHER_ROLE_KEY \}/)

  // Tidak ada pencocokan berdasarkan nama tampilan role, yang boleh berubah
  // dan boleh berduplikat.
  assert.ok(!/role:\s*\{\s*name:/.test(source), "populasi guru tidak boleh dicocokkan dari nama role")
  // Disebut di komentar penjelas boleh; dipakai sebagai string literal tidak.
  assert.ok(
    !/["']legacy_guru["']/.test(source),
    "modul Jadwal tidak boleh memakai legacy_guru sebagai nilai",
  )
})

test("populasi guru mensyaratkan tautan Data Master Guru dan akun aktif", () => {
  const source = readFileSync(new URL("../lib/server-schedule.ts", import.meta.url), "utf8")

  // teacherPopulationWhere() adalah jalur existing User ↔ Data Master Guru;
  // modul ini tidak membuat coupling berbasis string sendiri.
  assert.match(source, /teacherPopulationWhere\(\)/)
  assert.match(source, /active: true/)
})

test("daftar guru tidak pernah diambil dari entitas teacher di XML", () => {
  const source = readFileSync(new URL("../lib/server-schedule-import.ts", import.meta.url), "utf8")
  // Guru dari XML hanya menjadi baris pemetaan; tidak ada pembuatan User/guru.
  assert.ok(!/prisma\.user\.create/.test(source))
  assert.ok(!/user\.upsert/.test(source))
})

test("komponen klien modul Jadwal tidak mengimpor value dari modul server-only", () => {
  // Impor VALUE dari lib/server-*.ts akan menyeret Prisma ke bundel peramban
  // dan memecah `next build`; impor TIPE aman.
  const files = [
    "../components/jadwal/schedule-view.tsx",
    "../components/jadwal/my-schedule-tab.tsx",
    "../components/jadwal/class-schedule-tab.tsx",
    "../components/jadwal/free-teachers-tab.tsx",
    "../components/jadwal/manage-schedule-tab.tsx",
    "../components/jadwal/time-structure-tab.tsx",
    "../components/jadwal/import-panel.tsx",
    "../components/jadwal/schedule-entry-dialog.tsx",
    "../components/jadwal/schedule-week-grid.tsx",
  ]

  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8")
    // Impor dapat membentang beberapa baris, sehingga pemeriksaan dilakukan
    // atas pernyataan impor utuh, bukan per baris.
    for (const statement of source.match(/import[\s\S]*?from\s+"[^"]+"/g) ?? []) {
      if (!/from\s+"@\/lib\/server-/.test(statement)) continue
      assert.match(
        statement.trim(),
        /^import\s+type\b/,
        `${relative} mengimpor value dari modul server-only: ${statement.replace(/\s+/g, " ")}`,
      )
    }
  }
})

test("dropdown yang kehabisan pilihan tidak boleh diam: ada penjelasan dan trigger dinonaktifkan", () => {
  const importPanel = readFileSync(new URL("../components/jadwal/import-panel.tsx", import.meta.url), "utf8")

  // Populasi guru boleh kosong selama migrasi legacy_guru belum dijalankan admin.
  // Yang tidak boleh: pemilih membuka daftar kosong tanpa memberi tahu sebabnya.
  // Pola dicocokkan atas MAKSUDNYA (dinonaktifkan saat daftar kosong), bukan atas
  // teks persis, agar kondisi tambahan seperti "sedang menyimpan" tetap boleh ada.
  assert.match(
    importPanel,
    /disabled=\{options\.length === 0(\s*\|\|[^}]*)?\}/,
    "pemilih pemetaan harus dinonaktifkan saat tidak ada pilihan",
  )
  assert.match(
    importPanel,
    /options\.length === 0 \?/,
    "tabel pemetaan harus merender penjelasan saat daftar master kosong",
  )
  assert.match(importPanel, /emptyOptionsHint/, "setiap tabel pemetaan wajib memberi keterangan spesifik")

  const mySchedule = readFileSync(new URL("../components/jadwal/my-schedule-tab.tsx", import.meta.url), "utf8")
  assert.match(
    mySchedule,
    /disabled=\{teachers\.length === 0\}/,
    "pemilih guru harus dinonaktifkan saat populasi guru kosong",
  )
  assert.match(
    mySchedule,
    /teachers\.length === 0 \?/,
    "tab Jadwal Saya harus menjelaskan mengapa tidak ada guru yang bisa dipilih",
  )
})
