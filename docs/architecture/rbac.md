# Role-based access control (RBAC)

This document is the source of truth for the target authorization
architecture and for the inventory of every authority path in the current
source. It describes the design that all RBAC implementation phases must
converge on. Runtime behaviour that is not yet migrated is described in
[Authentication and authorization](authentication-authorization.md); the
"Current state" column of the inventory below records which guard each surface
uses today.

## Terminology

| Term | Meaning |
|---|---|
| Account | A `User` row that can authenticate (`active`, `passwordHash`). |
| Teacher identity | Whether the account is also a teacher record (directory, schedule, homeroom, workbook, E-UKS officer candidate). Target: `User.isTeacher`. Not an authorization concept. |
| Role | A named bundle of permissions (`RbacRole`). Users hold 0..n roles. |
| Permission | One concrete action the code supports, keyed `resource.action` or `resource.action.scope`. |
| Scope | Suffix that narrows a permission to a data subset (`assigned_classes`, `all`, `own`). |
| Policy | Per-surface declaration: `public`, `authenticated`, or a permission requirement. |
| Business attribute | Data that changes what the system does but is not an access decision (`workbookSupervised`, `EuksOfficer.role`, `SchoolSetting.allowTeachersAccessAllClasses`). |
| System admin | Member of the protected role `system_admin`; the only controlled bypass. |

## Model

Physical names avoid the existing PostgreSQL enum `"Role"` (`prisma/migrations/20260711170000_init`). The Prisma model is `RbacRole`; the other tables use their model names. The legacy enum keeps its physical type: its Prisma symbol was renamed to `LegacyRole` with `@@map("Role")`, so `User.role` and the PostgreSQL type are untouched.

**Implementation status.** Phases 2–4 have landed. The **core modules** (dashboard, attendance, recap/export, students, teachers, homerooms, workbook, navigation) now authorize exclusively through `requirePermission()` / `requireClassScopeFor()` against the current database. `User.role` and the boolean capability columns are still written by existing UIs and still read by the **not-yet-migrated modules** (BOS, Sarpras, E-UKS, settings, database backup) via `lib/*-access.ts`; they are no longer consulted by any core guard.

```text
RbacRole            id cuid PK · key text unique (lowercase, stable) · name text
                    description text? · isSystem bool · isProtected bool
                    version int (optimistic concurrency) · createdAt · updatedAt
Permission          id cuid PK · key text unique · resource · action · scope?
                    label · description? · module
                    unique (resource, action, scope); key must equal the join of the three
UserRole            userId FK User · roleId FK RbacRole · createdAt
                    PK (userId, roleId) · index roleId
RolePermission      roleId FK RbacRole · permissionId FK Permission
                    PK (roleId, permissionId) · index permissionId
User.isTeacher      Boolean @default(false)
```

Invariants:

1. Effective permission set = union of `RolePermission` over all of the user's roles. Nothing else contributes.
2. No default/implicit role in the evaluator. A user with no roles has no permissions.
3. No direct user→permission grants, no explicit DENY, no role hierarchy/inheritance, no role priority, no wildcard matching at runtime.
4. The permission catalog is code-owned: a permission key exists only if a surface checks it. Seeding inserts the catalog idempotently by key; the UI can only assign catalog entries to roles.
5. Unknown permission key → fail closed (including for `system_admin`). Unknown/missing policy on a protected surface → fail closed.
6. `system_admin` is `isSystem=true, isProtected=true`; it cannot be deleted, its `key`/`isSystem`/`isProtected` cannot be edited through the generic role payload, and the last active member cannot be removed (application check). Custom roles may not use a reserved key; a role named "Admin Sistem" that is not `system_admin` grants nothing special.
7. Role edits use `version` (compare-and-set); stale writes return 409.
8. Role/permission/assignment mutations are written to `AuditLog` (`entity` = `RbacRole` | `UserRole`, `targetUserId` for assignments).

## Permission semantics

- Key format: `resource.action` or `resource.action.scope`. `read` is the canonical verb for viewing. `write` covers create/update in one family unless the code exposes create and update as separately delegated operations (BOS does, so `bos.entries.create` and `bos.entries.update` stay separate).
- `manage` is a distinct action for administrative configuration of a resource (e.g. `rbac.roles.manage`, `euks.officers.manage`). It is not CRUD shorthand and implies nothing else.
- Nothing is implied: `read` does not imply `export`; `write` does not imply `read`; `manage` does not imply `read`. Role templates must list every key explicitly. Legacy rules such as "edit implies view" are reproduced by templates, not by the evaluator.
- Scopes never bleed between actions. `attendance.read.all` + `attendance.write.assigned_classes` never yields `attendance.write.all`. Each operation resolves its own scope: `all` if the user has `<family>.<action>.all`, else `assigned_classes` if the user has `<family>.<action>.assigned_classes`, else deny.
- `own` scope (`profile.*`, `workbook.links.update.own`) is satisfied by the session user id only; never by a client-supplied id.

## Class scope

