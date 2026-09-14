# Deployment and migration

## Live production topology (SMPN 2 Blitar)

The running deployment does **not** use `compose.yaml` + `compose.edge.yaml`. Those files target shared `edge`/`sismepda-dashboard_internal` networks that do not exist on this host; running them would build a second, parallel stack. Verify against the live host before every deployment rather than trusting checked-in topology.

| Item | Live value |
| --- | --- |
| SSH alias | `smpn2` |
| App directory | `/srv/apps/sismepda` |
| Compose file | `/srv/apps/sismepda/deploy.yaml` (untracked, host-specific, **not in Git**) |
| Env file | `/etc/sismepda/sismepda.env` (outside the repo, survives `git` operations) |
| Compose project | `sismepda` — containers `sismepda-app-1`, `sismepda-db-1` |
| Database | `sismepda` on `postgres:17.10-alpine`, user `sismepda` |
| App binding | `127.0.0.1:3001` |
| TLS / routing | **host-level Caddy** (`/etc/caddy/sites-enabled/`), not a container |
| Public URL | `https://app.smpn2blitar.sch.id` |

Because `deploy.yaml` and the env file live outside Git, `git` updates never restore them; treat them as server state and back them up with the database.

Every production command therefore takes the form:

```bash
cd /srv/apps/sismepda
docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env <subcommand>
```

## One-command deployment from Windows

Routine releases run from the local machine; there is no manual classification
of "UI", "backend", or "database" deployment.

```powershell
cd D:\sismepda
npm run deploy:check     # read-only preflight, local + remote
npm run deploy:prod      # the deployment itself
npm run deploy:prod -- --dry-run   # print the plan, contact nothing
npm run deploy:status    # read-only, fast
```

`scripts/deploy.ts` is the only entrypoint; it owns process execution and
nothing else. Decisions live in two testable modules: `lib/deployment.ts`
(pure — topology constants, remote script builders, parsers, secret redaction,
forbidden-command guard) and `lib/deployment-flow.ts` (orchestration against a
`DeploymentRunner` interface). Because every side effect passes through that
interface, `tests/deployment-orchestration.test.ts` proves the abort ordering
with a fake runner, touching neither SSH nor any database.

### Step order

```text
local preflight (branch main, clean tree, origin = alamsyahn/sismepda)
→ npm test + npm run lint + npm run build
→ git push origin main
→ production preflight (repo, deploy.yaml, env file, docker, db container, clean tree)
→ deployment lock
→ fresh database backup + verification
→ git merge --ff-only <exact local SHA>, HEAD verified equal
→ docker compose --profile migration build migrate app
→ npx prisma migrate deploy
→ docker compose up -d app
→ healthcheck (container running, health healthy, /login reachable)
```

Each failure stops the chain and the later steps never run. Exit codes are
distinct per stage (1 local, 2 production preflight, 3 lock, 4 backup, 5 source,
6 build, 7 migration, 8 activation, 9 healthcheck).

### Predeploy backup

Every deployment — including a UI-only one — takes a fresh backup **before**
production is modified. `pg_dump --format=custom --no-owner --no-privileges`
runs *inside* the database container using the container's own local
authentication, so no password appears in an argument, an environment variable
sent over SSH, or a log; database and user names are read from the container's
`POSTGRES_DB`/`POSTGRES_USER`. The artifact is written to
`/srv/backups/sismepda/predeploy/YYYY-MM-DD_HH-mm-ss_<short-commit>.dump` (UTC,
so lexical order equals chronological order) and accepted only after exit code,
existence, size, and `pg_restore --list` all pass. Retention keeps the newest 20
files matching the predeploy filename pattern inside that directory only; no
other backup is ever touched. A failed backup aborts with
`Production application was not modified.`

### Concurrency lock

`mkdir /srv/apps/sismepda/.deploy.lock` is atomic, so a second deployment aborts
instead of interleaving. The lock is always released in a `finally` block. A
lock older than 90 minutes is *reported* as stale with the manual `rmdir`
command — never removed automatically, since that would defeat the guarantee.

### Safety guarantees

Every generated remote script passes `assertRemoteCommandSafe` before execution.
It rejects `prisma migrate reset|dev`, `db push`, `db seed`, `compose down`,
`docker volume rm`, `docker system prune`, `git reset --hard`, `git clean -f`,
force push, `DROP DATABASE`, `TRUNCATE`, and the legacy RBAC backfill. Commit
SHAs must match `^[0-9a-f]{40}$` before entering a remote command, backup
filenames are pattern-checked, and every dynamic value is POSIX-quoted. Scripts
are piped to `bash -s` over stdin rather than passed as arguments.

All printed output passes through `redactSecrets`, which masks connection URLs
and any `*SECRET*`/`*PASSWORD*`/`*TOKEN*`/`DATABASE_URL` assignment.

Deployment tooling never reads `.env.local` or any prodclone configuration.
`dev:local`, `dev:prodclone`, and `db:refresh-prodclone` remain entirely
separate; **prodclone is never sent back to production** — the sync direction is
production → local only.

### When something fails

