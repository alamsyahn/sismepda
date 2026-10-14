import { strict as assert } from "node:assert"
import { test } from "node:test"
import { getPermission, validateRegistry } from "../lib/rbac-permissions"
import { hasPermission, type AuthorizationSubject } from "../lib/rbac"
import { getRoleTemplate } from "../lib/rbac-templates"
import { flattenNav, mainNav, visibleNavEntries } from "../lib/nav"

const own = ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own"]
const staff = ["euks.menstruation.read", "euks.menstruation.create", "euks.menstruation.update", "euks.menstruation.review"]
function actor(keys: readonly string[]): AuthorizationSubject {
  return { userId: "test-user", isTeacher: false, roles: [{ id: "test-role", key: "test-role", name: "Test", permissionKeys: keys }] }
}
test("izin menstruasi khusus terdaftar dan konsisten", () => {
  assert.deepEqual(validateRegistry(), [])
  for (const key of [...own, ...staff, "students.accounts.manage"]) assert.ok(getPermission(key), key)
})
test("izin pantauan umum tidak membuka data menstruasi", () => {
  for (const key of [...own, ...staff]) assert.equal(hasPermission(actor(["euks.monitoring.read"]), key), false)
  assert.equal(hasPermission(actor(staff), staff[0]), true)
  assert.equal(hasPermission(actor(own), staff[0]), false)
})
test("template siswa hanya akses pribadi; pengurus UKS tidak diberi izin baru otomatis", () => {
  assert.deepEqual(getRoleTemplate("siswa")?.permissionKeys, own)
  for (const key of staff) assert.ok(!getRoleTemplate("pengurus_uks")?.permissionKeys.includes(key))
})
test("menu pribadi dan mingguan terpisah sesuai izin", () => {
  const hrefs = (keys: readonly string[], canReadOwnMenstruation?: boolean) => flattenNav(visibleNavEntries(mainNav, { grants: keys, canReadOwnMenstruation })).map((item) => item.href)
  assert.ok(hrefs(own, true).includes("/kartu-menstruasi"))
  assert.ok(!hrefs(own, true).includes("/e-uks/menstruasi-mingguan"))
  assert.ok(hrefs(staff).includes("/e-uks/menstruasi-mingguan"))
  assert.ok(!hrefs(["euks.monitoring.read"]).includes("/e-uks/menstruasi-mingguan"))
  assert.ok(hrefs(["students.accounts.manage"]).includes("/pengaturan/akun-siswa"))
})