- `assigned_classes` = classes where `SchoolClass.homeroomUserId = user.id` (database relation, resolved per request, applied as a Prisma `where` on `SchoolClass`/`Student.schoolClass`/`AttendanceDay.schoolClass`).
- `SchoolSetting.allowTeachersAccessAllClasses` widens `assigned_classes` to all classes only for the attendance family that already used it (`attendance.read/write/export`, `students.profile.read`, `students.violations.read/create`) and only when `user.isTeacher = true`. It never widens any other family and never grants a permission the user lacks.
- Lists, aggregates and exports are filtered query-side with the resolved `where`; no client-side filtering.
- Client-supplied `classId`/`studentId` is validated against the resolved scope through the entity's own class relation (`Student.classId`, `AttendanceDay.classId`), never through a class id echoed by the client.
- E-UKS, BOS, Sarpras, teachers, workbook are school-wide: their permissions carry no class scope and are unaffected by homeroom assignment.

## Identity separation

- `User.isTeacher` marks teacher records. Teacher directory, homeroom candidates, schedule/duty editing targets, workbook supervision population, E-UKS officer candidates and the `teachers` export select on `isTeacher = true`, not on role membership.
- Holding the `guru` role does not set `isTeacher`; having `isTeacher` does not grant permissions.
- `workbookSupervised` stays a business attribute (include in supervision population). `EuksOfficer.role` stays a free-text UKS position.
- `siswa` and `wali_murid` may exist as roles, but until a `User↔Student` link and a parent↔child resolver exist their templates hold only the authenticated-public set. No student/parent account creation path exists in HEAD.

## System admin

- Role key `system_admin`, initial name `Admin Sistem`; legacy `ADMIN` maps to it.
- Membership grants a controlled bypass: every permission check for a *known* catalog key passes. The bypass still requires an active account (`requireUser()`), never skips business validation (zod, invariants, confirmation identifiers), and never satisfies an unknown key.
- Class scope for a system admin resolves to `all` for every scoped family.

## Surface policy model

Every page, route handler, server loader and non-API handler carries exactly one policy:

- `public`: `/login`, `/api/auth/*` (Auth.js), static assets, `GET /app-logo`, `GET /favicon.ico`, `GET /site-branding.json`.
- `authenticated`: `/profil`, `/api/profile` (GET/PATCH), `/api/profile/password`, `/api/profile/photo` (GET/PUT/DELETE), sign-out, and the no-module landing at `/`.
- `permission(key[, scope])`: everything else.

Root `/` is authenticated but its dashboard data (`/api/dashboard`, server dashboard loaders) requires `attendance.dashboard.read.*`. A user without it receives a "Belum ada akses modul" landing that lists the modules they can open, without running dashboard queries. `/e-uks` remains `euks.overview.read` even though it renders as a unit profile page.

Guard order on a permission surface: `requireUser()` (session + `active` re-read) → resolve permission set from the database (never from the JWT) → check key → resolve scope → business validation. The JWT carries identity only; capabilities are not copied into the token.

## Permission catalog (derived from HEAD)

Every key below corresponds to at least one surface in the inventory. Keys are grouped by module; `scope` column lists the values that exist.

