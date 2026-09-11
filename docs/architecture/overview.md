# System overview

SISMEPDA is a single Next.js 16 App Router application for school operations. React 19 server/client components provide the UI; route handlers and server modules form the backend; Prisma 7 with the `pg` adapter owns one PostgreSQL database. There is no separate API service, message broker, object store, background worker, scheduled job, or application cache.

## Boundaries and flow

```text
Browser → Next.js proxy/auth gate → page or /api route
                              → domain/access helper
                              → PrismaPg → PostgreSQL
Production: Internet → shared edge Caddy → app:3000 → shared internal DB network → db:5432
```

- `app/`: pages and 37 API route-handler files under `app/api`, plus non-API handlers for branding assets. Pages combine server rendering with client components that call JSON/multipart/download endpoints.
- `components/`: feature UI and Base UI-backed shadcn primitives.
- `lib/server-*.ts`: server-only reads/aggregations; `lib/prisma.ts` is the database boundary.
- `lib/*.ts`: domain rules, validation helpers, navigation, exports and access policy. Client-safe modules must not import server modules or `lib/prisma.ts`.
- `prisma/schema.prisma` and `prisma/migrations/`: current model and forward history; generated client is written to `app/generated/prisma/` and ignored.
- `tests/`: Node test-runner unit/contract tests for pure domain logic and selected permission behavior. No browser E2E suite exists.

`lib/nav.ts` is the canonical navigation tree, but navigation visibility never grants access. Auth proxy and server-side guards enforce it. `SchoolSetting.timeZone` is the canonical IANA timezone for projecting real timestamps and deriving “today”; it defaults to `Asia/Jakarta` and is passed explicitly on the server or exposed through `SchoolTimeZoneProvider` on the client. Business date-only values never depend on that timezone and use `lib/school-date.ts`.

## Major modules

Attendance is the core shared dataset. Homeroom assignments determine the default GURU class scope used by dashboard, attendance, recaps, student profiles and attendance exports. Teacher data also feeds the directory, schedules and workbook supervision. Workbook, BOS and Sarpras use delegated boolean capabilities and the generic audit log. Branding/settings are single-row school configuration.

## Failure and observability model

Route handlers return Indonesian JSON errors and appropriate status codes where explicitly mapped; several older handlers catch broadly and collapse authentication, validation, and database failures. Operational logging is limited to `console.error` for branding and database backup/restore. There is no metrics, tracing, alerting, durable application log, or audit viewer for all entities.

## Important implementation constraints

- `Attendance` row absence means **Belum diisi**; it is not an enum value.
- Binary profile photos, branding images and Sarpras photos are stored in PostgreSQL.
- BOS documents and workbook artifacts are external `http`/`https` links only.
- Derived metrics (attendance rates, BOS balance, workbook completion, Sarpras status) are calculated, not persisted.
- `next.config.mjs` uses standalone output and unoptimized images.

See [authorization](authentication-authorization.md), [database](database.md), and each feature document for rules that must remain aligned.
