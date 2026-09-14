# Backup and restore

ADMIN can download/restore database data from `/pengaturan` through `/api/admin/database`. The runtime image includes PostgreSQL client 17.

## Backup contract

`GET` runs `pg_dump` custom format, data-only, without owner/privileges, excluding `_prisma_migrations` via the schema-qualified pattern `*._prisma_migrations`; the temporary file is returned as `sismepda-backup-<UTC timestamp>.dump` and deleted server-side. This is a logical data backup, not a schema/migration backup. Save it off the app/VPS and record which code/migration version produced it.

The schema qualification matters: `--exclude-table=_prisma_migrations` without a prefix matches only in `public`, so on a deployment using a dedicated schema the migration table stayed in the archive and the product's own backup was then rejected by its restore preflight. `tests/database-restore-route.test.ts` locks the qualified pattern. The response carries `X-SISMEPDA-Backup-Format: sismepda-backup-v1`, the format token the restore preflight accepts.

The current archive parser recognizes only `TABLE DATA public ...`. Although application/Prisma access supports a `?schema=` parameter for isolated development schemas, in-app backup/restore is therefore supported only for a database whose SISMEPDA tables are in `public`; do not use it for `?schema=<non-public>` targets (TD-007).

## Post-RBAC compatibility

RBAC moves authorization into database state, so an archive that lacks it can silently destroy access. A compatible archive must carry all of `User`, `RbacRole`, `Permission`, `UserRole`, `RolePermission`, and `RbacMigration` (readiness/migration state). `UserRole` is the decisive one: `TRUNCATE ... CASCADE` on `User` removes role membership through foreign keys, so restoring a pre-RBAC archive would leave zero active `system_admin` — an unrecoverable lockout through the web UI.

## Restore preflight

`lib/database-restore-preflight.ts` evaluates compatibility **before** the first destructive statement. It is pure: it inspects the full table list extracted from `pg_restore --list` and never touches the database. Rejection reasons:

| Reason | Meaning |
| --- | --- |
| `no-table-data` | archive lists no table data |
| `migration-table-present` | archive contains `_prisma_migrations` |
| `format-unsupported` | format token present but not `sismepda-backup-v1` |
| `rbac-tables-missing` | one or more required RBAC tables absent (pre-RBAC or incomplete archive) |

The whole required set is checked at once; inspecting one table and inferring the rest is not sufficient. A rejected request returns HTTP 409 before any `TRUNCATE` or write, leaving the current database intact.

`scripts/verify-backup-roundtrip.ts` proves this against a real database: it backs up, restores into a temporary schema, and compares accounts, active states, roles, permissions, role membership, `system_admin` existence, readiness markers, business data, and password hashes — then confirms that pre-RBAC, incomplete, wrong-version, empty, and migration-bearing archives are all rejected with the database unchanged. Run it locally with `npx tsx --env-file=.env scripts/verify-backup-roundtrip.ts`; it refuses any non-local host.

## Restore contract

`POST` requires the literal confirmation `RESTORE DATABASE`, accepts at most 200 MB (the `database.restore.archive` upload slot, deliberately not admin-configurable), rejects archives containing migration-table data, extracts listed table data, then executes `TRUNCATE ... CASCADE` plus restore SQL in one PostgreSQL transaction with `ON_ERROR_STOP`. It assumes the target schema already matches the backup. A successful request must be followed by authenticated integrity checks.

Before any restore: stop writes or establish a maintenance window; make and verify a fresh backup of the exact target; confirm archive provenance and matching migrations; validate enough disk/temp space; and use the intended `DATABASE_URL`. The application provides no maintenance lock or concurrent-write prevention while restore runs, and the operation does not create an `AuditLog` entry (TD-010). Restore is destructive even though transaction failure is intended to preserve the prior state. Do not use an untrusted archive: table names parsed from `pg_restore --list` are interpolated into generated SQL without an allowlist (TD-002).

There is no automated schedule, retention policy, off-site transfer, encryption workflow, or routinely tested disaster-recovery drill in this repository. Production backup operations may instead target the existing database container; its live procedure and destination must be verified on the host rather than assumed.

Restoring a production dump into a local database removes the development test account, since restore truncates the target tables. Re-create it with `npm run db:ensure-test-user` ([development](development.md)); never run that command against the production database.