| Key | Scope values | Surfaces |
|---|---|---|
| `attendance.dashboard.read` | `assigned_classes`, `all` | `/`, `/api/dashboard`, `/rekap-sekolah` loaders (`getClassRecords`, `getAbsenceRanking`) |
| `attendance.reports.read` | `assigned_classes`, `all` | `/rekap-kelas`, `/rekap-siswa`, `/api/class-recap`, `/api/recap-students`, `/api/attendance-trend`, `readClassPeriodRecap`, `readAccessibleClassOptions`, `readAttendanceTrend` |
| `attendance.read` | `assigned_classes`, `all` | `GET /api/attendance` (roster/day for input page) |
| `attendance.write` | `assigned_classes`, `all` | `POST /api/attendance`, `/absensi/input` |
| `attendance.export` | `assigned_classes`, `all` | `/export-data`, `GET /api/export?type=attendance_students|attendance_classes`, `GET /api/class-recap/export` |
| `reports.whatsapp.read.all` | — | `/laporan-whatsapp`, `getWhatsAppReportClasses` (school-wide in HEAD; see ambiguity A3) |
| `students.master.read` | — | `/siswa`, `GET /api/admin/students` |
| `students.master.create` / `students.master.update` / `students.master.import` | — | `/siswa/input`, `POST/PATCH /api/admin/students` (bulk CSV import is a separate right from single create) |
| `students.master.delete` | — | `DELETE /api/admin/students` |
| `students.master.export` | — | `GET /api/export?type=students` |
| `students.profile.read` | `assigned_classes`, `all` | `/siswa/[studentId]`, `readStudentProfile` |
| `students.violations.create` | `assigned_classes`, `all` | `POST /api/students/[studentId]/violation-points` |
| `teachers.accounts.read` | — | `/guru`, `GET /api/admin/teachers` |
| `teachers.accounts.create` / `teachers.accounts.update` / `accounts.credentials.manage` / `accounts.status.manage` | — | `/guru/input`, `POST/PATCH /api/admin/teachers` (create, credentials, status, password reset) |
| `teachers.accounts.delete` | — | `DELETE /api/admin/teachers` |
| `teachers.accounts.export` | — | `GET /api/export?type=teachers` |
| `teachers.directory.read` | — | `/guru/direktori`, `/guru/[teacherId]` (view), `GET /api/teachers/[teacherId]/photo`, `readTeacherDirectory`, `readTeacherProfile` |
| `teachers.profile.update` | — | `PATCH /api/teachers/[teacherId]` (employment, position, TMT, subjects) |
| `teachers.duties.manage` | — | `POST/DELETE /api/teachers/[teacherId]/duties` |
| `teachers.schedule.manage` | — | `POST/DELETE /api/teachers/[teacherId]/schedule` |
| `homerooms.read` | — | `GET /api/admin/homerooms` |
| `homerooms.assign` | — | `/wali-kelas/input`, `PUT /api/admin/homerooms` |
| `homerooms.export` | — | `GET /api/export?type=homerooms` |
| `workbook.links.read.own` | `own` | `GET /api/workbooks/links`, `/profil` workbook panel |
| `workbook.links.update.own` | `own` | `PUT /api/workbooks/links` |
| `workbook.supervision.read` | — | `/supervisi-buku-kerja`, `readSupervisionOverview` |
| `workbook.supervision.review` | — | `PATCH /api/workbooks/status` |
| `workbook.scope.manage` | — | `/supervisi-buku-kerja/kelola`, `PATCH /api/workbooks/scope` (`workbookSupervised` + legacy supervision flags) |
| `bos.read` | — | `/bos`, page loaders |
| `bos.entries.create` | — | `POST /api/bos/entries`, `POST /api/bos/categories` (inline category creation while entering) |
| `bos.entries.update` | — | `PATCH /api/bos/entries/[entryId]` |
| `bos.budget.write` | — | `PATCH /api/bos/settings` |
| `bos.categories.manage` | — | `PATCH /api/bos/categories` |
| `bos.access.manage` | — | `/bos/akses`, `PATCH /api/bos/access` (legacy; superseded by `rbac.assignments.manage` once migrated) |
| `sarpras.read` | — | `/sarpras`, `GET /api/sarpras/history`, `GET /api/sarpras/photos`, `GET /api/sarpras/photos/[photoId]` |
| `sarpras.locations.write` | — | `POST/PATCH/DELETE /api/sarpras/locations` |
| `sarpras.item_types.write` | — | `POST/PATCH/DELETE /api/sarpras/item-types` |
| `sarpras.items.write` | — | `POST/PATCH/DELETE /api/sarpras/items` |
| `sarpras.photos.write` | — | `POST/DELETE /api/sarpras/photos` |
| `sarpras.access.manage` | — | `/sarpras/akses`, `PATCH /api/sarpras/access` (legacy; superseded by `rbac.assignments.manage`) |
| `euks.overview.read` | — | `/e-uks`, `readEuksSettings`, trend loaders, `GET` photo/logo handlers under `/api/e-uks/*` |
| `euks.visits.read` | — | `/e-uks/riwayat-kunjungan`, `readEuksVisits` |
| `euks.visits.write` | — | `POST /api/e-uks/visits`, `PATCH/DELETE /api/e-uks/visits/[visitId]` |
| `euks.monitoring.read` | — | `/e-uks/pantauan-kesehatan`, student health loaders |
| `euks.measurements.write` | — | `POST /api/e-uks/measurements`, `DELETE /api/e-uks/measurements/[measurementId]` |
| `euks.sick_absences.write` | — | `PATCH /api/e-uks/sick-absences/[attendanceId]` (note/followUp on SAKIT rows only) |
| `euks.complaint_options.read` | — | `GET /api/e-uks/complaint-options` |
| `euks.complaint_options.manage` | — | `POST/PATCH /api/e-uks/complaint-options` |
| `euks.profile.manage` | — | `/e-uks/pengaturan`, `PUT /api/e-uks/profile` |
| `euks.officers.manage` | — | `POST/PATCH/DELETE /api/e-uks/officers`, `PUT/DELETE …/officers/[id]/photo` |
| `euks.facilities.manage` | — | `POST/PATCH/DELETE /api/e-uks/facilities`, `PUT/DELETE …/facilities/[id]/photo` |
| `euks.hero_images.manage` | — | `POST/PATCH/DELETE /api/e-uks/hero-images`, `PUT/DELETE …/hero-images/[id]/photo` |
| `euks.hero_logos.manage` | — | `POST/PATCH/DELETE /api/e-uks/hero-logos`, `PUT/DELETE …/hero-logos/[id]/logo` |
| `school.settings.read` | — | `/pengaturan`, `GET /api/admin/settings` |
| `school.settings.write` | — | `PUT /api/admin/settings` (excluding `allowTeachersAccessAllClasses`) |
| `school.class_access.write` | — | `allowTeachersAccessAllClasses` field of `PUT /api/admin/settings` |
| `school.branding.write` | — | `PUT/DELETE /app-logo`, `PUT /favicon.ico`, branding fields of settings |
| `school.holidays.read` | — | `GET /api/admin/holidays` |
| `school.holidays.write` | — | `POST/PATCH/DELETE /api/admin/holidays` |
| `school.holidays.export` | — | `GET /api/export?type=holidays` |
| `database.backup` | — | `GET /api/admin/database` |
| `database.restore` | — | `POST /api/admin/database` |
| `accounts.read` | — | account list for role assignment UI (new surface, Phase 3+) |
| `rbac.roles.read` | — | role list/detail (new) |
| `rbac.roles.manage` | — | create/update/delete non-system roles, edit role permissions (new) |
| `rbac.assignments.manage` | — | add/remove `UserRole` (new; replaces `bos.access.manage`, `sarpras.access.manage`, workbook flag edits, `canManageTeacherProfiles`) |
| `rbac.audit.read` | — | read `AuditLog` entries for RBAC entities (new) |

