# Active technical debt

Only verified, unresolved engineering liabilities are listed here.

## TD-001 — In-process login rate limit

- **Area / severity:** Authentication — **High**
- **Current condition:** Attempts are stored in a process-local `Map` and client identity trusts forwarded headers.
- **Evidence:** `lib/login-rate-limit.ts`; `auth.ts`.
- **Impact:** Restart or horizontal replicas reset/split limits; incorrect proxy trust can let attackers vary the apparent IP, weakening brute-force protection.
- **Reason:** Lightweight single-instance implementation with no shared rate-limit store.
- **Direction:** Use a trusted-proxy-aware, shared durable limiter with atomic expiry/counters and operational monitoring.
- **Exit criteria:** Multi-instance/restart and spoofed-header tests demonstrate consistent limits; proxy hop trust is explicitly configured and documented.

## TD-002 — Restore archive identifiers are not allowlisted

- **Area / severity:** Backup/restore — **High**
- **Current condition:** Archive compatibility is now validated before any destructive statement: `lib/database-restore-preflight.ts` rejects unsupported formats, migration-bearing archives, empty archives, and archives missing any required RBAC table, and the route returns 409 before the first `TRUNCATE`. What remains unfixed is the identifier path — table names parsed from the uploaded `pg_restore --list` are quoted but still interpolated into generated `TRUNCATE` SQL without an explicit schema-derived allowlist.
- **Evidence:** `app/api/admin/database/route.ts` (preflight call precedes SQL generation; interpolation remains); `lib/database-restore-preflight.ts`; `tests/database-restore-preflight.test.ts`; `tests/database-restore-route.test.ts`; `scripts/verify-backup-roundtrip.ts` (20/20 against a real database).
- **Impact:** Reduced but not eliminated. Incompatible archives can no longer destroy access, yet an archive listing unexpected table names could still influence which tables appear in generated SQL.
- **Reason:** Preflight validates the *required* set is present; it does not yet reject *unexpected* identifiers outside a known allowlist.
- **Direction:** Require every parsed table to match an explicit schema-derived allowlist before generating SQL, and parse archive identifiers structurally rather than by regex (combine with TD-007).
- **Exit criteria:** Unknown/quoted/malformed identifiers are rejected by tests; only the complete compatible SISMEPDA table set can be truncated/restored.

## TD-003 — Attendance time/auto-lock settings are not enforced

- **Area / severity:** Attendance business rules — **Medium**
- **Current condition:** Open time, close time and `autoLock` are configurable; close time is used for on-time display, but `POST /api/attendance` permits writes regardless of the configured window.
- **Evidence:** `prisma/schema.prisma` (`SchoolSetting`); `app/api/admin/settings/route.ts`; `app/api/attendance/route.ts`; `app/api/dashboard/route.ts`.
- **Impact:** UI configuration can imply a restriction that the backend does not apply, allowing late/early edits contrary to operator expectations.
- **Reason:** Settings and reporting were implemented without a matching mutation guard.
- **Direction:** Decide the intended override policy, centralize configured-school-timezone window evaluation, enforce it server-side, and expose actionable errors.
- **Exit criteria:** Contract tests cover before/open/close/after, auto-lock off, ADMIN override decision, holidays and edits; documentation/UI match enforcement.

## TD-004 — Critical integration behavior lacks automated coverage

- **Area / severity:** Testing — **Medium**
- **Current condition:** The current unit/contract suite covers pure helpers and selected permission behavior, but there is no database-backed route suite or browser E2E coverage for login, class-scoped IDOR, destructive deletion, backup/restore, migrations, and major writes.
- **Evidence:** `package.json` test command; `tests/` contents; absence of E2E/CI configuration.
- **Impact:** Unit-clean changes can still regress middleware, session/database integration, transactional behavior or production flows.
- **Reason:** Test architecture is currently optimized for fast pure-domain tests.
- **Direction:** Add isolated PostgreSQL integration tests and a minimal authenticated E2E smoke suite, then run them in CI.
- **Exit criteria:** Automated clean-database migration/seed plus representative ADMIN/GURU allow/deny, write/read-back and destructive-operation tests run in CI.

## TD-005 — Production recovery and observability are manual/unproven

