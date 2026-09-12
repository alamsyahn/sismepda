import { strict as assert } from "node:assert"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

import {
  SARPRAS_ROUTE_PERMISSIONS,
  sarprasCapabilitiesFromGrants,
} from "../lib/sarpras-authorization"
import { isValidLocationParent } from "../lib/sarpras"

test("hak create tidak memberi update atau delete", () => {
  const capabilities = sarprasCapabilitiesFromGrants(new Set([
    "sarpras.read",
    "sarpras.locations.create",
    "sarpras.items.create",
  ]))

  assert.equal(capabilities.locations.create, true)
  assert.equal(capabilities.locations.update, false)
  assert.equal(capabilities.locations.delete, false)
  assert.equal(capabilities.items.create, true)
  assert.equal(capabilities.items.update, false)
  assert.equal(capabilities.items.delete, false)
})

test("hak membuat foto tidak memberi hak menghapus foto", () => {
  const capabilities = sarprasCapabilitiesFromGrants(new Set([
    "sarpras.read",
    "sarpras.photos.read",
    "sarpras.photos.create",
  ]))

  assert.equal(capabilities.photos.read, true)
  assert.equal(capabilities.photos.create, true)
  assert.equal(capabilities.photos.delete, false)
})

test("setiap method handler Sarpras memakai permission tepat", () => {
  assert.deepEqual(SARPRAS_ROUTE_PERMISSIONS, {
    overview: { GET: "sarpras.read" },
    history: { GET: "sarpras.history.read" },
    photoCollection: {
      GET: "sarpras.photos.read",
      POST: "sarpras.photos.create",
      DELETE: "sarpras.photos.delete",
    },
    photoResource: { GET: "sarpras.photos.read" },
    locations: {
      POST: "sarpras.locations.create",
      PATCH: "sarpras.locations.update",
      DELETE: "sarpras.locations.delete",
    },
    itemTypes: {
      POST: "sarpras.item_types.create",
      PATCH: "sarpras.item_types.update",
      DELETE: "sarpras.item_types.delete",
    },
    items: {
      POST: "sarpras.items.create",
      PATCH: "sarpras.items.update",
      DELETE: "sarpras.items.delete",
    },
  })
})

test("shortcut akses Sarpras berbasis flag legacy sudah dipensiunkan", () => {
  // Setelah Phase 5, canViewSarpras/canEditSarpras tidak lagi menentukan akses
  // apa pun. Mempertahankan halaman/endpoint yang menulisnya berarti memberi
  // admin kontrol yang terlihat bekerja padahal tidak mengubah otorisasi.
  const repoRoot = new URL("..", import.meta.url)
  for (const relative of [
    "app/sarpras/akses/page.tsx",
    "app/api/sarpras/access/route.ts",
    "components/sarpras/sarpras-access-manager.tsx",
  ]) {
    assert.equal(
      existsSync(new URL(relative, repoRoot)),
      false,
      `${relative} masih ada padahal hanya menulis flag legacy yang mati`,
    )
  }

  assert.doesNotMatch(readFileSync(new URL("lib/server-sarpras.ts", repoRoot), "utf8"), /readSarprasAccessScope/)
})

test("parent lokasi harus null atau menunjuk lokasi yang ada", () => {
  const knownIds = new Set(["gedung", "lantai"])
  assert.equal(isValidLocationParent(null, knownIds), true)
  assert.equal(isValidLocationParent("gedung", knownIds), true)
  assert.equal(isValidLocationParent("hilang", knownIds), false)
})
