/**
 * Parity navigasi untuk System Admin.
 *
 * Navigasi disaring dari grant efektif. Role `system_admin` sengaja TIDAK
 * memiliki baris `RolePermission` apa pun: kewenangannya berasal dari bypass
 * terkendali di evaluator kanonik (`hasPermission`), bukan dari materialisasi.
 *
 * Karena itu grant untuk navigasi harus diturunkan lewat evaluator kanonik,
 * bukan dari baris RolePermission mentah. Berkas ini mengunci properti itu
 * sekaligus batasnya: bypass hanya milik role ber-KEY `system_admin`, key tak
 * dikenal tetap tertutup, dan pemakai biasa tetap union OR dari role-nya.
 *
 * Navigasi tetap UX semata — guard route/API tidak diuji di sini.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { accountNav, canSeeNavItem, dashboardItem, mainNav, navItems, visibleNavEntries, visibleNavItems, type NavEntry } from "@/lib/nav"
import { deriveNavGrants } from "@/lib/nav-grants"
import { PERMISSION_KEYS, SYSTEM_ADMIN_ROLE_KEY } from "@/lib/rbac-permissions"
import type { AuthorizationSubject } from "@/lib/rbac"

/** Subject dengan role `system_admin` TANPA satu pun RolePermission. */
const systemAdminSubject: AuthorizationSubject = {
  userId: "u-system-admin",
  isTeacher: false,
  roles: [
    {
      id: "r-system-admin",
      key: SYSTEM_ADMIN_ROLE_KEY,
      name: "Admin Sistem",
      permissionKeys: [],
    },
  ],
}

function flatten(entries: readonly NavEntry[]): { title: string; href: string }[] {
  const out: { title: string; href: string }[] = []
  for (const entry of entries) {
    if (entry.type === "group") {
      for (const child of entry.children) out.push({ title: child.title, href: child.href })
      continue
    }
    out.push({ title: entry.title, href: entry.href })
  }
  return out
}

function labelsOf(entries: readonly NavEntry[]): string[] {
  return entries.map((entry) => entry.title)
}

/** Href setiap tujuan yang benar-benar dijaga daftar permission. */
const GUARDED_HREFS = new Set(
  navItems.filter((item) => (item.permissions?.length ?? 0) > 0).map((item) => item.href),
)

test("system_admin tanpa RolePermission tetap memperoleh seluruh permission yang dikenal", () => {
  const grants = deriveNavGrants(systemAdminSubject)

  for (const key of PERMISSION_KEYS) {
    assert.ok(grants.has(key), `permission dikenal tidak ikut terderivasi: ${key}`)
  }
  assert.equal(grants.size, PERMISSION_KEYS.length)
})

test("system_admin melihat setiap tujuan navigasi yang dijaga permission dikenal", () => {
  const viewer = { grants: deriveNavGrants(systemAdminSubject) }
  const visible = visibleNavEntries(mainNav, viewer)

  // Tidak ada satu pun entri yang hilang: seluruh pohon harus tampil utuh.
  assert.deepEqual(labelsOf(visible), labelsOf(mainNav))
  assert.equal(flatten(visible).length, flatten(mainNav).length)

  // Termasuk dashboard dan menu akun.
  assert.deepEqual(
    visibleNavItems(viewer).map((item) => item.href),
    navItems.map((item) => item.href),
  )
  assert.ok(canSeeNavItem(dashboardItem, viewer))
  for (const item of accountNav) assert.ok(canSeeNavItem(item, viewer), `menu akun hilang: ${item.href}`)
})

test("parity langsung untuk destinasi yang dilaporkan hilang", () => {
  const viewer = { grants: deriveNavGrants(systemAdminSubject) }
  const visible = visibleNavEntries(mainNav, viewer)
  const hrefs = new Set(visibleNavItems(viewer).map((item) => item.href))
  const labels = new Set([...labelsOf(visible), ...flatten(visible).map((entry) => entry.title)])

  for (const href of ["/pengaturan", "/pengaturan/pengguna", "/pengaturan/akses", "/pengaturan/audit"]) {
    assert.ok(hrefs.has(href), `tujuan pengaturan tidak terlihat: ${href}`)
  }

  for (const label of ["Data Master", "E-UKS", "BOS", "Sarpras", "Supervisi Buku Kerja"]) {
    assert.ok(labels.has(label), `tujuan tidak terlihat: ${label}`)
  }
})

