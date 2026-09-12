import assert from "node:assert/strict"
import test from "node:test"
import { getPermission, isKnownPermission } from "../lib/rbac-permissions"

const phase5Keys = [
  "bos.read",
  "bos.entries.create",
  "bos.entries.update",
  "bos.budget.update",
  "bos.categories.create",
  "bos.categories.update",
  "bos.access.manage",
  "sarpras.read",
  "sarpras.history.read",
  "sarpras.photos.read",
  "sarpras.locations.create",
  "sarpras.locations.update",
  "sarpras.locations.delete",
  "sarpras.item_types.create",
  "sarpras.item_types.update",
  "sarpras.item_types.delete",
  "sarpras.items.create",
  "sarpras.items.update",
  "sarpras.items.delete",
  "sarpras.photos.create",
  "sarpras.photos.delete",
  "euks.content.read",
  "euks.overview.read",
  "euks.visits.read",
  "euks.visits.create",
  "euks.visits.update",
  "euks.visits.delete",
  "euks.monitoring.read",
  "euks.measurements.read",
  "euks.measurements.create",
  "euks.measurements.delete",
  "euks.sick_absences.read",
  "euks.sick_absences.update",
  "euks.complaint_options.read",
  "euks.complaint_options.create",
  "euks.complaint_options.update",
  "euks.profile.update",
  "euks.officers.create",
  "euks.officers.update",
  "euks.officers.delete",
  "euks.facilities.create",
  "euks.facilities.update",
  "euks.facilities.delete",
  "euks.hero_images.create",
  "euks.hero_images.update",
  "euks.hero_images.delete",
  "euks.hero_logos.create",
  "euks.hero_logos.update",
  "euks.hero_logos.delete",
  "school.settings.read",
  "school.settings.update",
  "school.class_access.manage",
  "school.branding.update",
  "school.holidays.read",
  "school.holidays.create",
  "school.holidays.update",
  "school.holidays.delete",
  "school.holidays.export",
  "database.backup",
  "database.restore",
] as const

test("katalog Phase 5 berisi setiap operasi domain yang diwajibkan", () => {
  for (const key of phase5Keys) assert.equal(isKnownPermission(key), true, key)
})

test("permission super-sensitive dan class access ditandai sensitif", () => {
  for (const key of ["database.backup", "database.restore", "school.class_access.manage"] as const) {
    assert.equal(getPermission(key)?.sensitive, true, key)
  }
})

test("key gabungan lama tidak lagi menjadi authority runtime", () => {
  for (const key of [
    "bos.budget.write",
    "bos.categories.manage",
    "sarpras.locations.write",
    "sarpras.item_types.write",
    "sarpras.items.write",
    "sarpras.photos.write",
    "euks.visits.write",
    "euks.measurements.write",
    "euks.sick_absences.write",
    "euks.complaint_options.manage",
    "euks.profile.manage",
    "school.settings.write",
    "school.class_access.write",
    "school.branding.write",
    "school.holidays.write",
  ]) assert.equal(isKnownPermission(key), false, key)
})