Not created (no operation exists in HEAD): `euks.export`, `bos.export`, `sarpras.export`, `students.violations.read` (violations are read inside `students.profile.read`), `teachers.duties.read`/`teachers.schedule.read` (read inside directory), `euks.*.read` for settings sub-entities (read inside `euks.overview.read`), `attendance.delete`, any `siswa`/`wali_murid` data permission.

## Role templates (initial seed, adjustable in UI)

| Role key | Name | Permissions |
|---|---|---|
| `system_admin` | Admin Sistem | bypass (protected) |
| `guru` | Guru | `attendance.dashboard.read.assigned_classes`, `attendance.reports.read.assigned_classes`, `attendance.read.assigned_classes`, `attendance.write.assigned_classes`, `attendance.export.assigned_classes`, `reports.whatsapp.read.all`, `students.profile.read.assigned_classes`, `students.violations.create.assigned_classes`, `teachers.directory.read`, `workbook.links.read.own`, `workbook.links.update.own` |
| `pengawas` | Pengawas | `attendance.dashboard.read.all`, `attendance.reports.read.all`, `attendance.export.all`, `students.profile.read.all`, `teachers.directory.read`, `workbook.supervision.read`, `workbook.supervision.review` |
| `kepala_sekolah` | Kepala Sekolah | `attendance.dashboard.read.all`, `attendance.reports.read.all`, `attendance.export.all`, `reports.whatsapp.read.all`, `students.profile.read.all`, `teachers.directory.read`, `workbook.supervision.read`, `bos.read`, `sarpras.read`, `euks.overview.read`, `euks.visits.read`, `euks.monitoring.read` |
| `pengurus_uks` | Pengurus UKS | all `euks.*` |
| `pengurus_bos` | Pengurus BOS | `bos.read`, `bos.entries.create`, `bos.entries.update`, `bos.budget.write`, `bos.categories.manage` |
| `pengurus_sarpras` | Pengurus Sarpras | `sarpras.read`, `sarpras.locations.write`, `sarpras.item_types.write`, `sarpras.items.write`, `sarpras.photos.write` |
| `siswa` | Siswa | none |
| `wali_murid` | Wali Murid | none |

Templates are seeded once by key (created only when the key is absent; existing rows and their `RolePermission` set are never touched again). No user is assigned a position role by name, NIP or `position` guessing; only the legacy mapping below is applied automatically. Template contents are initial values, not a permanent authority: after an admin edits a role, seed reruns never restore removed permissions.

## Seed vs backfill

| | `prisma db seed` (`prisma/seed.ts` → `prisma/seed-rbac.ts`) | `npm run db:rbac-backfill` (`prisma/rbac-backfill-legacy.ts`) |
|---|---|---|
| When | every deploy (Docker migrator), every `db:setup` | once per database, run by an operator |
| Permission catalog | upsert label/description/module for every registry key | not touched |
| Roles | create missing templates and compatibility bundles with their initial permissions; existing roles untouched | not touched (fails if a bundle is missing → run seed first) |
| Users | none on a populated database. Only a database with **zero** users gets the initial admin from `SEED_ADMIN_EMAIL/PASSWORD` (created as `system_admin` member, `isTeacher=false`). An existing account with the seed e-mail on an otherwise empty database aborts the seed (collision) — never promoted, never password-reset, never activated | writes `UserRole` memberships and `User.isTeacher` only; never password, `active`, identity, homeroom, `workbookSupervised`, `allowTeachersAccessAllClasses` or domain relations |
| Idempotency | safe to rerun | `RbacMigration` marker; `apply` is refused once `COMPLETED` |

The seed never runs the backfill, and the backfill never runs the seed. New registry keys on later releases are only added to the catalog; they are not granted to any existing role — `system_admin` reaches them through its key-based bypass.

## Compatibility mapping (`lib/rbac-legacy.ts`, mapping version 1)

Legacy access is reproduced with a small set of **compatibility bundles** (non-system, editable roles, key prefix `legacy_`) rather than one role per user. The bundle contents are derived from the HEAD helpers (`lib/bos.ts`, `lib/sarpras.ts`, `lib/euks.ts`, `lib/workbook.ts`, `lib/teacher-profile.ts`, `lib/class-access.ts`) — not from the Phase 1 template wishlist — so that effective behaviour is unchanged.

| Legacy source | Membership / identity |
|---|---|
| `role = ADMIN` | `system_admin` + `legacy_guru`, `isTeacher = true`. Every ADMIN, never a single one chosen by e-mail/name |
| `role = GURU` | `legacy_guru`, `isTeacher = true` |
| `canManageTeacherProfiles` | `legacy_teacher_manager` (`teachers.directory.read`, `teachers.profile/duties/schedule.write`) |
| `canViewWorkbookSupervision` | `legacy_workbook_viewer` (`workbook.supervision.read`) |
| `canSuperviseWorkbooks` | `legacy_workbook_supervisor` (`…read` + `…write`) |
| `canViewBos` | `legacy_bos_view` (`bos.read`) |
| `canCreateBos` | `legacy_bos_create` (`bos.read`, `bos.entries.create`; the latter also covers category creation as in HEAD) |
| `canEditBos` | `legacy_bos_edit` (`bos.read`, `bos.entries.update`, `bos.budget.write`) |
| `canManageBosCategories` | `legacy_bos_categories` (`bos.read`, `bos.categories.manage`) — **no** category creation |
| `canManageBosAccess` | `legacy_bos_access` (`bos.read`, `bos.access.manage`) — to be narrowed to a delegated bundle in Phase 4 |
| `canViewSarpras` / `canEditSarpras` | `legacy_sarpras_view` (`sarpras.read`) / `legacy_sarpras_edit` (read + all `sarpras.*.write`) |
| `canViewEuks` / `canEditEuks` | `legacy_euks_view` (overview/visits/monitoring read) / `legacy_euks_edit` (view set + visits/measurements/sick_absences write + complaint options read). Never `euks.*.manage` |
| `workbookSupervised`, homeroom, `allowTeachersAccessAllClasses`, `active`, password, identity | preserved as-is; none becomes a grant |
| inactive account | mapped like an active one, `active` stays `false`, `requireUser()` keeps denying |

