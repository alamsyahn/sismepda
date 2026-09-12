import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  LEGACY_ADMIN_PREFILTER_ROUTES,
  isLegacyAdminPrefilterRoute,
  isPublicRoute,
  routePolicy,
} from "../lib/route-policy"

test("halaman login publik", () => {
  assert.equal(routePolicy("/login"), "public")
})

test("logo publik hanya untuk GET", () => {
  assert.equal(isPublicRoute("/app-logo", "GET"), true)
  assert.equal(isPublicRoute("/app-logo", "PUT"), false)
  assert.equal(isPublicRoute("/app-logo", "DELETE"), false)
})

test("permukaan tak dikenal fail closed sebagai terautentikasi", () => {
  for (const path of ["/", "/e-uks", "/fitur-baru", "/api/apa-pun", "/siswa/123"]) {
    assert.equal(routePolicy(path), "authenticated", `${path} tidak boleh publik`)
  }
})

test("entri publik tidak mempublikasikan subtree di bawahnya", () => {
  assert.equal(isPublicRoute("/login/reset"), false)
  assert.equal(isPublicRoute("/app-logo/besar", "GET"), false)
})

test("prefilter admin legacy mencocokkan rute dan subtree-nya", () => {
  for (const route of LEGACY_ADMIN_PREFILTER_ROUTES) {
    assert.equal(isLegacyAdminPrefilterRoute(route), true)
    assert.equal(isLegacyAdminPrefilterRoute(`${route}/detail`), true)
  }
})

test("halaman gabungan dicocokkan persis agar profil tetap terbuka untuk guru", () => {
  assert.equal(isLegacyAdminPrefilterRoute("/siswa"), true)
  assert.equal(isLegacyAdminPrefilterRoute("/guru"), true)
  // Profil dan direktori bukan halaman admin.
  assert.equal(isLegacyAdminPrefilterRoute("/siswa/abc123"), false)
  assert.equal(isLegacyAdminPrefilterRoute("/guru/direktori"), false)
})