| Stage | Effect |
| --- | --- |
| Local validation | Nothing is pushed, no SSH command is issued |
| Backup | Source, migration, and app are untouched |
| Build | Database unchanged, old app still running |
| Migration | New app is not started; backup path and previous commit are printed; no automatic seed, reset, or restore |
| Activation/health | Non-zero exit with attempted commit, previous commit, backup path, container state and recent app logs |

There is deliberately no automatic code rollback: reverting code against an
already-migrated schema is not safe in general, so the tooling fails with
recovery metadata instead and leaves the decision to the operator.

## Fresh-database bootstrap (not part of a deploy)

The migrator image and `compose.yaml` now run `npx prisma migrate deploy` only.
Seeding a **new** database is an explicit, separate operator step:

```bash
docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env \
  --profile migration run --rm --entrypoint sh migrate -c 'npx prisma db seed'
```

Release-specific data backfills follow the same rule: they are explicit,
versioned operator commands (see `docs/operations/rbac-cutover.md`), never an
auto-run over everything in `scripts/`.

## Manual cutover sequence

`npm run deploy:prod` covers routine releases. This manual sequence remains the
reference for a gated cutover that needs operator judgement between steps (a
rehearsed migration, an RBAC backfill, a legacy date repair).

Build before any database mutation — a failed build then costs nothing, because the database is still untouched.

1. Back up the exact target database and verify the artifact (`pg_restore -l` + checksum) before anything else. See `docs/operations/backup-restore.md`.
2. Rehearse against a **fresh** production snapshot (`npm run db:refresh-prodclone -- --keep-dump`). An older clone is not a valid rehearsal once new entries exist.
3. Update source with `git merge --ff-only origin/main`. Never force-reset; rollback of source must stay possible.
4. Build both images, still before database mutation:
   ```bash
   docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env --profile migration build migrate app
   ```
5. Stop the app writer, leaving the database running:
   ```bash
   docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env stop app
   ```
6. Inspect migration status (read-only), then run each gate **separately** rather than chaining `migrate deploy && db seed`, so each step is observable:
   ```bash
   docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env \
     --profile migration run --rm --entrypoint sh migrate -c 'npx prisma migrate status'
   ```
7. Legacy business-date repair (before the date-only migration) — the mechanics and collision rules are documented in [local database workflow](local-database-workflow.md).
8. `npx prisma migrate deploy`, then re-check status.
9. `npx prisma db seed` — **only** when bootstrapping a fresh database. It is not part of a normal release and is no longer chained to `migrate deploy`.
10. RBAC backfill if still required — see `docs/operations/rbac-cutover.md`.
11. Start the app and verify health, logs, restart count:
    ```bash
    docker compose -f deploy.yaml --env-file /etc/sismepda/sismepda.env up -d app
    ```

Do not publish app/database ports or create duplicate Caddy/PostgreSQL services. Application rollback is image/config rollback; database migrations have no automated down path and may require restore. The repository has no CI/CD automation, pinned image registry tag, or proven live rollback procedure.

### Running SQL files against the production container

Piping SQL over an SSH heredoc conflicts with `psql`'s own stdin: the outer heredoc consumes the input and the statement silently never runs, while the surrounding command still reports success. Copy the file into the container instead, and check the exit code explicitly:

```bash
docker cp prisma/legacy-date-repair.sql sismepda-db-1:/tmp/repair.sql
docker exec sismepda-db-1 psql -U sismepda -d sismepda -v ON_ERROR_STOP=1 -f /tmp/repair.sql
```

Always confirm a mutation by re-reading row counts afterwards; never infer that it committed from a zero exit status alone.

## Build must not require a database

`next build` prerenders any page that has not touched a dynamic API. Authorized pages stay dynamic only because `getAuthorizationContext()` calls `requireUser()` (which reads cookies via `auth()`) **before** it issues the RBAC readiness query. If that order is reversed, the build runs Prisma queries inside the Docker builder stage — which has no database access — and fails with `Can't reach database server` on pages such as `/bos`. `tests/deployment-contract.test.ts` pins the ordering; see `docs/architecture/rbac.md`.

## Migrator image contents

The migrator stage runs migrations, the seed, and the one-time legacy backfill. It therefore ships `prisma/`, `lib/`, `app/generated/`, `prisma.config.ts`, `package.json`, and `tsconfig.json`. The last one is required rather than incidental: `lib/rbac-backfill.ts` imports via the `@/*` path alias, which `tsx` resolves from `tsconfig.json`. Without it the backfill command fails with `MODULE_NOT_FOUND` inside the image. `tests/migrator-packaging.test.ts` locks this contract.

The migrator's default command is `npx prisma migrate deploy` alone; seeding is a separate explicit invocation. Production migration uses `prisma migrate deploy` only. `prisma migrate dev`, `prisma db push`, and `prisma migrate reset` are development-only (`npm run db:migrate`, `npm run db:setup`) and must never run against production.

The seed neither runs the legacy backfill nor writes a readiness marker, so a normal deploy or restart cannot silently re-grant revoked authority. The backfill is a separate explicit command; see `docs/operations/rbac-cutover.md` for the gated sequence, rollback limits, and session-continuity rules.
