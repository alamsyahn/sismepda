import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  CLASS_WIDENING_FAMILIES,
  collectGrants,
  findMissingDependencies,
  findUnknownPermissions,
  hasAnyPermission,
  hasPermission,
  isSystemAdmin,
  resolveClassScope,
  resolveScope,
  type AuthorizationSubject,
  type RoleSummary,
} from "../lib/rbac"
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  RESERVED_ROLE_KEYS,
  SYSTEM_ADMIN_ROLE_KEY,
  buildPermissionKey,
  getPermission,
  isKnownPermission,
  validateRegistry,
} from "../lib/rbac-permissions"
import { ROLE_TEMPLATES } from "../lib/rbac-templates"

function role(key: string, permissionKeys: readonly string[], name = key): RoleSummary {
  return { id: `role-${key}`, key, name, permissionKeys }
}

function subject(roles: readonly RoleSummary[], isTeacher = false): AuthorizationSubject {
  return { userId: "user-1", roles, isTeacher }
}

// --- zero / one / multi role ------------------------------------------------

test("tanpa role sama sekali tidak menghasilkan permission apa pun", () => {
  const actor = subject([])
  assert.equal(collectGrants(actor).size, 0)
  assert.equal(hasPermission(actor, "attendance.read.all"), false)
  assert.equal(hasPermission(actor, "bos.read"), false)
  // Tidak ada role default implisit: bukan GURU, bukan apa pun.
  assert.equal(isSystemAdmin(actor), false)
})

test("satu role memberi tepat permission miliknya", () => {
  const actor = subject([role("pengurus_bos", ["bos.read", "bos.entries.create"])])
  assert.equal(hasPermission(actor, "bos.read"), true)
  assert.equal(hasPermission(actor, "bos.entries.create"), true)
  assert.equal(hasPermission(actor, "bos.entries.update"), false)
  assert.equal(hasPermission(actor, "bos.budget.write"), false)
})

test("beberapa role digabung sebagai union", () => {
  const actor = subject([
    role("a", ["bos.read"]),
    role("b", ["sarpras.read"]),
    role("c", ["euks.overview.read"]),
  ])
  const grants = collectGrants(actor)
  assert.equal(grants.size, 3)
  assert.equal(hasPermission(actor, "bos.read"), true)
  assert.equal(hasPermission(actor, "sarpras.read"), true)
  assert.equal(hasPermission(actor, "euks.overview.read"), true)
})

test("role yang tumpang tindih tidak menggandakan dan tidak saling meniadakan", () => {
  const actor = subject([
    role("a", ["bos.read", "bos.entries.create"]),
    role("b", ["bos.read", "bos.entries.update"]),
  ])
  const grants = collectGrants(actor)
  assert.equal(grants.size, 3)
  assert.deepEqual([...grants].sort(), [
    "bos.entries.create",
    "bos.entries.update",
    "bos.read",
  ])
})

test("mencabut satu role yang tumpang tindih tidak mencabut permission dari role lain", () => {
  const before = subject([
    role("a", ["bos.read", "bos.entries.create"]),
    role("b", ["bos.read", "bos.entries.update"]),
  ])
  assert.equal(hasPermission(before, "bos.read"), true)

  // Role "a" dicabut; "bos.read" masih dimiliki lewat role "b".
  const after = subject([role("b", ["bos.read", "bos.entries.update"])])
  assert.equal(hasPermission(after, "bos.read"), true)
  assert.equal(hasPermission(after, "bos.entries.update"), true)
  // Yang hilang hanyalah permission eksklusif milik role "a".
  assert.equal(hasPermission(after, "bos.entries.create"), false)
})

test("role kosong bukan DENY: ia hanya tidak menyumbang apa-apa", () => {
  const actor = subject([role("kosong", []), role("pengurus_bos", ["bos.read"])])
  assert.equal(
    hasPermission(actor, "bos.read"),
    true,
    "role tanpa permission tidak boleh membatalkan grant dari role lain",
  )
})

