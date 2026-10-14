import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { StudentAccountManager } from "../components/students/student-account-manager"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
test("both endpoint boundaries demand the dedicated permission before accessing roster or transaction", () => {
  const route = source("app/api/admin/student-accounts/route.ts")
  for (const method of ["GET", "POST"]) {
    const body = route.split(`export async function ${method}`)[1]?.split("export async function")[0]
    assert.ok(body)
    assert.match(body, /requirePermission\("students\.accounts\.manage"\)/)
  }
  assert.match(route, /verifySameOrigin\(request\)/)
  assert.match(route, /SyntaxError/)
})
test("database adapter serializes creation and audits inside same transaction without updating existing users", () => {
  const sourceText = source("lib/student-account-server.ts")
  assert.match(sourceText, /\$transaction/)
  assert.match(sourceText, /Serializable/)
  assert.match(sourceText, /lockSystemAdminPopulation\(tx\)/)
  assert.match(sourceText, /recordAuditLog/)
  assert.match(sourceText, /mode: "insensitive"/)
  assert.match(sourceText, /rbacRoles:[\s\S]*create/)
  assert.doesNotMatch(sourceText, /user\.(update|upsert)/)
  assert.doesNotMatch(sourceText, /nis:|nisn:|healthMeasurements:|birthDate:/)
})
test("dedicated page has a server permission gate and UI uses password controls without returning stored secrets", () => {
  assert.match(source("app/pengaturan/akun-siswa/page.tsx"), /requirePagePermission\("students\.accounts\.manage"\)/)
  const ui = source("components/students/student-account-manager.tsx")
  assert.match(ui, /type="password"/)
  assert.match(ui, /autoComplete="new-password"/)
  assert.match(ui, /setPassword\(""\)/)
  assert.doesNotMatch(ui, /console\./)
})

test("renders only unlinked students as selectable and keeps existing account status minimal", () => {
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, async prefetch() {} }
  const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router },
    React.createElement(StudentAccountManager, { students: [
      { id: "free", name: "Available", schoolClass: { name: "VII A" }, account: null },
      { id: "linked", name: "Linked", schoolClass: { name: "VII B" }, account: { id: "user", active: false } },
    ] })))
  assert.match(html, /option value="free"/)
  assert.doesNotMatch(html, /option value="linked"/)
  assert.match(html, /Nonaktif/)
  assert.match(html, /type="password"/)
  assert.match(html, /for="student-account-password"/)
})
