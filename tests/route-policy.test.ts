import { strict as assert } from "node:assert"
import { test } from "node:test"

import { isPublicRoute, routePolicy } from "../lib/route-policy"

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

test("modul inti tidak lagi ditapis di lapisan ini", () => {
  // Tapis berbasis role di dalam JWT dihapus pada Phase 4: halaman-halaman ini
  // kini dijaga requirePermission() di server, sehingga pencabutan/pemberian
  // hak berlaku pada request berikutnya tanpa logout.
  for (const path of [
    "/siswa", "/guru", "/wali-kelas/input", "/supervisi-buku-kerja/kelola",
    "/bos", "/bos/akses", "/sarpras", "/e-uks", "/e-uks/pengaturan", "/pengaturan",
  ]) {
    assert.equal(routePolicy(path), "authenticated", `${path} tetap wajib login`)
    assert.equal(isPublicRoute(path), false, `${path} tidak boleh publik`)
  }
})