// --- tidak ada implikasi antar action ---------------------------------------

test("read tidak menyiratkan update", () => {
  const actor = subject([role("r", ["bos.read"])])
  assert.equal(hasPermission(actor, "bos.read"), true)
  assert.equal(hasPermission(actor, "bos.entries.update"), false)
})

test("read tidak menyiratkan export", () => {
  const actor = subject([role("r", ["students.master.read"])])
  assert.equal(hasPermission(actor, "students.master.read"), true)
  assert.equal(hasPermission(actor, "students.master.export"), false)
})

test("update tidak menyiratkan delete", () => {
  const actor = subject([role("r", ["students.master.update"])])
  assert.equal(hasPermission(actor, "students.master.update"), true)
  assert.equal(hasPermission(actor, "students.master.delete"), false)
})

test("manage bukan wildcard: tidak memberi read maupun write keluarga lain", () => {
  const actor = subject([role("r", ["euks.officers.manage"])])
  assert.equal(hasPermission(actor, "euks.officers.manage"), true)
  assert.equal(hasPermission(actor, "euks.overview.read"), false)
  assert.equal(hasPermission(actor, "euks.visits.write"), false)
  assert.equal(hasPermission(actor, "euks.facilities.manage"), false)
})

test("tidak ada key wildcard yang bisa lolos", () => {
  const actor = subject([role("r", ["euks.*", "*", "bos.*.manage"])])
  assert.equal(collectGrants(actor).size, 0, "key wildcard tidak ada di registry")
  assert.equal(hasPermission(actor, "euks.overview.read"), false)
})

// --- scope ------------------------------------------------------------------

test("scope diselesaikan per operasi dan tidak bocor antar action", () => {
  const actor = subject([
    role("r", ["attendance.read.all", "attendance.write.assigned_classes"]),
  ])

  const read = resolveScope(actor, "attendance", "read")
  assert.equal(read.allowed && read.scope, "all")

  const write = resolveScope(actor, "attendance", "write")
  assert.equal(
    write.allowed && write.scope,
    "assigned_classes",
    "read.all tidak boleh melebarkan write",
  )

  const exportDecision = resolveScope(actor, "attendance", "export")
  assert.equal(exportDecision.allowed, false, "export tidak diberikan sama sekali")
})

test("scope all mengalahkan assigned_classes untuk operasi yang sama", () => {
  const actor = subject([
    role("a", ["attendance.read.assigned_classes"]),
    role("b", ["attendance.read.all"]),
  ])
  const decision = resolveScope(actor, "attendance", "read")
  assert.equal(decision.allowed && decision.scope, "all")
})

test("operasi tanpa scope yang dikenal ditolak sebagai unknown_permission", () => {
  const actor = subject([role("r", ["bos.read"])])
  const decision = resolveScope(actor, "tidak", "ada")
  assert.equal(decision.allowed, false)
  assert.equal(decision.allowed === false && decision.reason, "unknown_permission")
})

test("allowTeachersAccessAllClasses tidak melebarkan akun non-guru", () => {
  const roles = [role("guru", ["attendance.read.assigned_classes"])]
  const nonTeacher = subject(roles, false)
  const teacher = subject(roles, true)

  const nonTeacherDecision = resolveClassScope({
    subject: nonTeacher,
    resource: "attendance",
    action: "read",
    allowTeachersAccessAllClasses: true,
  })
  assert.equal(
    nonTeacherDecision.allowed && nonTeacherDecision.scope,
    "assigned_classes",
    "setelan guru tidak boleh melebarkan akun yang bukan record guru",
  )

  const teacherDecision = resolveClassScope({
    subject: teacher,
    resource: "attendance",
    action: "read",
    allowTeachersAccessAllClasses: true,
  })
  assert.equal(teacherDecision.allowed && teacherDecision.scope, "all")
})

