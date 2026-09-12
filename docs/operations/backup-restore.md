# Backup and restore

ADMIN can download/restore database data from `/pengaturan` through `/api/admin/database`. The runtime image includes PostgreSQL client 17.

## Backup contract

`GET` runs `pg_dump` custom format, data-only, without owner/privileges, excluding `_prisma_migrations`; the temporary file is returned as `sismepda-backup-<UTC timestamp>.dump` and deleted server-side. This is a logical data backup, not a schema/migration backup. Save it off the app/VPS and record which code/migration version produced it.

The current archive parser recognizes only `TABLE DATA public ...`. Although application/Prisma access supports a `?schema=` parameter for isolated development schemas, in-app backup/restore is therefore supported only for a database whose SISMEPDA tables are in `public`; do not use it for `?schema=<non-public>` targets (TD-007).

## Restore contract

`POST` requires the literal confirmation `RESTORE DATABASE`, accepts at most 200 MB, rejects archives containing migration-table data, extracts listed table data, then executes `TRUNCATE ... CASCADE` plus restore SQL in one PostgreSQL transaction with `ON_ERROR_STOP`. It assumes the target schema already matches the backup. A successful request must be followed by authenticated integrity checks.

Before any restore: stop writes or establish a maintenance window; make and verify a fresh backup of the exact target; confirm archive provenance and matching migrations; validate enough disk/temp space; and use the intended `DATABASE_URL`. The application provides no maintenance lock or concurrent-write prevention while restore runs, and the operation does not create an `AuditLog` entry (TD-010). Restore is destructive even though transaction failure is intended to preserve the prior state. Do not use an untrusted archive: table names parsed from `pg_restore --list` are interpolated into generated SQL without an allowlist (TD-002).

There is no automated schedule, retention policy, off-site transfer, encryption workflow, or routinely tested disaster-recovery drill in this repository. Production backup operations may instead target the existing database container; its live procedure and destination must be verified on the host rather than assumed.

Restoring a production dump into a local database removes the development test account, since restore truncates the target tables. Re-create it with `npm run db:ensure-test-user` ([development](development.md)); never run that command against the production database.
