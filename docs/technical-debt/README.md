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

## TD-008 — ADMIN role can remain stale in an existing JWT

- **Area / severity:** Authorization — **High**
- **Current condition:** `requireUser()` re-reads only `active` and returns the session/JWT user; `requireAdmin()` authorizes using that JWT role. Role changes are refreshed only on an Auth.js session update trigger.
- **Evidence:** `auth.ts` (JWT/session callbacks and 30-day maximum age); `lib/auth-guards.ts:4-15`.
- **Impact:** A user demoted from ADMIN can retain ADMIN-only access until the token is refreshed or expires, although deactivation takes effect immediately.
- **Reason:** Active-state revocation and granular capabilities were made database-current, but global role authorization still trusts session state.
- **Direction:** Resolve current role from PostgreSQL in the shared guard, or introduce reliable token/session revocation on role changes.
- **Exit criteria:** Integration tests prove ADMIN→GURU demotion immediately blocks existing sessions from every ADMIN page and API while legitimate sessions continue to work.

## TD-009 — Teacher deletion is blocked by recorded violation points

- **Area / severity:** User lifecycle/data integrity — **High**
- **Current condition:** Teacher deletion reassigns attendance submissions, then deletes the user, but does not handle `StudentViolationPoint.recordedById`, whose foreign key restricts deletion.
- **Evidence:** `app/api/admin/teachers/route.ts:99-123`; `prisma/schema.prisma:144-154`.
- **Impact:** Permanent deletion returns a generic failure for any teacher who has recorded a violation point, leaving the advertised lifecycle incomplete.
- **Reason:** Submission ownership was explicitly reassigned, while violation-point provenance added later has no deletion policy.
- **Direction:** Define a provenance-preserving policy such as nullable recorder with `SetNull`, reassignment, or prohibiting deletion with a precise explanation.
- **Exit criteria:** Database-backed tests cover a teacher with violation points; deletion either succeeds under the documented provenance policy or is predictably rejected before the transaction with an actionable response.

## TD-010 — Destructive restore lacks maintenance lock and audit record

- **Area / severity:** Backup/restore — **High**
- **Current condition:** The ADMIN restore endpoint truncates and reloads application tables while the app may remain writable; it does not append an `AuditLog` record.
- **Evidence:** `app/api/admin/database/route.ts:42-72`; `lib/audit-log.ts` action/entity list.
- **Impact:** Concurrent writes can conflict with a recovery operation, and there is no durable application record of who initiated a destructive restore.
- **Reason:** Restore is implemented as an on-demand web operation without an application maintenance state or restore-specific audit event.
- **Direction:** Require a controlled maintenance mode, prevent concurrent writes, and record initiation/result with actor and backup metadata that does not expose secrets.
- **Exit criteria:** Integration tests show writes are blocked during restore, success/failure is auditable, and transaction failure leaves prior data intact.

## TD-011 — KMS growth charts have no official reference dataset

- **Area / severity:** E-UKS health data — **High**
- **Current condition:** The KMS section of `/e-uks/pantauan-kesehatan` is specified to plot a student's height and weight against standard growth bands, but the repository contains no reference dataset for those bands.
- **Evidence:** `docs/design/e-uks/06-pantauan-kesehatan-kms.png` is a photograph of a printed KMS card and is not a usable data source; `docs/features/e-uks.md` records the requirement.
- **Impact:** Without an authoritative source the curves cannot be implemented at all — invented, interpolated or screenshot-derived values would present fabricated medical guidance to teachers and parents.
- **Reason:** The wireframe defines the intended UI, while the medical reference data was never specified.
- **Direction:** Obtain an official LMS/standard-deviation dataset (WHO growth reference 5-19 years, or the Kemenkes tables) with a recorded citation, store it as versioned reference data, and select the curve by student sex once `Student` carries that attribute.
- **Exit criteria:** Reference values are loaded from a cited dataset, unit tests verify known reference points against the published tables, and the chart renders an explicit empty state whenever the dataset is unavailable.


## TD-012 — Student has no birth date or sex, blocking BMI-for-age

- **Area / severity:** E-UKS health data — **High**
- **Current condition:** `/e-uks/pantauan-kesehatan` shows "Status Gizi (berdasarkan IMT)" as "Belum dapat ditentukan" because `nutritionStatus()` cannot classify without them.
- **Evidence:** `model Student` in `prisma/schema.prisma` has only `nis`, `nisn`, `name`, `active`, `classId`; a repository-wide search for `gender`/`birthDate`/`tanggalLahir` returns no matches.
- **Impact:** Nutritional status and the KMS charts cannot be computed. BMI-for-age needs age in months and sex; adult cut-offs (18.5/25/30) are clinically invalid for school-age children, so no classification can be shown at all.
- **Reason:** SISMEPDA was built for attendance, where student demographics were never required.
- **Direction:** Add `birthDate` (`@db.Date`) and a `gender` enum to `Student` as nullable columns, expose them in the existing student management forms and import, then compute age in months at measurement date.
- **Exit criteria:** Both fields exist and are populated for active students, `nutritionStatus()` classifies against the TD-011 reference dataset, and students still missing the data render an explicit empty state rather than a wrong category.
