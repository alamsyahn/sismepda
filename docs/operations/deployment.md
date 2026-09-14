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

## Cutover sequence

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
9. `npx prisma db seed`.
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

Production migration uses `prisma migrate deploy` only. `prisma migrate dev`, `prisma db push`, and `prisma migrate reset` are development-only (`npm run db:migrate`, `npm run db:setup`) and must never run against production.

The seed neither runs the legacy backfill nor writes a readiness marker, so a normal deploy or restart cannot silently re-grant revoked authority. The backfill is a separate explicit command; see `docs/operations/rbac-cutover.md` for the gated sequence, rollback limits, and session-continuity rules.
