# Deployment and migration

Repository configuration targets the existing SMPN 2 Blitar shared Docker networks and edge proxy. Never infer that checked-in topology proves live production state; perform read-only VPS/DNS checks before a deployment and require an approved maintenance/cutover window.

1. Create untracked `.env.production` from `.env.production.example`, reusing the intended database credentials and stable `AUTH_SECRET` where session continuity is required. The file declares `COMPOSE_FILE=compose.yaml:compose.edge.yaml`, but production commands use both files explicitly so edge attachment never depends on Compose environment-file precedence.
2. Validate and build:
   ```bash
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production config
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production build
   ```
3. Back up the exact target database and verify the artifact before migration.
4. Inspect migration status, deploy migrations, then run the idempotent seed:
   ```bash
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production \
     --profile migration run --rm -T migrate \
     sh -c 'npx prisma migrate status && npx prisma migrate deploy && npx prisma db seed'
   ```
5. Start only the app and verify health/logs:
   ```bash
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production up -d app
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production ps
   docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production logs --tail=200 app
   ```
6. Separately back up, edit and validate shared edge Caddy; route the approved hostname to `sismepda-new-app:3000`, then verify DNS, HTTP→HTTPS, certificate hostname, login, authenticated reads and a reversible write/read-back.

Do not publish app/database ports or create duplicate Caddy/PostgreSQL services. `down` affects this Compose project but not external networks/data. Application rollback is image/config rollback; database migrations have no automated down path and may require restore. The repository has no CI/CD automation, deployment script, pinned image registry tag, or proven live rollback procedure.

## Migrator image contents

The migrator stage runs migrations, the seed, and the one-time legacy backfill. It therefore ships `prisma/`, `lib/`, `app/generated/`, `prisma.config.ts`, `package.json`, and `tsconfig.json`. The last one is required rather than incidental: `lib/rbac-backfill.ts` imports via the `@/*` path alias, which `tsx` resolves from `tsconfig.json`. Without it the backfill command fails with `MODULE_NOT_FOUND` inside the image. `tests/migrator-packaging.test.ts` locks this contract.

Production migration uses `prisma migrate deploy` only. `prisma migrate dev`, `prisma db push`, and `prisma migrate reset` are development-only (`npm run db:migrate`, `npm run db:setup`) and must never run against production.

The seed neither runs the legacy backfill nor writes a readiness marker, so a normal deploy or restart cannot silently re-grant revoked authority. The backfill is a separate explicit command; see `docs/operations/rbac-cutover.md` for the gated sequence, rollback limits, and session-continuity rules.
