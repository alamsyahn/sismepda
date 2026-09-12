# Deployment architecture

The repository describes a self-hosted production deployment that reuses existing infrastructure:

```text
Internet → shared `edge-caddy-1` (80/443, TLS)
         → external Docker network `edge`, alias `sismepda-new-app`
         → SISMEPDA app container :3000
         → external network `sismepda-dashboard_internal`
         → existing PostgreSQL service alias `db`:5432
```

`compose.yaml` defines `app` and a profile-gated `migrate` service; it does not define or publish PostgreSQL. `compose.edge.yaml` attaches only the app to the shared edge network and intentionally retains a transitional alias distinct from the old deployment. No application port is published. Shared Caddy must route the production hostname to `sismepda-new-app:3000`; the root `Caddyfile` is a generic standalone example (`app:3000`), not automatically part of this Compose stack.

The multi-stage `Dockerfile` uses Node 24 Bookworm Slim. It installs dependencies with npm/package-lock, generates Prisma, builds Next standalone, supplies a migrator stage, and installs PostgreSQL client 17 in the non-root runtime image for in-app backup/restore. The health check requests `/login` every 15 seconds. Runtime variables are `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `AUTH_URL`, and `NEXTAUTH_URL`; Compose derives URLs from `DOMAIN`. Migration additionally needs seed admin variables. The RBAC legacy backfill (`npm run db:rbac-backfill --apply --database=<name>`) is **not** part of the migrator; it is a one-time operator step of the Phase 4 cutover, run after `migrate deploy && db seed` and before any RBAC-guarded surface goes live (see `architecture/rbac.md`, Readiness).

There is no repository CI/CD workflow or automated deployment, backup schedule, external backup transfer, metrics, or centralized logging. Production infrastructure behavior, DNS/TLS state, live image/container versions, and rollback assets cannot be proven from repository files alone.