test("allowTeachersAccessAllClasses tidak pernah memberi permission yang belum dimiliki", () => {
  const actor = subject([role("guru", ["attendance.read.assigned_classes"])], true)
  const decision = resolveClassScope({
    subject: actor,
    resource: "attendance",
    action: "write",
    allowTeachersAccessAllClasses: true,
  })
  assert.equal(decision.allowed, false, "setelan hanya melebarkan, tidak memberi")
})

test("pelebaran kelas hanya berlaku pada keluarga yang terdaftar", () => {
  const actor = subject([role("r", ["euks.visits.read"])], true)
  const decision = resolveClassScope({
    subject: actor,
    resource: "euks.visits",
    action: "read",
    allowTeachersAccessAllClasses: true,
  })
  // euks.visits.read tidak berskala, jadi tidak ada keputusan scope untuknya.
  assert.equal(decision.allowed, false)
  assert.equal(CLASS_WIDENING_FAMILIES.includes("euks.visits.read"), false)
})

// --- unknown permission -----------------------------------------------------

test("permission tak dikenal selalu ditolak", () => {
  const actor = subject([role("r", ["bos.read"])])
  assert.equal(hasPermission(actor, "bos.superpower"), false)
  assert.equal(hasPermission(actor, ""), false)
  assert.equal(hasAnyPermission(actor, ["tidak.ada", "juga.tidak"]), false)
})

test("permission tak dikenal ditolak bahkan untuk system admin", () => {
  const admin = subject([role(SYSTEM_ADMIN_ROLE_KEY, [])])
  assert.equal(isSystemAdmin(admin), true)
  assert.equal(hasPermission(admin, "bos.read"), true, "key dikenal → bypass berlaku")
  assert.equal(
    hasPermission(admin, "bos.read.everything"),
    false,
    "key tak dikenal tetap ditolak meski system admin",
  )
})

test("key basi di database diabaikan saat union", () => {
  const actor = subject([role("r", ["bos.read", "permission.yang.sudah.dihapus"])])
  assert.deepEqual([...collectGrants(actor)], ["bos.read"])
})

// --- system admin: key, bukan nama ------------------------------------------

test('role custom bernama "Admin Sistem" tidak menjadi system admin', () => {
  const impostor = subject([role("admin_sekolah", ["bos.read"], "Admin Sistem")])
  assert.equal(isSystemAdmin(impostor), false)
  assert.equal(
    hasPermission(impostor, "database.restore"),
    false,
    "nama tampilan tidak pernah memberi bypass",
  )
})

test("role hasil kloning tidak membawa bypass meski metadata protected ikut tersalin", () => {
  // Kloning menyalin nama, deskripsi, bahkan flag protected — tetapi key baru.
  const cloned = subject([role("system_admin_copy", [], "Admin Sistem (salinan)")])
  assert.equal(isSystemAdmin(cloned), false)
  assert.equal(hasPermission(cloned, "database.backup"), false)
  assert.equal(hasPermission(cloned, "rbac.roles.manage"), false)
})

test("key system_admin termasuk key yang dicadangkan", () => {
  assert.equal(RESERVED_ROLE_KEYS.includes(SYSTEM_ADMIN_ROLE_KEY), true)
})

test("system admin memperoleh scope all untuk setiap keluarga berskala", () => {
  const admin = subject([role(SYSTEM_ADMIN_ROLE_KEY, [])])
  const decision = resolveScope(admin, "attendance", "write")
  assert.equal(decision.allowed && decision.scope, "all")
})

// --- dependency -------------------------------------------------------------

test("dependency yang hilang terdeteksi saat menyusun role", () => {
  const missing = findMissingDependencies(["euks.visits.write"])
  assert.deepEqual(missing, ["euks.complaint_options.read", "euks.visits.read"])
})

test("dependency terpenuhi tidak menghasilkan keluhan", () => {
  const missing = findMissingDependencies([
    "euks.visits.write",
    "euks.visits.read",
    "euks.complaint_options.read",
  ])
  assert.deepEqual(missing, [])
})