`legacy_guru` includes `reports.whatsapp.read.all` and `attendance.*.assigned_classes` because at HEAD `/laporan-whatsapp` only calls `requireUser()` and class scope came from the former `lib/class-access.ts` (removed in Phase 4). `isTeacher = true` for **all** ADMIN and GURU accounts is population compatibility (HEAD selects `role IN (ADMIN, GURU)` as the teacher population), not a claim that every administrator is a teacher. Any boolean `can*` column on `User` without an entry in `FLAG_TO_BUNDLE` aborts the backfill with an actionable error; nothing is ever mapped to `system_admin` as a fallback.

**Parity.** `compareParity()` computes, per user, the old effective decision set (from the legacy helper logic, including class scope and the global teacher setting) and the new effective decision set (from RBAC memberships) as `operation@scope` strings and reports `LOST` and `GAINED` both ways. `apply` refuses to write when pre-write parity is not empty, and writes `COMPLETED` only after post-write parity (recomputed from database rows) is empty. Intentional security deltas are reported separately, never folded into "identical": fresh DB authority per request (TD-008), potential memberships on inactive accounts, key-based `system_admin` bypass that does not survive cloning, and population-level `isTeacher`.

**Tooling contract.** Default is dry-run (zero writes). `--apply --database=<name>` is required and the typed name must equal `current_database()`, so a wrong `.env` cannot silently target another database. Work is resumable: each finished account is recorded in `RbacMigrationItem`, a retry before completion skips them, a failure halfway leaves `status = FAILED` (readiness not ready), and after `COMPLETED` a re-apply is refused so revoked grants are never replayed. No credentials are read or printed.

## Readiness

`lib/rbac-readiness.ts` derives one state from the `RbacMigration[legacy-access-backfill-v1]` row and the user count: `ready` (marker `COMPLETED`, or no marker on a database with zero users), `not-ready` (marker `RUNNING`/`FAILED`, or no marker on a populated database), `error` (unknown marker key or the readiness query itself failed). `getAuthorizationContext()` throws `RbacNotReadyError` for anything but `ready`; there is no fallback to legacy columns or JWT, and an empty `UserRole` set never becomes an implicit `GURU`. Legacy guards (`requireAdmin`, `lib/*-access.ts`) are unaffected until Phase 4 switches surfaces over.

## Compatibility and migration strategy

Phases are executed serially; each is a separate commit with its own validation.

1. **Phase 2 – schema & catalog (done).** `RbacRole`, `Permission`, `UserRole`, `RolePermission`, `User.isTeacher` added additively; catalog and templates seeded idempotently; `User.role` and all boolean columns untouched. Evaluator (`lib/rbac.ts` pure + `lib/rbac-access.ts` DB-backed) exists but no surface is wired to it. The `authorized` prefilter now derives public/authenticated policy from `lib/route-policy.ts` (fail closed for unknown paths); its legacy `ADMIN` checks stay until Phase 4, because the pages they cover (`/siswa`, `/guru`, `/pengaturan`, …) still have no server-side guard of their own.
2. **Phase 3 – backfill (done, local only; production apply is a Phase 4 cutover step).** Implemented in `lib/rbac-legacy.ts` (pure mapping + parity), `lib/rbac-backfill.ts` (tooling), `prisma/rbac-backfill-legacy.ts` (CLI, `npm run db:rbac-backfill`), `lib/rbac-readiness.ts`, migration `20260912180000_add_rbac_migration_markers` (`RbacMigration`, `RbacMigrationItem`). See "Seed vs backfill", "Compatibility mapping" and "Readiness" below.
3. **Phase 4 – core enforcement (done).** Core surfaces now call `requirePermission()` / `requireClassScopeFor()`:
   - `lib/class-access.ts` **deleted**, replaced by `lib/rbac-class-access.ts` — scope resolves **per operation**, so `attendance.read.all` never widens `attendance.write` or `attendance.export`. A narrow scope always yields `{ homeroomUserId }`, never `{}`.
   - `lib/api-errors.ts` maps failures to honest status codes (401 unauthenticated/inactive, 403 forbidden, 404 concealment, 400/409 validation/conflict, 503 RBAC not ready, 500 otherwise). Route handlers no longer collapse unexpected errors into 403.
   - `lib/page-guards.ts` guards server pages (redirect to `/login` or to the safe landing). Client-component pages are guarded by a server `layout.tsx`.
   - Root `/` renders `components/layout/safe-landing.tsx` — no dashboard query runs at all for users without `attendance.dashboard.read.*`.
   - `auth.ts` no longer filters core routes by the JWT role; only public-vs-authenticated policy remains (`lib/route-policy.ts`, fail closed).
   - `lib/nav.ts` filters by permission key instead of role name; empty groups disappear and there is no `GURU` fallback while the session loads. Grants are computed server-side (`lib/server-nav-grants.ts`) and passed down as props. Role display is multi-badge with a "Tanpa role" state.
   - Teacher population comes from `User.isTeacher` (`lib/teacher-population.ts`), which also refuses account operations against holders of a **protected** role unless the caller is a system admin.
   Still legacy at the end of Phase 4: BOS, Sarpras, E-UKS, `/pengaturan`, database backup, and the `requireAdmin` helper they use.
