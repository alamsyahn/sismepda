/**
 * Proteksi target istimewa pada operasi akun.
 *
 * Fokus berkas ini: memastikan "istimewa" diputuskan dari KEWENANGAN NYATA yang
 * dipegang target, bukan dari flag kosmetik `isProtected`.
 *
 * Celah yang dijaga: role kustom bernama apa pun yang memegang
 * `accounts.credentials.manage` memberi pemiliknya kuasa mereset sandi orang
 * lain. Role seperti itu tidak punya `isProtected`. Bila proteksi hanya melihat
 * flag tersebut, pemegang `teachers.accounts.update` dapat mereset sandi manager
 * RBAC dan mengambil alih akunnya — eskalasi hak yang tampak sah.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveAccountTargetPrivilege } from "../lib/account-privilege"

describe("resolveAccountTargetPrivilege", () => {
  it("menandai target yang memegang role terproteksi", () => {
    const privilege = resolveAccountTargetPrivilege({
      roles: [{ key: "admin_sistem", isProtected: true, permissionKeys: [] }],
    })

    assert.equal(privilege.isPrivileged, true)
    assert.equal(privilege.isSystemAdmin, false)
  })

  it("menandai target pemegang system_admin lewat key, bukan nama tampilan", () => {
    const privilege = resolveAccountTargetPrivilege({
      roles: [{ key: "system_admin", isProtected: false, permissionKeys: [] }],
    })

    assert.equal(privilege.isSystemAdmin, true)
    assert.equal(privilege.isPrivileged, true)
  })

  it("TIDAK menganggap istimewa role biasa bernama Admin Sistem", () => {
    // Nama tampilan tidak pernah memberi kuasa; hanya key dan permission nyata.
    const privilege = resolveAccountTargetPrivilege({
      roles: [{ key: "staf_biasa", isProtected: false, permissionKeys: ["attendance.dashboard.read.all"] }],
    })

    assert.equal(privilege.isPrivileged, false)
  })

  it("menandai istimewa target pemegang kewenangan sensitif tanpa isProtected", () => {
    // Inti perbaikan: role kustom tanpa flag apa pun, tetapi memegang kuasa
    // kredensial. Ini jalur pengambilalihan yang sebelumnya terbuka.
    const privilege = resolveAccountTargetPrivilege({
      roles: [
        { key: "manajer_akun", isProtected: false, permissionKeys: ["accounts.credentials.manage"] },
      ],
    })

    assert.equal(privilege.isPrivileged, true)
    assert.equal(privilege.isSystemAdmin, false)
    assert.deepEqual(privilege.sensitiveKeys, ["accounts.credentials.manage"])
  })

  it("menandai istimewa pemegang kuasa RBAC", () => {
    const privilege = resolveAccountTargetPrivilege({
      roles: [{ key: "manajer_rbac", isProtected: false, permissionKeys: ["rbac.roles.manage"] }],
    })

    assert.equal(privilege.isPrivileged, true)
  })

  it("tidak tertipu permission yang hanya MENGANDUNG kata sensitif", () => {
    // `teachers.accounts.read` bukan keluarga `accounts.*`: pencocokan harus
    // per segmen, bukan substring. Kalau salah, seluruh direktori guru biasa
    // ikut terkunci dan operasi akun normal mati.
    const privilege = resolveAccountTargetPrivilege({
      roles: [
        { key: "guru", isProtected: false, permissionKeys: ["teachers.accounts.read"] },
      ],
    })

    assert.equal(privilege.isPrivileged, false)
    assert.deepEqual(privilege.sensitiveKeys, [])
  })

  it("menggabungkan kewenangan dari beberapa role", () => {
    const privilege = resolveAccountTargetPrivilege({
      roles: [
        { key: "guru", isProtected: false, permissionKeys: ["teachers.accounts.read"] },
        { key: "pengawas_db", isProtected: false, permissionKeys: ["database.backup"] },
      ],
    })

    assert.equal(privilege.isPrivileged, true)
    assert.deepEqual(privilege.sensitiveKeys, ["database.backup"])
  })

  it("target tanpa role tidak istimewa", () => {
    const privilege = resolveAccountTargetPrivilege({ roles: [] })

    assert.equal(privilege.isPrivileged, false)
    assert.equal(privilege.isSystemAdmin, false)
  })

  it("mengabaikan permission tak dikenal, bukan memperlakukannya sensitif", () => {
    // Fail-closed berlaku saat MEMBERI permission. Di sini kita menilai apa yang
    // sudah dipegang; kunci asing tidak boleh diam-diam mengunci akun.
    const privilege = resolveAccountTargetPrivilege({
      roles: [{ key: "aneh", isProtected: false, permissionKeys: ["tidak.ada.ini"] }],
    })

    assert.equal(privilege.isPrivileged, false)
  })
})
