# Development and verification

Requirements: Node/npm and PostgreSQL. Copy `.env.example` to untracked `.env` and set `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`; never document or commit their values.

```bash
npm install
npm run db:setup       # migrate dev + idempotent seed
npm run db:rbac-backfill                            # RBAC legacy backfill, dry-run report
npm run db:rbac-backfill -- --apply --database=sismepda_dev   # apply once to the local DB
npm run dev
```

For users without database-creation rights, use a dedicated schema query parameter such as `?schema=sismepda_local`; runtime and Prisma CLI both honor it. Generated Prisma client is under `app/generated/prisma/`.

## Local test account

`npm run db:ensure-test-user` (`scripts/ensure-local-test-user.ts`) guarantees exactly one development-only account for browser/E2E testing, separate from `prisma/seed.ts`. It is manual: run it after a production→local restore overwrote the local database, never on application start. Credentials come from the untracked `.env` (`ALLOW_LOCAL_TEST_USER`, `DEV_TEST_USER_EMAIL`, `DEV_TEST_USER_PASSWORD`, `DEV_TEST_USER_NAME`) and must never be committed or documented.

The account is created with the legacy `role` column set to `ADMIN`, but that column is **not** what grants access: no module under `lib/` reads `LegacyRole` as an authorization path. Post-RBAC authority comes entirely from role membership, so the helper also ensures membership in the `system_admin` RBAC role. Without that step the account could log in yet hold zero permissions on a freshly bootstrapped local database (one that never ran the legacy backfill). Behavior is idempotent: a missing account is created, an existing one is never duplicated and only minimally repaired (`active`, `role`, password hash) when it could no longer log in, and role membership is upserted on the `(userId, roleId)` primary key. If the `system_admin` role does not exist yet, the helper exits nonzero and tells you to run `npm run db:seed` first rather than writing a half-configured account. `tests/local-test-user-rbac.test.ts` locks this contract, including that neither `prisma/seed.ts` nor `prisma/seed-rbac.ts` ever calls the helper.

Safety guards are pure functions in `lib/local-test-user.ts`, evaluated before any database connection opens, and all fail closed: `NODE_ENV` must not be `production`, `ALLOW_LOCAL_TEST_USER` must equal `"true"`, `DATABASE_URL` must parse as PostgreSQL with a local host and a development database name (the production name is not on the allowlist), and the email must use a reserved test domain. An unparsable `DATABASE_URL` aborts instead of falling back, so no path writes to production.

## Production dump into a local database

Sync direction is always production → local. Never modify production to match local, and never restore a data-only archive blindly across schema versions — the archive carries rows, not the schema they were written against.

If the dump is **pre-RBAC** (taken before the RBAC migrations shipped), it has no `UserRole`/`RolePermission`/`RbacMigration` data, so restoring it into a post-RBAC local database leaves zero role membership and no usable account. Use the forward path instead:

1. Restore into a database/schema matching the dump's own legacy version, so the archive and the schema agree.
2. Apply the forward migration: `npx prisma migrate deploy` (locally `npm run db:migrate` is also acceptable since it is a development database).
3. Seed the RBAC registry and templates: `npm run db:seed`.
4. Run the one-time backfill against the local database, dry-run first:
   ```bash
   npx tsx --env-file=.env prisma/rbac-backfill-legacy.ts
   npx tsx --env-file=.env prisma/rbac-backfill-legacy.ts --apply --database=sismepda_dev
   ```
   `--apply` refuses to run unless the named database matches `current_database()`.
5. Re-create the local test account: `npm run db:ensure-test-user`.

If the dump is already **post-RBAC**, the in-app restore path applies and its preflight will confirm compatibility; see [backup and restore](backup-restore.md).

## Synthetic E-UKS test data (development only)

> **WARNING: synthetic E-UKS scripts MUST NEVER target production.** Sync direction is always production → local; nothing here ever writes to, uploads to, or reads from production.

The local database is periodically overwritten by a fresh production dump. Refresh workflow:

1. Back up / download the production database.
2. Restore it into the local development database.
3. Confirm `DATABASE_URL` points at development.
4. `npm run dev:bootstrap` — verifies the target, ensures the local test account, then generates data.

```bash
npm run dev:bootstrap                 # test account + synthetic E-UKS
npm run dev:euks-seed                 # only generate E-UKS data
npm run dev:euks-seed -- --seed=12345 # reproducible dataset
npm run dev:euks-clear                # remove only synthetic E-UKS data
```

`scripts/generate-euks-test-data.ts` uses the real students already in the local database and never creates, deletes, or deactivates a student. It writes `EuksVisit` and `StudentHealthMeasurement` rows, and fills `Student.gender`/`birthDate` only where they are still empty. Heights never decrease, weight drifts gradually, BMI is derived from the pair, visit dates avoid holidays via the existing calendar rules, and gender-specific content (menstrual complaints, iron tablets) is never given to male students. Runs are reproducible: `--seed` fixes the dataset, and without it the generated seed is printed. Without a seed argument the dataset differs per run, so record the printed seed when reporting a UI bug.

Re-running is idempotent: synthetic rows are cleared before regenerating, so nothing accumulates. `npm run dev:euks-clear` deletes only rows marked synthetic and resets only generator-filled demographics; real E-UKS entries, students, attendance, accounts, and settings are untouched.

Guards live in `lib/euks-test-data.ts` as pure functions evaluated before any connection opens, and all fail closed: `NODE_ENV` must not be `production`; `ALLOW_EUKS_TEST_DATA` must equal `"true"`; `DATABASE_URL` must parse as PostgreSQL with a local host and a database name matching `EXPECTED_DEV_DATABASE_NAME`. Docker service names and remote hosts are rejected, and after connecting the scripts re-check `current_database()` against the plan before writing. Any refusal prints `REFUSED: Synthetic E-UKS generation is not allowed for this database.` and performs no writes. These scripts are never invoked by `prisma db seed`, migrations, `npm run build`, Docker startup, or CI; they only run when you invoke them.

Quality gates:

```bash
npm test               # tsx + Node test runner
npm run lint           # ESLint
npm run build          # Next production build and TypeScript
npx prisma validate
```

The current suite has unit/contract coverage for domain helpers and selected authorization behavior, not end-to-end browser/database coverage. Calendar tests must prove canonical date-only behavior under multiple host `TZ` values and explicitly test configured school zones such as `Asia/Jakarta`, `Asia/Makassar`, and `Asia/Jayapura`; host, browser, Docker, database-session, and VPS timezone must not change a business `YYYY-MM-DD`. Before a timestamp-to-`DATE` migration, audit every target column for non-midnight legacy values and key collisions; abort rather than infer ambiguous dates. After stopping Next development on Windows, verify no child process still owns port 3000.

Follow `.hermes.md`: documentation is read first and reviewed after every task; source inspection is targeted unless the user explicitly requests a full audit.