4. **Phase 5 – admin UI.** Role management, assignment, RBAC audit viewer; retire `/bos/akses`, `/sarpras/akses`, workbook scope flags and `canManageTeacherProfiles` editing.
5. **Phase 6 – cleanup.** Drop `User.role`, boolean capability columns and the `"Role"` enum in a separate migration after a full release cycle with RBAC live.

Every phase keeps the Docker migrator (`prisma migrate deploy && prisma db seed`) valid: seed remains idempotent and must not require RBAC tables before their migration exists.

## Authorization inventory (HEAD `e03746f`)

Legend — **Current guard**: `U` = `requireUser()` (session + `active` re-read), `A` = `requireAdmin()` (JWT role), `CA` = `getClassAccess()`/`canAccessClass()`, `Dom(x)` = DB-backed domain guard, `Proxy` = `auth.ts authorized` prefilter only, `None` = no server guard. Scope `AC` = assigned classes (homeroom, widened by `allowTeachersAccessAllClasses`).

### Pages

| Path | Current guard | Reads/writes | Target policy |
|---|---|---|---|
| `/login` | public (proxy) | — | public |
| `/` (client) | Proxy → `/api/dashboard` | — | authenticated; data behind `attendance.dashboard.read.*` |
| `/absensi/input` (client) | Proxy → `/api/attendance` | — | `attendance.write.*` |
| `/rekap-sekolah` | `U`+`CA` via `getClassRecords` | attendance aggregates | `attendance.dashboard.read.*` |
| `/rekap-kelas`, `/rekap-siswa` (client) | Proxy → APIs | — | `attendance.reports.read.*` |
| `/laporan-whatsapp` | `U` (no class scope) | all classes' daily absentees | `reports.whatsapp.read.all` (A3) |
| `/export-data` | `U`+`CA` | class options | `attendance.export.*` (+ master exports by their own keys) |
| `/siswa`, `/siswa/input`, `/siswa/kelola`(redirect) | Proxy adminOnly, page `None` | — | `students.master.read` / `.write` |
| `/siswa/[studentId]` | `U`+`CA` | profile, history, violations | `students.profile.read.*` |
| `/guru`, `/guru/input`, `/guru/kelola`(redirect) | Proxy adminOnly, page `None` | — | `teachers.accounts.read` / `.write` |
| `/guru/direktori` | `U` | teacher directory | `teachers.directory.read` |
| `/guru/[teacherId]` | `U`; editors shown if ADMIN or `canManageTeacherProfiles` | teacher profile | `teachers.directory.read`; editors by `teachers.profile.update` |
| `/wali-kelas/input` (client) | Proxy adminOnly → `/api/admin/homerooms` | — | `homerooms.assign` |
| `/profil` | `U` | own user row | authenticated |
| `/pengaturan` (client) | Proxy adminOnly → `/api/admin/*` | — | `school.settings.read` |
| `/supervisi-buku-kerja` | `Dom(workbook viewer)` | supervision overview | `workbook.supervision.read` |
| `/supervisi-buku-kerja/kelola` | `U` + DB role ADMIN | scope list | `workbook.scope.manage` |
| `/bos` | `Dom(bos.view)` | budget, entries | `bos.read` |
| `/bos/akses` | `Dom(bos.manage_access)` | user rights | `bos.access.manage` → `rbac.assignments.manage` |
| `/sarpras` | `Dom(sarpras.view)`; ADMIN shows access link | inventory | `sarpras.read` |
| `/sarpras/akses` | `Dom(sarpras.view)` + role ADMIN | user rights | `sarpras.access.manage` → `rbac.assignments.manage` |
| `/e-uks` | `Dom(euks.view)`; ADMIN shows manage link | profile, trends | `euks.overview.read` |
| `/e-uks/riwayat-kunjungan` | `Dom(euks.view)` | visits | `euks.visits.read` |
| `/e-uks/pantauan-kesehatan` | `Dom(euks.view)` | health data | `euks.monitoring.read` |
| `/e-uks/pengaturan` | `Dom(euks.view)` + role ADMIN | settings, teachers | `euks.profile.manage` |

### Route handlers

