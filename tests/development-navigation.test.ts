/**
 * Navigasi dan otorisasi menu Development.
 *
 * Menu bukan batas keamanan — guard route-lah yang menentukan. Berkas ini
 * mengunci keduanya tetap sejalan: item nav menuntut `development.read`, dan
 * halaman menuntut permission yang sama lewat evaluator kanonik, tanpa satu pun
 * pemeriksaan nama role yang ditulis tangan.
 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

import { mainNav, navItems, visibleNavEntries, type NavEntry } from "@/lib/nav"
import { deriveNavGrants } from "@/lib/nav-grants"
import { SYSTEM_ADMIN_ROLE_KEY, getPermission } from "@/lib/rbac-permissions"
import { hasPermission, type AuthorizationSubject } from "@/lib/rbac"

const PROJECT = process.cwd()

function subjectWith(permissionKeys: string[]): AuthorizationSubject {
  return {
    userId: "u-guru",
    isTeacher: true,
    roles: [{ id: "r-guru", key: "guru", name: "Guru", permissionKeys }],
  }
}

const systemAdminSubject: AuthorizationSubject = {
  userId: "u-admin",
  isTeacher: false,
  roles: [{ id: "r-sa", key: SYSTEM_ADMIN_ROLE_KEY, name: "Admin Sistem", permissionKeys: [] }],
}

function titles(entries: readonly NavEntry[]): string[] {
  return entries.map((entry) => entry.title)
}

test("Development terdaftar sebagai menu top-level, bukan anak Administrasi", () => {
  const entry = mainNav.find((candidate) => candidate.title === "Development")
  assert.ok(entry, "menu Development tidak terdaftar")
  assert.notEqual(entry.type, "group", "Development seharusnya item tunggal, bukan grup")

  const administrasi = mainNav.find((candidate) => candidate.title === "Administrasi")
  assert.ok(administrasi && administrasi.type === "group")
  assert.ok(
    !administrasi.children.some((child) => child.href === "/development"),
    "Development tidak boleh menjadi submenu Administrasi",
  )
})

test("Development berada tepat setelah Administrasi", () => {
  const order = titles(mainNav)
  const admin = order.indexOf("Administrasi")
  assert.ok(admin >= 0)
  assert.equal(order[admin + 1], "Development")
})

test("item nav Development menunjuk /development dan menuntut development.read", () => {
  const item = navItems.find((candidate) => candidate.href === "/development")
  assert.ok(item)
  assert.equal(item.title, "Development")
  assert.deepEqual(item.permissions, ["development.read"])
})

test("pemakai tanpa permission tidak melihat menu Development", () => {
  const subject = subjectWith(["attendance.read.all"])
  const visible = visibleNavEntries(mainNav, { grants: deriveNavGrants(subject) })
  assert.ok(!titles(visible).includes("Development"))
})

test("pemakai dengan development.read melihat menu Development", () => {
  const subject = subjectWith(["development.read"])
  const visible = visibleNavEntries(mainNav, { grants: deriveNavGrants(subject) })
  assert.ok(titles(visible).includes("Development"))
})

test("system_admin memperoleh menu lewat bypass yang sudah ada, tanpa RolePermission", () => {
  assert.ok(hasPermission(systemAdminSubject, "development.read"))
  const visible = visibleNavEntries(mainNav, { grants: deriveNavGrants(systemAdminSubject) })
  assert.ok(titles(visible).includes("Development"))
})

test("development.read terdaftar di registry sehingga dapat dikelola lewat UI Akses", () => {
  const definition = getPermission("development.read")
  assert.ok(definition, "permission tidak ada di registry")
  assert.equal(definition.module, "development")
  assert.ok(definition.label.trim().length > 0)
  assert.ok((definition.description ?? "").trim().length > 0)
  // Halaman memuat nama perintah deployment/backup/database.
  assert.equal(definition.sensitive, true)
})

test("key di luar registry tetap ditolak untuk siapa pun", () => {
  assert.equal(hasPermission(systemAdminSubject, "development.run"), false)
  assert.equal(hasPermission(subjectWith(["development.run"]), "development.run"), false)
})

test("akses langsung ke /development dijaga server-side dengan permission yang sama", async () => {
  const page = await readFile(path.join(PROJECT, "app/development/page.tsx"), "utf8")
  assert.ok(page.includes("requireDevelopmentViewer"), "halaman tidak memanggil guard")
  assert.ok(page.includes("ForbiddenError"), "halaman tidak menangani penolakan")

  const access = await readFile(path.join(PROJECT, "lib/development-access.ts"), "utf8")
  assert.ok(access.includes('requirePermission("development.read")'))
})

test("tidak ada pemeriksaan nama role yang ditulis tangan di jalur Development", async () => {
  // Hanya jalur otorisasi yang diperiksa. `lib/development-cli.ts` tidak
  // mengambil keputusan akses sama sekali — ia diuji terpisah di bawah.
  for (const file of ["app/development/page.tsx", "lib/development-access.ts"]) {
    // Komentar dibuang: yang dilarang adalah perilaku, bukan menyebut istilah
    // dalam prosa penjelas.
    const source = (await readFile(path.join(PROJECT, file), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    assert.ok(!source.includes("system_admin"), `${file} menyebut role secara hard-code`)
    assert.ok(!/role\s*===/.test(source), `${file} membandingkan role secara langsung`)
    assert.ok(!source.includes("LegacyRole"), `${file} bersandar pada role legacy`)
  }
})

test("modul dokumentasi CLI tidak mengambil keputusan otorisasi", async () => {
  const source = await readFile(path.join(PROJECT, "lib/development-cli.ts"), "utf8")
  for (const forbidden of ["requirePermission", "hasPermission", "getAuthorizationContext", "redirect"]) {
    assert.ok(!source.includes(forbidden), `lib/development-cli.ts ikut memutuskan akses (${forbidden})`)
  }
})
