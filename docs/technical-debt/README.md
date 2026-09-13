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
- **Current condition:** Table names parsed from an uploaded `pg_restore --list` are quoted but interpolated into generated `TRUNCATE` SQL; compatibility is checked only by presence/absence rules.
- **Evidence:** `app/api/admin/database/route.ts:60-68`.
- **Impact:** A malicious or malformed archive presented by an ADMIN could target unexpected tables or make restoration behavior unsafe; restore is inherently destructive.
- **Reason:** Restore supports generic data-only archives rather than a manifest of expected SISMEPDA tables.
- **Direction:** Validate archive format/version and require every table against an explicit schema-derived allowlist before generating SQL.
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
- **Current condition:** No CI/CD, automated backup schedule/retention/off-site copy, restore drill, centralized logs, metrics, alerts, or repository-verifiable rollback procedure exists.
- **Evidence:** `compose*.yaml`, `Dockerfile`, `README.md`; no `.github/workflows` or monitoring/backup scheduler configuration.
- **Impact:** Failures, data loss and bad releases may be detected late and recovered inconsistently.
- **Reason:** Deployment depends on external shared VPS infrastructure that is not managed in this repository.
- **Direction:** Establish owner-approved backup/retention/off-site policy, recurring restore test, release/image versioning, health/alerting and a tested rollback runbook.
- **Exit criteria:** Scheduled artifacts and retention are observable, a restore drill is recorded operationally, alerts are exercised, and an application/database rollback rehearsal succeeds.

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
- **Current condition:** Every application surface authorizes through `lib/rbac-access.ts` against the current database. `requireAdmin()` and `lib/auth-guards.ts` were deleted. The pure helpers in `lib/euks.ts`, `lib/sarpras.ts`, `lib/workbook.ts`, `lib/teacher-profile.ts` still contain "ADMIN always passes" logic, but a repo-wide grep confirms **zero runtime call sites** — they are referenced only by their own definitions, by `lib/rbac-legacy.ts` and by tests. Legacy columns are no longer read for *population* either: `teacherPopulationWhere()` and `readSupervisionOverview()` now select on `isTeacher` alone, and `NavViewer` no longer accepts legacy fields. `User.role` and the `can*` columns remain written by existing UIs (`/api/workbooks/scope`) and read by `lib/rbac-legacy.ts` for backfill parity.
- **Evidence:** `lib/euks.ts:31`; `lib/sarpras.ts:32`; `lib/workbook.ts:150`; `lib/teacher-profile.ts:44`; writer at `app/api/workbooks/scope/route.ts:37-39`.
- **Impact:** No live authorization impact and no live population impact. The remaining risk is future regression: a new handler could import one of these helpers and silently reintroduce JWT-role authority.
- **Reason:** The columns are retained through one release cycle so the backfill remains re-verifiable; deleting the dead helpers early would break the parity mapping and its tests.
- **Direction:** Once the backfill no longer needs to be re-verifiable, delete the dead helpers together with `User.role`, the `can*` columns and the `"Role"` enum, and migrate `/api/workbooks/scope` to RBAC.
- **Exit criteria:** No source file outside `lib/rbac-legacy.ts` and `tests/` mentions `user.role` or a `can*` column — **still unmet**: `app/api/workbooks/scope/route.ts` writes `canSuperviseWorkbooks`/`canViewWorkbookSupervision` — and the schema no longer carries those columns.

## TD-009 — Teacher deletion is blocked by recorded violation points

- **Area / severity:** User lifecycle/data integrity — **High**
- **Current condition:** The new RBAC account endpoint (`app/api/rbac/accounts/[userId]/route.ts` DELETE) resolves this via `lib/account-deletion.ts`: attendance is reassigned to the actor, and recorded violation points block deletion with an actionable 409 instead of a raw FK failure. The legacy teacher endpoint still deletes without that check and remains exposed. No violation point exists in production data yet (database check: 0 rows), so the legacy failure stays latent.
- **Evidence:** `app/api/admin/teachers/route.ts:115-136` (transaction clears `homeroomUserId` and reassigns `submittedById` only — still unguarded); `prisma/schema.prisma:189,196` (`recordedById String` with a non-nullable `recordedBy` relation); resolved path: `lib/account-deletion.ts` + `tests/account-deletion.test.ts`.
- **Impact:** Permanent deletion through the legacy teacher endpoint returns a generic HTTP 500 for any teacher who has recorded a violation point. Mutation testing confirmed this exact failure mode: with the guard removed, deletion returns 500 rather than an actionable message.
- **Reason:** Submission ownership was explicitly reassigned, while violation-point provenance added later has no deletion policy. The new endpoint adopted a policy; the legacy path predates it.
- **Direction:** Route legacy teacher deletion through `planAccountDeletion` so both paths share one provenance policy, then retire the duplicate deletion logic.
- **Exit criteria:** The legacy teacher endpoint also rejects (or handles) deletion of a teacher with recorded violation points predictably, before the transaction, with an actionable response — verified by a database-backed test.

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