| Route | Methods | Current guard | Target permission |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | Auth.js | public |
| `/app-logo` | GET / PUT, DELETE | public / `A` | public / `school.branding.write` |
| `/favicon.ico` | GET / PUT | public / `A` | public / `school.branding.write` |
| `/site-branding.json` | GET | none | public |
| `/api/dashboard` | GET | `U`+`CA` | `attendance.dashboard.read.*` |
| `/api/attendance` | GET / POST | `U`+`CA` (POST validates `classId` via `canAccessClass`) | `attendance.read.*` / `attendance.write.*` |
| `/api/class-recap` | GET | `U`+`CA` (in loader) | `attendance.reports.read.*` |
| `/api/class-recap/export` | GET | `U`+`CA` | `attendance.export.*` |
| `/api/recap-students` | GET | `U`+`CA` | `attendance.reports.read.*` |
| `/api/attendance-trend` | GET | `U`+`CA` (classId validated against allowed ids) | `attendance.reports.read.*` |
| `/api/export` | GET | `U`; `students/teachers/homerooms/holidays` need JWT ADMIN; attendance types `CA` | per type: `students.master.export`, `teachers.accounts.export`, `homerooms.export`, `school.holidays.export`, `attendance.export.*` |
| `/api/admin/students` | GET / POST, PATCH / DELETE | `A` | `students.master.read` / `.write` / `.delete` |
| `/api/admin/teachers` | GET / POST, PATCH / DELETE | `A`; targets `role=GURU` only | `teachers.accounts.read` / `.write` / `.delete`; target selection by `isTeacher` |
| `/api/admin/homerooms` | GET / PUT | `A` | `homerooms.read` / `homerooms.assign` |
| `/api/admin/settings` | GET / PUT | `A` | `school.settings.read` / `.write` (+`school.class_access.write`, `school.branding.write` per field) |
| `/api/admin/holidays` | GET / POST, PATCH, DELETE | `A` | `school.holidays.read` / `.write` |
| `/api/admin/database` | GET / POST | `A` | `database.backup` / `database.restore` |
| `/api/profile` | GET, PATCH | `U` (own id) | authenticated |
| `/api/profile/password` | PATCH | `U` (own id) | authenticated |
| `/api/profile/photo` | GET, PUT, DELETE | `U` (own id) | authenticated |
| `/api/teachers/[teacherId]/photo` | GET | `U` | `teachers.directory.read` |
| `/api/teachers/[teacherId]` | PATCH | `Dom(teacher manager)` | `teachers.profile.update` |
| `/api/teachers/[teacherId]/duties` | POST, DELETE | `Dom(teacher manager)` | `teachers.duties.manage` |
| `/api/teachers/[teacherId]/schedule` | POST, DELETE | `Dom(teacher manager)` | `teachers.schedule.manage` |
| `/api/students/[studentId]/violation-points` | POST | `U`+`CA` (student looked up inside scope) | `students.violations.create.*` |
| `/api/workbooks/links` | GET / PUT | `U` (own id) | `workbook.links.read.own` / `.write.own` |
| `/api/workbooks/status` | PATCH | `Dom(workbook supervisor)` | `workbook.supervision.review` |
| `/api/workbooks/scope` | PATCH | `A` | `workbook.scope.manage` (business flag) + `rbac.assignments.manage` (legacy flags) |
| `/api/bos/entries` | POST | `Dom(bos.create)` | `bos.entries.create` |
| `/api/bos/entries/[entryId]` | PATCH | `Dom(bos.edit)` | `bos.entries.update` |
| `/api/bos/settings` | PATCH | `Dom(bos.edit)` | `bos.budget.write` |
| `/api/bos/categories` | POST / PATCH | `Dom(bos.create)` / `Dom(bos.manage_categories)` | `bos.entries.create` / `bos.categories.manage` |
| `/api/bos/access` | PATCH | `Dom(bos.manage_access)` | `bos.access.manage` → `rbac.assignments.manage` |
| `/api/sarpras/history` | GET | `Dom(sarpras.view)` | `sarpras.read` |
| `/api/sarpras/locations` | POST, PATCH, DELETE | `Dom(sarpras.edit)` | `sarpras.locations.write` |
| `/api/sarpras/item-types` | POST, PATCH, DELETE | `Dom(sarpras.edit)` | `sarpras.item_types.write` |
| `/api/sarpras/items` | POST, PATCH, DELETE | `Dom(sarpras.edit)` | `sarpras.items.write` |
| `/api/sarpras/photos` | GET / POST, DELETE | `Dom(sarpras.view)` / `Dom(sarpras.edit)` | `sarpras.read` / `sarpras.photos.write` |
| `/api/sarpras/photos/[photoId]` | GET | `Dom(sarpras.view)` | `sarpras.read` |
| `/api/sarpras/access` | PATCH | `Dom(sarpras.view)` + role ADMIN | `sarpras.access.manage` → `rbac.assignments.manage` |
| `/api/e-uks/visits` | POST | `Dom(euks.edit)` | `euks.visits.write` |
| `/api/e-uks/visits/[visitId]` | PATCH, DELETE | `Dom(euks.edit)` | `euks.visits.write` |
| `/api/e-uks/measurements` | POST | `Dom(euks.edit)` | `euks.measurements.write` |
| `/api/e-uks/measurements/[measurementId]` | DELETE | `Dom(euks.edit)` | `euks.measurements.write` |
| `/api/e-uks/sick-absences/[attendanceId]` | PATCH | `Dom(euks.edit)` | `euks.sick_absences.write` |
| `/api/e-uks/complaint-options` | GET / POST, PATCH | `Dom(euks.edit)` / `Dom(euks.view)`+ADMIN | `euks.complaint_options.read` / `.manage` |
| `/api/e-uks/profile` | PUT | `Dom(euks.view)`+ADMIN | `euks.profile.manage` |
| `/api/e-uks/officers` (+`/[id]/photo`) | POST, PATCH, DELETE, PUT, DELETE / GET | ADMIN / `Dom(euks.view)` | `euks.officers.manage` / `euks.overview.read` |
| `/api/e-uks/facilities` (+`/[id]/photo`) | same pattern | same | `euks.facilities.manage` / `euks.overview.read` |
| `/api/e-uks/hero-images` (+`/[id]/photo`) | same pattern | same | `euks.hero_images.manage` / `euks.overview.read` |
| `/api/e-uks/hero-logos` (+`/[id]/logo`) | same pattern | same | `euks.hero_logos.manage` / `euks.overview.read` |

