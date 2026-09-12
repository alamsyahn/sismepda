# Development and verification

Requirements: Node/npm and PostgreSQL. Copy `.env.example` to untracked `.env` and set `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`; never document or commit their values.

```bash
npm install
npm run db:setup       # migrate dev + idempotent seed
npm run dev
```

For users without database-creation rights, use a dedicated schema query parameter such as `?schema=sismepda_local`; runtime and Prisma CLI both honor it. Generated Prisma client is under `app/generated/prisma/`.

## Local test account

`npm run db:ensure-test-user` (`scripts/ensure-local-test-user.ts`) guarantees exactly one development-only account for browser/E2E testing, separate from `prisma/seed.ts`. It is manual: run it after a production→local restore overwrote the local database, never on application start. Credentials come from the untracked `.env` (`ALLOW_LOCAL_TEST_USER`, `DEV_TEST_USER_EMAIL`, `DEV_TEST_USER_PASSWORD`, `DEV_TEST_USER_NAME`) and must never be committed or documented.

The account is created with `Role.ADMIN`, the highest value of the two-value `Role` enum, because ADMIN passes every delegated capability guard and therefore reaches all UI without schema changes. Behavior is idempotent: a missing account is created, an existing one is never duplicated and only minimally repaired (`active`, `role`, password hash) when it could no longer log in; no other column and no other table is touched.

Safety guards are pure functions in `lib/local-test-user.ts`, evaluated before any database connection opens, and all fail closed: `NODE_ENV` must not be `production`, `ALLOW_LOCAL_TEST_USER` must equal `"true"`, `DATABASE_URL` must parse as PostgreSQL with a local host and a development database name (the production name is not on the allowlist), and the email must use a reserved test domain. An unparsable `DATABASE_URL` aborts instead of falling back, so no path writes to production.

Quality gates:

```bash
npm test               # tsx + Node test runner
npm run lint           # ESLint
npm run build          # Next production build and TypeScript
npx prisma validate
```

The current suite has unit/contract coverage for domain helpers and selected authorization behavior, not end-to-end browser/database coverage. Calendar tests must prove canonical date-only behavior under multiple host `TZ` values and explicitly test configured school zones such as `Asia/Jakarta`, `Asia/Makassar`, and `Asia/Jayapura`; host, browser, Docker, database-session, and VPS timezone must not change a business `YYYY-MM-DD`. Before a timestamp-to-`DATE` migration, audit every target column for non-midnight legacy values and key collisions; abort rather than infer ambiguous dates. After stopping Next development on Windows, verify no child process still owns port 3000.

Follow `.hermes.md`: documentation is read first and reviewed after every task; source inspection is targeted unless the user explicitly requests a full audit.
