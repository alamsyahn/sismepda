# Development and verification

Requirements: Node/npm and PostgreSQL. Copy `.env.example` to untracked `.env` and set `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`; never document or commit their values.

```bash
npm install
npm run db:setup       # migrate dev + idempotent seed
npm run dev
```

For users without database-creation rights, use a dedicated schema query parameter such as `?schema=sismepda_local`; runtime and Prisma CLI both honor it. Generated Prisma client is under `app/generated/prisma/`.

Quality gates:

```bash
npm test               # tsx + Node test runner
npm run lint           # ESLint
npm run build          # Next production build and TypeScript
npx prisma validate
```

The current suite has unit/contract coverage for domain helpers and selected authorization behavior, not end-to-end browser/database coverage. Calendar tests must prove canonical date-only behavior under multiple host `TZ` values and explicitly test configured school zones such as `Asia/Jakarta`, `Asia/Makassar`, and `Asia/Jayapura`; host, browser, Docker, database-session, and VPS timezone must not change a business `YYYY-MM-DD`. Before a timestamp-to-`DATE` migration, audit every target column for non-midnight legacy values and key collisions; abort rather than infer ambiguous dates. After stopping Next development on Windows, verify no child process still owns port 3000.

Follow `.hermes.md`: documentation is read first and reviewed after every task; source inspection is targeted unless the user explicitly requests a full audit.
