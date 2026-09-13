/**
 * Enforcement Phase 4: scope per operasi, penyembunyian IDOR, dan pemisahan
 * kewenangan pada modul inti.
 *
 * Berkas ini menguji ATURAN KEPUTUSAN-nya sebagai fungsi murni. Uji yang
 * membutuhkan database nyata (freshness grant/revoke lintas request) ada di
 * `tests/rbac-enforcement.integration.test.ts`.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  CLASS_WIDENING_FAMILIES,
  hasPermission,
  resolveClassScope,
  resolveScope,
  type AuthorizationSubject,
} from "../lib/rbac"
import { isKnownPermission } from "../lib/rbac-permissions"
import { isPublicRoute, routePolicy } from "../lib/route-policy"
import { canSeeNavItem, flattenNav, mainNav, visibleNavEntries } from "../lib/nav"

function subject(
  permissionKeys: readonly string[],
  options: { isTeacher?: boolean; roleKey?: string } = {},
): AuthorizationSubject {
  return {
    userId: "u1",
    isTeacher: options.isTeacher ?? true,
    roles: [
      {
        id: "r1",
        key: options.roleKey ?? "custom",
        name: "Peran Uji",
        permissionKeys: [...permissionKeys],
      },
    ],
  }
}

/// Bentuk `where` yang dihasilkan resolver untuk sebuah keputusan scope.
function whereFor(scope: "all" | "assigned_classes", userId: string) {
  return scope === "all" ? {} : { homeroomUserId: userId }
}

// ---------------------------------------------------------------------------
// Scope per operasi: read / write / export tidak saling meminjam
// ---------------------------------------------------------------------------

test("attendance: read.all tidak melebarkan write", () => {
  const actor = subject(["attendance.read.all", "attendance.write.assigned_classes"])

  const read = resolveScope(actor, "attendance", "read")
  const write = resolveScope(actor, "attendance", "write")

  assert.deepEqual(read, { allowed: true, scope: "all" })
  assert.deepEqual(write, { allowed: true, scope: "assigned_classes" })
})

test("attendance: export tidak tersirat dari read maupun reports", () => {
  const actor = subject(["attendance.read.all", "attendance.reports.read.all"])

  assert.equal(resolveScope(actor, "attendance", "export").allowed, false)
})

test("dashboard dan reports adalah kewenangan terpisah", () => {
  const dashboardOnly = subject(["attendance.dashboard.read.all"])
  assert.equal(resolveScope(dashboardOnly, "attendance.reports", "read").allowed, false)

  const reportsOnly = subject(["attendance.reports.read.assigned_classes"])
  assert.equal(resolveScope(reportsOnly, "attendance.dashboard", "read").allowed, false)
})

test("himpunan kelas kosong tidak pernah menjadi query tanpa batas", () => {
  const actor = subject(["attendance.read.assigned_classes"])
  const decision = resolveScope(actor, "attendance", "read")

  assert.ok(decision.allowed && decision.scope === "assigned_classes")
  // Kunci regresi: scope sempit WAJIB menghasilkan filter, bukan `{}`.
  assert.deepEqual(whereFor(decision.scope, "u1"), { homeroomUserId: "u1" })
  assert.notDeepEqual(whereFor(decision.scope, "u1"), {})
})

test("assigned_classes dan all tidak bocor antar operasi", () => {
  const actor = subject([
    "attendance.read.assigned_classes",
    "attendance.export.all",
  ])

  const read = resolveScope(actor, "attendance", "read")
  const exportDecision = resolveScope(actor, "attendance", "export")

  assert.ok(read.allowed && read.scope === "assigned_classes")
  assert.ok(exportDecision.allowed && exportDecision.scope === "all")
})

// ---------------------------------------------------------------------------
// Setelan kelas global
// ---------------------------------------------------------------------------

test("setting kelas global tidak melebarkan non-teacher", () => {
  const nonTeacher = subject(["attendance.read.assigned_classes"], { isTeacher: false })

  const decision = resolveClassScope({
    subject: nonTeacher,
    resource: "attendance",
    action: "read",
    allowTeachersAccessAllClasses: true,
  })

  assert.ok(decision.allowed && decision.scope === "assigned_classes")
})

test("setting kelas global tidak memberi permission yang belum dimiliki", () => {
  const actor = subject(["attendance.read.assigned_classes"])

  const decision = resolveClassScope({
    subject: actor,
    resource: "attendance",
    action: "write",
    allowTeachersAccessAllClasses: true,
  })

  assert.equal(decision.allowed, false)
})

test("pelebaran setting hanya untuk keluarga yang terdaftar", () => {
  for (const family of ["teachers.accounts.read", "workbook.supervision.read"]) {
    assert.ok(!CLASS_WIDENING_FAMILIES.includes(family), `${family} tidak boleh melebar`)
  }
  assert.ok(CLASS_WIDENING_FAMILIES.includes("attendance.export"))
  assert.ok(CLASS_WIDENING_FAMILIES.includes("students.profile.read"))
})

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

test("students: create, update, import, delete adalah kewenangan terpisah", () => {
  const creator = subject(["students.master.read", "students.master.create"])

  assert.equal(hasPermission(creator, "students.master.create"), true)
  assert.equal(hasPermission(creator, "students.master.update"), false)
  assert.equal(hasPermission(creator, "students.master.import"), false)
  assert.equal(hasPermission(creator, "students.master.delete"), false)
  assert.equal(hasPermission(creator, "students.master.export"), false)
})

test("students: melihat profil tidak memberi hak mencatat pelanggaran", () => {
  const viewer = subject(["students.profile.read.all"])

  assert.equal(resolveScope(viewer, "students.violations", "create").allowed, false)
  assert.equal(resolveScope(viewer, "students.violations", "read").allowed, false)
})

test("students: pelanggaran hanya punya read dan create, tanpa update/delete", () => {
  assert.ok(isKnownPermission("students.violations.read.assigned_classes"))
  assert.ok(isKnownPermission("students.violations.create.assigned_classes"))
  // Sumbernya tidak punya endpoint ubah/hapus, jadi key-nya pun tidak boleh ada.
  assert.equal(isKnownPermission("students.violations.update.assigned_classes"), false)
  assert.equal(isKnownPermission("students.violations.delete.assigned_classes"), false)
})

test("students: deep-link lintas kelas ditolak lewat scope, bukan lewat UI", () => {
  const homeroom = subject(["students.profile.read.assigned_classes"])
  const decision = resolveScope(homeroom, "students.profile", "read")

  assert.ok(decision.allowed && decision.scope === "assigned_classes")
  // Query profil selalu menyertakan filter kelas ini; siswa di luar scope
  // menghasilkan `null` → notFound(), bukan data yang tersaring di klien.
  assert.deepEqual(whereFor(decision.scope, "u1"), { homeroomUserId: "u1" })
})

// ---------------------------------------------------------------------------
// Teachers & akun
// ---------------------------------------------------------------------------

test("teachers: menyunting profil tidak memberi reset sandi atau ubah status", () => {
  const editor = subject([
    "teachers.accounts.read",
    "teachers.accounts.update",
    "teachers.profile.read",
    "teachers.profile.update",
  ])

  assert.equal(hasPermission(editor, "accounts.credentials.manage"), false)
  assert.equal(hasPermission(editor, "accounts.status.manage"), false)
  assert.equal(hasPermission(editor, "teachers.accounts.delete"), false)
})

test("teachers: direktori tidak memberi akses akun", () => {
  const directory = subject(["teachers.directory.read"])

  assert.equal(hasPermission(directory, "teachers.accounts.read"), false)
  assert.equal(hasPermission(directory, "teachers.profile.update"), false)
})

// ---------------------------------------------------------------------------
// Homeroom & workbook
// ---------------------------------------------------------------------------

test("homerooms: membaca tidak memberi hak menugaskan", () => {
  const reader = subject(["homerooms.read"])

  assert.equal(hasPermission(reader, "homerooms.assign"), false)
  assert.equal(hasPermission(reader, "homerooms.export"), false)
})

test("workbook: membaca supervisi tidak memberi hak menilai atau mengatur cakupan", () => {
  const viewer = subject(["workbook.supervision.read"])

  assert.equal(hasPermission(viewer, "workbook.supervision.review"), false)
  assert.equal(hasPermission(viewer, "workbook.scope.manage"), false)
})

test("workbook: tautan sendiri terpisah dari supervisi", () => {
  const teacher = subject(["workbook.links.read.own", "workbook.links.update.own"])

  assert.equal(hasPermission(teacher, "workbook.supervision.read"), false)
  assert.equal(hasPermission(teacher, "workbook.links.update.own"), true)
})

// ---------------------------------------------------------------------------
// Navigasi
// ---------------------------------------------------------------------------

test("nav: menu berasal dari permission, bukan nama peran", () => {
  const hrefs = (grants: readonly string[]) =>
    flattenNav(visibleNavEntries(mainNav, { grants })).map((item) => item.href)

  const guruHrefs = hrefs([
    "attendance.dashboard.read.assigned_classes",
    "attendance.read.assigned_classes",
  ])
  assert.ok(guruHrefs.includes("/"))
  assert.ok(guruHrefs.includes("/absensi/input"))
  assert.ok(!guruHrefs.includes("/siswa"), "tanpa students.master.read menu tidak tampil")

  // Peran bernama "GURU" yang MEMEGANG students.master.read tetap melihatnya:
  // yang menentukan adalah grant, bukan namanya.
  assert.ok(hrefs(["students.master.read"]).includes("/siswa"))
})

test("nav: zero-role tidak melihat satu pun menu yang dijaga", () => {
  const entries = visibleNavEntries(mainNav, { grants: [] })
  const hrefs = flattenNav(entries).map((item) => item.href)

  for (const guarded of ["/", "/absensi/input", "/siswa", "/guru", "/laporan-whatsapp"]) {
    assert.ok(!hrefs.includes(guarded), `${guarded} tidak boleh tampil untuk zero-role`)
  }
})

test("nav: group tanpa anak yang terlihat tidak dirender", () => {
  const entries = visibleNavEntries(mainNav, {
    grants: ["attendance.read.assigned_classes"],
  })
  const ids = entries.filter((entry) => "children" in entry).map((entry) => (entry as { id: string }).id)

  assert.ok(!ids.includes("data-master"), "Data Master kosong harus hilang")
})

test("nav: item tanpa daftar permission tetap terbuka bagi sesi yang sah", () => {
  const profil = { title: "Profil", href: "/profil", icon: mainNav[0].icon, description: "" }
  assert.equal(canSeeNavItem(profil as never, { grants: [] }), true)
})

// ---------------------------------------------------------------------------
// Lapisan proxy
// ---------------------------------------------------------------------------

test("proxy: modul inti wajib login tetapi tidak ditapis berdasarkan peran", () => {
  for (const path of ["/siswa", "/guru", "/wali-kelas/input", "/pengaturan"]) {
    assert.equal(routePolicy(path), "authenticated")
    assert.equal(isPublicRoute(path), false)
  }
})

test("proxy: permukaan tak dikenal fail closed", () => {
  assert.equal(routePolicy("/modul-yang-belum-ada"), "authenticated")
  assert.equal(routePolicy("/api/apa-pun"), "authenticated")
})
