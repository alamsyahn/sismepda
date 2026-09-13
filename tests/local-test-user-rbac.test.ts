/**
 * Kontrak helper akun uji lokal pasca-RBAC.
 *
 * Otorisasi runtime kini sepenuhnya berasal dari keanggotaan role RBAC; tidak
 * ada modul di `lib/` yang membaca `LegacyRole` sebagai jalur bypass. Karena itu
 * helper yang hanya menyetel `role: ADMIN` menghasilkan akun yang bisa login
 * tetapi tanpa satu pun permission — kecuali backfill legacy kebetulan pernah
 * memberinya role, yang tidak berlaku pada database lokal hasil bootstrap segar.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { planLocalTestUser } from "@/lib/local-test-user"

const HELPER = "scripts/ensure-local-test-user.ts"

test("helper menetapkan role RBAC system_admin, bukan hanya flag legacy", () => {
  const source = readFileSync(HELPER, "utf8")

  // Konstanta lebih baik daripada literal, jadi terima keduanya.
  assert.match(source, /SYSTEM_ADMIN_ROLE_KEY|"system_admin"/, "helper harus memberi role RBAC system_admin")
  assert.match(source, /userRole|rbacRoles/, "helper harus menulis keanggotaan role RBAC")
})

test("helper idempoten: keanggotaan role tidak diduplikasi", () => {
  const source = readFileSync(HELPER, "utf8")

  // Keanggotaan user-role memiliki kunci unik (userId, roleId); penulisan ulang
  // harus memakai upsert/skipDuplicates agar pemanggilan kedua tidak melempar.
  assert.match(source, /upsert|skipDuplicates|createMany/)
})

test("helper tidak dipanggil oleh seed produksi", () => {
  const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  for (const berkas of ["prisma/seed.ts", "prisma/seed-rbac.ts"]) {
    const source = tanpaKomentar(readFileSync(berkas, "utf8"))
    assert.doesNotMatch(source, /ensure-local-test-user/, `${berkas} tidak boleh memanggil helper akun uji`)
    assert.doesNotMatch(source, /planLocalTestUser/, `${berkas} tidak boleh memakai guard akun uji`)
  }
})

test("guard menolak host non-lokal", () => {
  const decision = planLocalTestUser({
    ALLOW_LOCAL_TEST_USER: "true",
    DATABASE_URL: "postgresql://u:p@db.produksi.example.com:5432/sismepda_dev",
    DEV_TEST_USER_EMAIL: "uji@sismepda.test",
    DEV_TEST_USER_PASSWORD: "katasandi-panjang",
  })

  assert.equal(decision.ok, false)
})

test("guard menolak nama database produksi meski host lokal", () => {
  const decision = planLocalTestUser({
    ALLOW_LOCAL_TEST_USER: "true",
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sismepda",
    DEV_TEST_USER_EMAIL: "uji@sismepda.test",
    DEV_TEST_USER_PASSWORD: "katasandi-panjang",
  })

  assert.equal(decision.ok, false)
})

test("guard menolak tanpa opt-in eksplisit", () => {
  const decision = planLocalTestUser({
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sismepda_dev",
    DEV_TEST_USER_EMAIL: "uji@sismepda.test",
    DEV_TEST_USER_PASSWORD: "katasandi-panjang",
  })

  assert.equal(decision.ok, false)
})