- **Area / severity:** Operations — **High**
- **Current condition:** Partially addressed. `npm run deploy:prod` now performs a verified predeploy `pg_dump` with 20-file retention, enforces build-before-migration, and fails with recovery metadata, so releases are repeatable and each one leaves a checked artifact. Still missing: a *scheduled* (not deploy-triggered) backup, off-site copy, a recorded restore drill, centralized logs, metrics, alerts, and a rehearsed rollback — the tooling deliberately performs no automatic rollback because reverting code against a migrated schema is unsafe.
- **Evidence:** `scripts/deploy.ts`, `lib/deployment.ts`, `lib/deployment-flow.ts`, `tests/deployment-orchestration.test.ts`, `docs/operations/deployment.md`; no `.github/workflows`, scheduler, or monitoring configuration.
- **Impact:** Failures, data loss and bad releases may be detected late and recovered inconsistently.
- **Reason:** Deployment depends on external shared VPS infrastructure that is not managed in this repository.
- **Direction:** Establish owner-approved backup/retention/off-site policy, recurring restore test, release/image versioning, health/alerting and a tested rollback runbook.
- **Exit criteria:** Scheduled (non-deploy) backup artifacts and retention are observable, a restore drill is recorded operationally, alerts are exercised, and an application/database rollback rehearsal succeeds.

## TD-006 — Student attendance history has no class snapshot

- **Area / severity:** Data integrity/reporting — **Medium**
- **Current condition:** `Attendance` links a student and day, while profile history displays the student's current class; there is no enrollment history or class-at-attendance snapshot.
- **Evidence:** `prisma/schema.prisma` (`Student`, `AttendanceDay`, `Attendance`); `lib/server-student-profile.ts`.
- **Impact:** After a class transfer, historical profile/export interpretation can attribute old attendance to the current class.
- **Reason:** The data model assumes one current class per student.
- **Direction:** Introduce effective-dated enrollment or an immutable class snapshot with a migration/backfill policy.
- **Exit criteria:** Historical reads resolve class as of the attendance date, transfer scenarios are tested, and exports/profile no longer infer past class from current membership.

## TD-007 — In-app backup/restore assumes the `public` schema

- **Area / severity:** Backup/restore — **High**
- **Current condition:** Runtime/Prisma supports a schema selected by `DATABASE_URL?schema=...`, but restore discovers tables only from archive lines matching `TABLE DATA public ...`; backup also passes the URL to `pg_dump` without an explicit schema contract.
- **Evidence:** `app/api/admin/database/route.ts:15-17,25-33,60-68`; `lib/database-config.ts`; `tests/database-config.test.ts`.
- **Impact:** A backup from a non-public SISMEPDA schema can be incomplete, rejected as containing no SISMEPDA tables, or unsuitable for the intended restore workflow.
- **Reason:** The backup feature was built for the production `public` schema while isolated-schema support was added for development/runtime access.
- **Direction:** Derive and explicitly select the configured schema for dump/restore, parse archive identifiers structurally, and combine this with the TD-002 table allowlist.
- **Exit criteria:** Database-backed tests successfully backup and restore both `public` and a named schema, reject cross-schema/unknown-table archives, and verify rollback on failure.

## TD-008 — Legacy role/capability columns still exist but no longer authorize

- **Area / severity:** Authorization — **Low**
- **Current condition:** Every application surface authorizes through `lib/rbac-access.ts` against the current database. `requireAdmin()` and `lib/auth-guards.ts` were deleted. The pure helpers in `lib/euks.ts`, `lib/sarpras.ts`, `lib/workbook.ts`, `lib/teacher-profile.ts` still contain "ADMIN always passes" logic, but a repo-wide grep confirms **zero runtime call sites** — they are referenced only by their own definitions, by `lib/rbac-legacy.ts` and by tests. Legacy columns are no longer read for *population* either: `teacherPopulationWhere()` is the single filter used by the teacher directory/profile (`lib/server-teacher-profile.ts`), workbook supervision (`lib/server-workbook.ts`) and the teacher schedule/duty routes, and `NavViewer` no longer accepts legacy fields. A repo-wide grep for `role: { in: [...] }` outside generated code and `lib/rbac-legacy.ts` returns nothing. `User.role` and the `can*` columns remain written by existing UIs (`/api/workbooks/scope`) and read by `lib/rbac-legacy.ts` for backfill parity.
- **Evidence:** `lib/euks.ts:31`; `lib/sarpras.ts:32`; `lib/workbook.ts:150`; `lib/teacher-profile.ts:44`; writer at `app/api/workbooks/scope/route.ts:37-39`.
- **Impact:** No live authorization impact and no live population impact. The remaining risk is future regression: a new handler could import one of these helpers and silently reintroduce JWT-role authority. `tests/authorization-inventory.test.ts` now guards that regression directly — it scans every file under `app/`, `lib/` and `components/` and fails on any `role === "ADMIN"` comparison, any read of a legacy capability flag, or any call to the dead helpers, outside an explicit allowlist that names each permitted use and its reason. A new offender fails the suite by default rather than passing unnoticed.
- **Reason:** The columns are retained through one release cycle so the backfill remains re-verifiable; deleting the dead helpers early would break the parity mapping and its tests.
- **Direction:** Once the backfill no longer needs to be re-verifiable, delete the dead helpers together with `User.role`, the `can*` columns and the `"Role"` enum, and migrate `/api/workbooks/scope` to RBAC.
- **Exit criteria:** Runtime source outside `lib/rbac-legacy.ts`, explicit compatibility writers, and tests no longer reads `User.role` or a `can*` column for authorization/population — **met**. Final closure additionally requires migrating the remaining compatibility writer (`app/api/workbooks/scope/route.ts`) and removing the columns/enum from the schema after one full live release cycle — intentionally not done in Phase 6.