test("pemakai biasa hanya melihat permission yang benar-benar dimilikinya", () => {
  const subject: AuthorizationSubject = {
    userId: "u-guru",
    isTeacher: true,
    roles: [
      {
        id: "r-guru",
        key: "guru",
        name: "Guru",
        permissionKeys: ["attendance.read.assigned_classes"],
      },
    ],
  }

  const grants = deriveNavGrants(subject)

  assert.deepEqual([...grants], ["attendance.read.assigned_classes"])
  assert.ok(!grants.has("rbac.roles.manage"))
  assert.ok(!grants.has("bos.read"))
})

test("union OR lintas role tetap berlaku bagi pemakai biasa", () => {
  const subject: AuthorizationSubject = {
    userId: "u-kombinasi",
    isTeacher: true,
    roles: [
      { id: "r-guru", key: "guru", name: "Guru", permissionKeys: ["attendance.read.assigned_classes"] },
      { id: "r-pengawas", key: "pengawas", name: "Pengawas", permissionKeys: ["workbook.supervision.read"] },
    ],
  }

  const grants = deriveNavGrants(subject)

  assert.ok(grants.has("attendance.read.assigned_classes"))
  assert.ok(grants.has("workbook.supervision.read"))
  assert.equal(grants.size, 2)
})

test("role yang hanya BERNAMA Admin Sistem tidak memperoleh bypass", () => {
  const impostor: AuthorizationSubject = {
    userId: "u-impostor",
    isTeacher: false,
    roles: [
      {
        id: "r-impostor",
        key: "admin_sistem_tiruan",
        name: "Admin Sistem",
        permissionKeys: ["attendance.read.assigned_classes"],
      },
    ],
  }

  const grants = deriveNavGrants(impostor)

  assert.deepEqual([...grants], ["attendance.read.assigned_classes"])
  assert.ok(!grants.has("rbac.roles.manage"))

  const visible = visibleNavEntries(mainNav, { grants })
  const hrefs = new Set(flatten(visible).map((entry) => entry.href))
  assert.ok(!hrefs.has("/pengaturan/akses"))
  assert.ok(!hrefs.has("/pengaturan/audit"))
})

test("kloning system_admin tidak ikut membawa bypass", () => {
  // Duplikat membawa nama dan permission yang sama, tetapi key-nya berbeda.
  const clone: AuthorizationSubject = {
    userId: "u-clone",
    isTeacher: false,
    roles: [
      {
        id: "r-clone",
        key: "system_admin_copy",
        name: "Admin Sistem",
        permissionKeys: [],
      },
    ],
  }

  const grants = deriveNavGrants(clone)

  assert.equal(grants.size, 0)
})

test("key tak dikenal tetap tertutup, termasuk bagi system_admin", () => {
  const typo: AuthorizationSubject = {
    userId: "u-typo",
    isTeacher: false,
    roles: [
      {
        id: "r-typo",
        key: "operator",
        name: "Operator",
        permissionKeys: ["rbac.roles.manag", "bos.reed", "sarpras.read"],
      },
    ],
  }

  const grants = deriveNavGrants(typo)

  assert.ok(!grants.has("rbac.roles.manag"))
  assert.ok(!grants.has("bos.reed"))
  assert.deepEqual([...grants], ["sarpras.read"])

  // Bypass system admin pun tidak boleh memunculkan key di luar registry.
  const adminGrants = deriveNavGrants(systemAdminSubject)
  assert.ok(!adminGrants.has("rbac.roles.manag"))
  assert.ok(!adminGrants.has("bos.reed"))
})

test("pemakai tanpa role tidak memperoleh grant apa pun", () => {
  const grants = deriveNavGrants({ userId: "u-kosong", isTeacher: false, roles: [] })

  assert.equal(grants.size, 0)

  // Hanya entri tanpa daftar permission yang boleh tersisa; semua yang dijaga
  // permission harus hilang.
  for (const entry of flatten(visibleNavEntries(mainNav, { grants }))) {
    assert.ok(!GUARDED_HREFS.has(entry.href), `entri terjaga bocor ke pemakai tanpa role: ${entry.href}`)
  }
  for (const item of visibleNavItems({ grants })) {
    assert.ok(!GUARDED_HREFS.has(item.href), `entri terjaga bocor ke pemakai tanpa role: ${item.href}`)
  }
})
