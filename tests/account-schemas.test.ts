import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  AUTHORIZATION_FIELDS,
  ownProfileUpdateSchema,
  passwordUpdateSchema,
} from "../lib/account-schemas"

test("profil sendiri menerima payload identitas yang sah", () => {
  const parsed = ownProfileUpdateSchema.parse({
    name: "Budi Santoso",
    nip: "198012345",
    email: "budi@sekolah.id",
    phone: "+628123456789",
  })
  assert.equal(parsed.name, "Budi Santoso")
})

test("profil sendiri MENOLAK setiap field otorisasi yang disuntikkan", () => {
  // Menolak, bukan membuang diam-diam: klien yang mencoba menaikkan hak
  // dirinya harus menerima kegagalan yang terlihat, bukan sukses palsu.
  for (const field of AUTHORIZATION_FIELDS) {
    const payload: Record<string, unknown> = {
      name: "Budi",
      nip: "1980",
      email: "",
      phone: "",
      [field]: field === "roles" || field === "permissions" ? ["role-admin"] : true,
    }

    const result = ownProfileUpdateSchema.safeParse(payload)
    assert.equal(result.success, false, `field ${field} seharusnya ditolak`)
  }
})

test("daftar field otorisasi mencakup yang disyaratkan Phase 6", () => {
  const guarded: readonly string[] = AUTHORIZATION_FIELDS
  for (const field of ["role", "roles", "permission", "permissions", "active", "isTeacher"]) {
    assert.ok(guarded.includes(field), `${field} harus dijaga`)
  }
})

test("profil sendiri menolak field asing apa pun, bukan hanya yang terdaftar", () => {
  const result = ownProfileUpdateSchema.safeParse({
    name: "Budi",
    nip: "1980",
    email: "",
    phone: "",
    canManageTeacherProfiles: true,
  })
  assert.equal(result.success, false)
})

test("ganti password sendiri menolak field otorisasi yang disuntikkan", () => {
  const result = passwordUpdateSchema.safeParse({
    currentPassword: "lama12345",
    newPassword: "baru12345",
    active: true,
  })
  assert.equal(result.success, false)
})

test("ganti password sendiri tidak menerima userId target", () => {
  // Mencegah endpoint profil dipakai mereset password akun lain.
  const result = passwordUpdateSchema.safeParse({
    currentPassword: "lama12345",
    newPassword: "baru12345",
    userId: "korban-1",
  })
  assert.equal(result.success, false)
})