## TD-010 — Destructive restore lacks maintenance lock and audit record

- **Area / severity:** Backup/restore — **High**
- **Current condition:** The ADMIN restore endpoint truncates and reloads application tables while the app may remain writable; it does not append an `AuditLog` record.
- **Evidence:** `app/api/admin/database/route.ts:42-72`; `lib/audit-log.ts` action/entity list.
- **Impact:** Concurrent writes can conflict with a recovery operation, and there is no durable application record of who initiated a destructive restore.
- **Reason:** Restore is implemented as an on-demand web operation without an application maintenance state or restore-specific audit event.
- **Direction:** Require a controlled maintenance mode, prevent concurrent writes, and record initiation/result with actor and backup metadata that does not expose secrets.
- **Exit criteria:** Integration tests show writes are blocked during restore, success/failure is auditable, and transaction failure leaves prior data intact.

## TD-011 — Two students still lack demographics for nutrition status

- **Area / severity:** E-UKS health data — **Low** (was Medium; the roster has since been filled in)
- **Current condition:** A database check reports **838 of 840 students carrying both `birthDate` and `gender`**. Two students remain without demographics, so `nutritionStatus()` returns `no_birth_date`/`no_gender` for those two only.
- **Evidence:** `birthDate`/`gender` on `model Student`, writable from `/siswa/input` (manual + CSV) and the `/siswa` edit dialog; `lib/euks.ts:149-180` distinguishes the missing-input reasons.
- **Impact:** Limited to two students, who render an explicit reason rather than a wrong category — the intended behaviour. Not an engineering liability; remaining work is operator data entry.
- **Reason:** SISMEPDA was built for attendance, where demographics were never required; the roster was filled in after the E-UKS build.
- **Direction:** Fill the two remaining students through the existing `/siswa` edit dialog.
- **Exit criteria:** All active students carry both fields; this entry is removed once the last two are filled in.
## TD-012 — Two route handlers map authorization failures to HTTP 400

- **Area / severity:** API contract — **Low**
- **Current condition:** `teacherErrorResponse` (`lib/teacher-access.ts:22-25`) and `workbookErrorResponse` (`lib/workbook-access.ts:38-41`) recognize only their own error class; every other error, including `UnauthorizedError`, `ForbiddenError` and `RbacNotReadyError`, falls through to `{ status: 400 }`. Used by `app/api/teachers/[teacherId]/duties/route.ts` and `.../schedule/route.ts`.
- **Evidence:** `lib/teacher-access.ts:22-25`, `lib/workbook-access.ts:38-41`. Compare `lib/euks-access.ts:15-21`, which delegates to `describeAuthFailure`.
- **Impact:** Enforcement is correct — unauthorized requests are still rejected — but clients and monitoring observe 400 instead of 401/403/503, contradicting the contract in `lib/api-errors.ts`.
- **Reason:** These two wrappers predate `lib/api-errors.ts` and were not revisited when the shared mapper landed in Phase 4.
- **Direction:** Route both wrappers through `describeAuthFailure` as the E-UKS wrapper does.
- **Exit criteria:** Both handlers return 401/403/503 for the corresponding failures, covered by a direct handler test.

## TD-013 — `/api/attendance-trend` validates before authorizing

- **Area / severity:** API contract / information disclosure — **Low**
- **Current condition:** `app/api/attendance-trend/route.ts:8-15` calls `readSchoolTimeZone()` and validates the range before authorization, which happens later inside `lib/server-attendance-trend.ts:51`.
- **Evidence:** `app/api/attendance-trend/route.ts:8-15`; `lib/server-attendance-trend.ts:36,51`.
- **Impact:** An unauthorized caller can trigger a `schoolSetting` read and receive a 409 revealing whether the academic-year configuration is valid. Attendance data itself stays protected.
- **Reason:** The handler was migrated in Phase 4 by delegating authorization to the loader rather than guarding at the entry point.
- **Direction:** Authorize at the top of the handler, as `PUT /api/admin/settings` now does, keeping the loader check as defence in depth.
- **Exit criteria:** An unauthorized request to `/api/attendance-trend` returns 401/403 without reading `schoolSetting`, proven by a direct handler test.