No server actions (`"use server"`) exist in HEAD.

### Server loaders, helpers and other authority paths

| Location | Authority behaviour | Target |
|---|---|---|
| `auth.ts` `authorize` | active account, bcrypt, in-memory rate limit; copies role + 11 capability booleans into user object | identity only |
| `auth.ts` `jwt`/`session` | capabilities persist in JWT for 30 days; refreshed only on `update` trigger | JWT = `id` only (+ display fields) |
| `auth.ts` `authorized` | path prefilter: adminOnly list by JWT role; `/bos`, `/sarpras`, `/e-uks` by JWT capabilities; `/app-logo` GET and `/login` public | logged-in / public split only; permission decisions move to surfaces |
| `proxy.ts` | matcher excludes `api/auth`, `_next/static`, `_next/image`, `favicon.ico`, dotted paths | unchanged |
| `lib/auth-guards.ts` | `requireUser` re-reads `active`; `requireAdmin` trusts JWT role (TD-008) | `requireUser` + `requirePermission(key)` reading `UserRole` |
| `lib/class-access.ts` | ADMIN → all; else `allowTeachersAccessAllClasses` → all; else homeroom | scope resolver per `<family>.<action>` with `isTeacher` condition |
| `lib/bos.ts`, `lib/sarpras.ts`, `lib/euks.ts`, `lib/workbook.ts`, `lib/teacher-profile.ts` | pure helpers: ADMIN always true; implied-view rules | replaced by templates + evaluator |
| `lib/*-access.ts` | DB-backed re-read of booleans; `requireSarprasAccessManager`/`requireEuksAdmin` add role ADMIN check | `requirePermission` |
| `lib/nav.ts` | `roles: ["ADMIN","GURU"]` per item + 4 capabilities; sidebar defaults role to `GURU` when session missing | items declare `permission` keys; no default |
| `components/layout/sidebar-nav.tsx`, `components/profile/profile-manager.tsx`, `app/guru/[teacherId]/page.tsx` | role label "Administrator"/"Guru" | role names from `UserRole` |
| `components/export/export-center.tsx` | master exports shown when `role === "ADMIN"` | per export permission |
| `lib/server-teacher-profile.ts`, `lib/server-workbook.ts`, `lib/server-bos.ts`, `lib/server-sarpras.ts`, `app/api/admin/homerooms` | teacher population = `role IN (ADMIN, GURU)` or `role = GURU` | `isTeacher = true` |
| `lib/server-euks.ts readAssignableTeachers` | `active: true` (all users) | `isTeacher = true` |
| `prisma/seed.ts` | creates initial admin only on an empty database; seeds catalog, templates and compatibility bundles; never touches existing accounts | done (Phase 3) |
| `scripts/ensure-local-test-user.ts` | forces `role = ADMIN` (dev only) | assigns `system_admin` (Phase 5) |
| `scripts/seed-bos-test-users.ts`, `scripts/generate-euks-test-data.ts` | dev-only, set/select boolean capabilities | update in Phase 5 |
| `Dockerfile` / `compose.yaml` migrator | `prisma migrate deploy && prisma db seed` on every deploy | unchanged; seed must stay idempotent |
| `prisma/migrations/20260711170000_init` | `CREATE TYPE "Role" AS ENUM ('ADMIN','GURU')`; `User.role NOT NULL DEFAULT 'GURU'` | dropped in Phase 6 |
| `AuditLog` | exists; used by workbook, BOS, Sarpras, E-UKS; `User` entity exists for access changes | reused for RBAC entities |

## Required tests per family (Phase 2+)

- Evaluator: empty roles → deny; union across roles; unknown key → deny even for `system_admin`; inactive account → 401 before any check; `read` ≠ `write` ≠ `export`; scope non-bleed (`read.all` + `write.assigned_classes`).
- Class scope: homeroom filter in `where`; `allowTeachersAccessAllClasses` only with `isTeacher` and only for attendance families; client `classId` outside scope → 404.
- Route contracts (one per handler family): 401 anonymous, 403 wrong permission, 200 with permission, system_admin passes, business validation still rejects invalid payloads for system_admin.
- Nav: item visible iff permission; no visible item without a server guard.
- Public/authenticated: login, Auth.js, `GET /app-logo`, `GET /favicon.ico`, `GET /site-branding.json` reachable anonymously; profile endpoints reject cross-user ids.
- Role management: system role immutable fields, last system_admin protection, version conflict → 409, audit rows written.
- Backfill: ADMIN→`system_admin`+`isTeacher`, GURU→`guru`+`isTeacher`, each legacy boolean → expected keys, idempotent re-run.
