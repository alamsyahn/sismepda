# Development and verification

Requirements: Node/npm and PostgreSQL. Copy `.env.example` to untracked `.env` and set `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`; never document or commit their values.

```bash
npm install
npm run db:setup       # migrate dev + idempotent seed
npm run db:rbac-backfill                            # RBAC legacy backfill, dry-run report
npm run db:rbac-backfill -- --apply --database=sismepda_dev   # apply once to the local DB
npm run dev:local      # development database, target printed before Next starts
```

For users without database-creation rights, use a dedicated schema query parameter such as `?schema=sismepda_local`; runtime and Prisma CLI both honor it. Generated Prisma client is under `app/generated/prisma/`.

Two local databases exist and are selected by script, not by editing `.env`: `npm run dev:local` (persistent `sismepda_dev`) and `npm run dev:prodclone` (disposable clone of production). Bare `npm run dev` still reads `.env` directly with no guard. See [local database workflow](local-database-workflow.md) for roles, guardrails, and the clone refresh command.

## Local test account

`npm run db:ensure-test-user` (`scripts/ensure-local-test-user.ts`) guarantees exactly one development-only account for browser/E2E testing, separate from `prisma/seed.ts`. It is manual: run it after a production→local restore overwrote the local database, never on application start. Credentials come from the untracked `.env` (`ALLOW_LOCAL_TEST_USER`, `DEV_TEST_USER_EMAIL`, `DEV_TEST_USER_PASSWORD`, `DEV_TEST_USER_NAME`) and must never be committed or documented.

The account is created with the legacy `role` column set to `ADMIN`, but that column is **not** what grants access: no module under `lib/` reads `LegacyRole` as an authorization path. Post-RBAC authority comes entirely from role membership, so the helper also ensures membership in the `system_admin` RBAC role. Without that step the account could log in yet hold zero permissions on a freshly bootstrapped local database (one that never ran the legacy backfill). Behavior is idempotent: a missing account is created, an existing one is never duplicated and only minimally repaired (`active`, `role`, password hash) when it could no longer log in, and role membership is upserted on the `(userId, roleId)` primary key. If the `system_admin` role does not exist yet, the helper exits nonzero and tells you to run `npm run db:seed` first rather than writing a half-configured account. `tests/local-test-user-rbac.test.ts` locks this contract, including that neither `prisma/seed.ts` nor `prisma/seed-rbac.ts` ever calls the helper.

Safety guards are pure functions in `lib/local-test-user.ts`, evaluated before any database connection opens, and all fail closed: `NODE_ENV` must not be `production`, `ALLOW_LOCAL_TEST_USER` must equal `"true"`, `DATABASE_URL` must parse as PostgreSQL with a local host and a development database name (the production name is not on the allowlist), and the email must use a reserved test domain. An unparsable `DATABASE_URL` aborts instead of falling back, so no path writes to production.

## Production dump into a local database

Sync direction is always production → local. Never modify production to match local, and never restore a data-only archive blindly across schema versions — the archive carries rows, not the schema they were written against.

`npm run db:refresh-prodclone` automates this forward path into the disposable clone: dump → restore → `prisma migrate deploy` → RBAC seed → legacy backfill → local test account, with guards that refuse any target that is not the local clone. See [local database workflow](local-database-workflow.md); do not reconstruct the steps by hand.

The archive's own version still decides the path. A **pre-RBAC** dump has no `UserRole`/`RolePermission`/`RbacMigration` rows, so restoring it into a post-RBAC database leaves zero role membership and no usable account — which is why the refresh restores into an empty database first and only then migrates forward. `--apply` on the backfill refuses to run unless the named database matches `current_database()`.

If the dump is already **post-RBAC**, the in-app restore path applies and its preflight will confirm compatibility; see [backup and restore](backup-restore.md).

## Synthetic E-UKS test data (development only)

> **WARNING: synthetic E-UKS scripts MUST NEVER target production.** Sync direction is always production → local; nothing here ever writes to, uploads to, or reads from production.

Synthetic data belongs to the development database. `npm run db:refresh-prodclone` deliberately does **not** generate it: the clone represents production data on the latest schema, nothing else. Run the generator explicitly if a clone needs fixtures.

`npm run dev:bootstrap` verifies the target, ensures the local test account, then generates data.

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