test("dependency tidak diberikan diam-diam oleh evaluator", () => {
  const actor = subject([role("r", ["euks.visits.write"])])
  assert.equal(hasPermission(actor, "euks.visits.write"), true)
  assert.equal(
    hasPermission(actor, "euks.complaint_options.read"),
    false,
    "dependency adalah validasi konfigurasi, bukan pewarisan runtime",
  )
})

test("dependency UKS tidak menarik students.master.read", () => {
  const visitWrite = getPermission("euks.visits.write")
  assert.ok(visitWrite)
  assert.equal(
    (visitWrite.dependsOn ?? []).includes("students.master.read"),
    false,
    "selector siswa hanya butuh identitas minimal, bukan seluruh data induk",
  )
})

test("key tak dikenal dalam payload role terdeteksi", () => {
  const unknown = findUnknownPermissions(["bos.read", "bos.take_over", "*"])
  assert.deepEqual(unknown, ["bos.take_over", "*"])
})

// --- registry ---------------------------------------------------------------

test("registry konsisten secara internal", () => {
  assert.deepEqual(validateRegistry(), [])
})

test("key registry unik", () => {
  assert.equal(new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length)
})

test("setiap key adalah gabungan resource, action, dan scope", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(
      permission.key,
      buildPermissionKey(permission.resource, permission.action, permission.scope),
      `key tidak konsisten: ${permission.key}`,
    )
  }
})

test("registry memakai read, bukan view", () => {
  const viewers = PERMISSIONS.filter((permission) => permission.action === "view")
  assert.deepEqual(viewers, [])
})

test("isKnownPermission menerima persis isi registry", () => {
  for (const key of PERMISSION_KEYS) assert.equal(isKnownPermission(key), true)
  assert.equal(isKnownPermission("bos"), false)
  assert.equal(isKnownPermission("bos.read "), false)
})

test("permission sensitif ditandai, bukan diperlakukan khusus oleh evaluator", () => {
  const restore = getPermission("database.restore")
  assert.ok(restore)
  assert.equal(restore.sensitive, true)

  // Penandaan tidak mengubah keputusan: yang punya key tetap lolos.
  const actor = subject([role("r", ["database.restore"])])
  assert.equal(hasPermission(actor, "database.restore"), true)
})

// --- template ---------------------------------------------------------------

test("template hanya memakai key yang ada di registry", () => {
  for (const template of ROLE_TEMPLATES) {
    const unknown = findUnknownPermissions(template.permissionKeys)
    assert.deepEqual(unknown, [], `role ${template.key} memakai key tak dikenal`)
  }
})

test("template system_admin tidak menyimpan permission apa pun", () => {
  const admin = ROLE_TEMPLATES.find((template) => template.key === SYSTEM_ADMIN_ROLE_KEY)
  assert.ok(admin)
  assert.deepEqual(admin.permissionKeys, [])
  assert.equal(admin.isProtected, true)
})

test("template tidak meninggalkan dependency yang hilang", () => {
  for (const template of ROLE_TEMPLATES) {
    const missing = findMissingDependencies(template.permissionKeys)
    assert.deepEqual(missing, [], `role ${template.key} kehilangan dependency: ${missing.join(", ")}`)
  }
})

test("key template unik", () => {
  const keys = ROLE_TEMPLATES.map((template) => template.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("template guru tidak memperoleh scope all", () => {
  const guru = ROLE_TEMPLATES.find((template) => template.key === "guru")
  assert.ok(guru)
  const wide = guru.permissionKeys.filter((key) => key.endsWith(".all"))
  assert.deepEqual(wide, [])
})

test("template siswa dan wali murid belum memiliki permission", () => {
  for (const key of ["siswa", "wali_murid"]) {
    const template = ROLE_TEMPLATES.find((entry) => entry.key === key)
    assert.ok(template)
    assert.deepEqual(template.permissionKeys, [])
  }
})