## TD-015 — Attendance conflicts on 2026-09-07 were resolved by policy, not by evidence

- **Area / severity:** Data integrity — **Medium**
- **Current condition:** The legacy date repair (see [local database workflow](../operations/local-database-workflow.md)) reconciles 15 colliding `(class, business date)` pairs on 2026-09-07. Eleven are exact duplicates and one (IX D) differs only in note wording, so both are mechanical. The remaining three — IX B / Azka Apriliano Putra (`ALFA` vs `SAKIT`), IX F / Chrisna Ramadansyah Viyunimo (`ALFA` vs `IZIN`), VII A / Abyan Fahrizanul Ikhsan (`HADIR` vs `SAKIT`) — carry genuinely different attendance, and the repair keeps the later-submitted row on the owner's instruction.
- **Evidence:** Read-only forensics on the clone found no corroboration for that choice. `AuditLog` holds 8 rows, all `WORKBOOK_*`, and none reference attendance. In all 15 pairs the `17:00:00` row was submitted second — a uniform pattern that indicates a write-behaviour change, not 15 independent corrections. On the three conflicts the later row has `updatedAt = submittedAt` (never edited after creation), and both rows carry the full class roster, so neither is a per-student correction. IX B's two rows were even submitted by different teachers.
- **Impact:** Three students may carry an attendance status that does not match what actually happened that day. The affected data is a single school day and the rows are otherwise complete. **This is now live production data:** the repair was applied to production on 2026-09-14 (15 collisions resolved, 15 rows discarded, 178 dates shifted), so the policy choice is no longer hypothetical and can only be corrected through the application.
- **Reason:** "Later" here means "entered afterwards", not "verified correct"; no history survived that records the true final status.
- **Direction:** Confirm the three statuses with the teachers who entered them — IX B: Krisna Purnawati, M.Pd and Muhammad Yoga Saputra, S.Pd; IX F: Aviana Trisepti Rusdiana, S.Pd; VII A: Miss Novita Hidayatun Nisa, S.Pd — and correct any that disagree before this data is trusted for reporting.
- **Exit criteria:** Each of the three 2026-09-07 statuses is confirmed or corrected against the entering teacher, recorded in the repair script, and the repair still reproduces on a fresh clone.

## TD-016 — Backup media belum terjadwal di produksi, dan byte legacy belum dipensiunkan

- **Area / severity:** Operations / data durability — **Medium**
- **Current condition:** Tooling backup media sudah ada dan terbukti bekerja secara lokal: `npm run media:backup:create` menghasilkan arsip `.tar.gz` bermanifest, `media:backup:verify` memeriksa keterbacaan + checksum + entri berbahaya, dan `media:backup:restore-test` mengekstrak ke direktori sementara. Yang **belum** ada: penjadwalan di produksi. `remoteBackupScript()` di `lib/deployment.ts` masih hanya mengarsipkan dump PostgreSQL, sehingga backup produksi belum mencakup volume `media`. Kolom `bytea` legacy juga masih terisi penuh di seluruh delapan sumber media.
- **Evidence:** `scripts/media-backup.ts` + `tests/media-operations.test.ts` (backup/verify/restore/traversal terbukti lokal); `lib/deployment.ts` `remoteBackupScript()` tanpa arsip media; `prisma/schema.prisma` masih memuat `photoData`/`logoData`/`appLogoData`/`faviconData`/`SarprasPhoto.data`.
- **Impact:** Selama penjadwalan belum ada, media yang diunggah **setelah** deploy hanya hidup di volume dan tidak tersalin ke backup mana pun. Media lama belum berisiko karena byte legacy-nya masih ikut di dump — sekaligus alasan ukuran dump belum berkurang sama sekali.
- **Reason:** Fase ini sengaja berhenti pada tooling + verifikasi lokal. Mengubah cron produksi dan menjalankan migrasi media produksi adalah operasi berisiko yang menunggu deployment runbook disetujui.
- **Direction:** Panggil `media:backup:create` berdampingan dengan dump PostgreSQL di `remoteBackupScript()`, verifikasi arsip hasil produksi dengan `media:backup:verify`, lakukan restore drill produksi, baru jalankan migrasi media produksi dan rencanakan fase CONTRACT.
- **Exit criteria:** Backup produksi menghasilkan dump database **dan** arsip media pada run yang berpasangan; arsip produksi terbukti lolos `media:backup:verify`; restore drill produksi pernah dilakukan; seluruh record media produksi punya kunci; keputusan penghapusan kolom bytea diambil eksplisit dengan persetujuan pemilik.
- **Sudah selesai (jangan diulang):** tooling backup/verify/restore, isolasi media root per peran, uji persistensi volume Docker (restart + recreate), dan smoke test browser jalur unggah baru.
