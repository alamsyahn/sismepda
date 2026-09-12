-- RBAC Phase 5 cleanup: retire permission rows superseded by operation-specific
-- keys. These rows no longer exist in lib/rbac-permissions.ts, so the evaluator
-- already rejects them at runtime (unknown keys never match, even for system
-- admin). They are removed here so the catalog cannot misrepresent them as
-- effective grants to any future role-management surface.
--
-- Safe because the preceding migration (20260913130000) already copied every
-- edge from each of these keys onto its replacement operation keys.

DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission" WHERE "key" IN (
    'sarpras.locations.write',
    'sarpras.item_types.write',
    'sarpras.items.write',
    'sarpras.photos.write',
    'sarpras.access.manage',
    'school.holidays.write',
    'euks.visits.write',
    'euks.measurements.write',
    'euks.sick_absences.write'
  )
);

DELETE FROM "Permission"
WHERE "key" IN (
  'sarpras.locations.write',
  'sarpras.item_types.write',
  'sarpras.items.write',
  'sarpras.photos.write',
  'sarpras.access.manage',
  'school.holidays.write',
  'euks.visits.write',
  'euks.measurements.write',
  'euks.sick_absences.write'
);
