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

**Implementation status.** Phases 2–6 have landed locally. Every application surface — core modules (dashboard, attendance, recap/export, students, teachers, homerooms, workbook, navigation), domain modules, and role/account administration — now authorizes exclusively through `requirePermission()` / `requireAnyPermission()` / `requireClassScopeFor()` against the current database. Role/account UI lives at `/pengaturan/akses`, `/pengaturan/pengguna`, and `/pengaturan/audit`. `User.role` and the boolean capability columns are still written by existing UIs and are still read by `lib/rbac-legacy.ts` for the one-time backfill parity mapping, but they are **no longer consulted by any runtime guard**. Phase 6 removed their remaining runtime population/navigation reads without dropping the columns; physical removal waits for a separate migration after one full live release cycle.

**Contract (drop) migration policy.** The first RBAC release is deliberately **additive only**. No migration in `prisma/migrations/` drops `User.role`, the `LegacyRole` enum type, or any boolean authorization flag, and `tests/deployment-contract.test.ts` fails the build if one appears. Two reasons: an additive schema keeps the previous application image valid as a rollback path up to the cutover, and contraction is irreversible without a restore.

These legacy columns stay **inert** after cutover — present, possibly still written by older UI paths, never read by a runtime guard. Contraction is a separate future project, permitted only after production stability and explicit approval.

Contraction must never remove `User.isTeacher`, `User.workbookSupervised`, or business relations: those are domain data, not legacy authorization flags, and remain in active runtime use (see the teacher-population note below).

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
8. Role/permission/assignment mutations are written to `AuditLog` (`entity` = `RbacRole` | `RbacRolePermission` | `RbacUserRole` | `UserAuthority`, `targetUserId` for assignments).

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

- `User.isTeacher` marks teacher records. Teacher directory, homeroom candidates, schedule/duty editing targets, workbook supervision population, E-UKS officer candidates and the `teachers` export select on `isTeacher = true`, not on role membership. `teacherPopulationWhere()` is the single source for that filter; it does **not** fall back to `role = "GURU"` (the legacy backfill is `COMPLETED`, and the narrowing was verified to change zero rows).
- Holding the `guru` role does not set `isTeacher`; having `isTeacher` does not grant permissions.
- `workbookSupervised` stays a business attribute (include in supervision population). `EuksOfficer.role` stays a free-text UKS position.
- `siswa` and `wali_murid` may exist as roles, but until a `User↔Student` link and a parent↔child resolver exist their templates hold only the authenticated-public set. No student/parent account creation path exists in HEAD.

## System admin

- Role key `system_admin`, initial name `Admin Sistem`; legacy `ADMIN` maps to it.
- Membership grants a controlled bypass: every permission check for a *known* catalog key passes. The bypass still requires an active account (`requireUser()`), never skips business validation (zod, invariants, confirmation identifiers), and never satisfies an unknown key.
- Class scope for a system admin resolves to `all` for every scoped family.

## Account deletion policy

Permanent deletion (`DELETE /api/rbac/accounts/[userId]`) is a distinct authority from deactivation, because deactivation is reversible and deletion is not.

Two relations reference `User` without `onDelete`, so PostgreSQL applies RESTRICT and a naive delete fails at the database layer. Each has a deliberate, different policy (`lib/account-deletion.ts`):

| Relation | Policy | Why |
|---|---|---|
| `AttendanceDay.submittedById` | Reassigned to the deleting actor | Student attendance is a school record that must not disappear because the submitting teacher was removed. |
| `StudentViolationPoint.recordedById` | **Blocks** deletion (HTTP 409, `reason: violation_points_attributed`) | Reassigning it would rewrite who accused a student of misconduct — record falsification. Deleting it would discard the student's disciplinary history, which does not belong to the teacher's account. No automatic treatment is correct, so the operator decides. |

Additional rules enforced by the endpoint:

- A confirmation identifier (NIP or e-mail) must match the target; a button press is not enough.
- Self-deletion is rejected, and is checked *before* attribution so the message stays useful.
- The system-admin population lock is taken before writing, and the invariant is verified after deletion inside the same transaction.
- The audit entry is written *before* the row disappears, and stores name/NIP/e-mail/roles in `before`. `AuditLog.targetUserId` has no Prisma relation, so the id survives, but the identity behind it would otherwise be unrecoverable.

`DELETE /api/admin/teachers` was removed. Permanent deletion has one entrypoint, `DELETE /api/rbac/accounts/[userId]`, so provenance, privilege checks, the last-admin invariant, same-origin enforcement, and audit cannot diverge between routes.

## Surface policy model

### Nested route guards

A Next.js layout guard covers every child route, so the guard on `/pengaturan`
must be the **union** of what its children need — otherwise an RBAC manager
without `school.settings.read` cannot reach `/pengaturan/akses` at all.

Widening a layout guard does not authorize the layout's own page. `/pengaturan`
therefore carries its own `school.settings.read` guard on the page, and the
school settings form lives in a sibling component rather than in `page.tsx`.
Removing that page guard makes school settings readable by anyone holding only
RBAC rights — verified by mutation, not assumed.

The rule: a layout guard is a **filter**, never the authorization for any
individual page. Each page states its own requirement.

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
| `reports.whatsapp.read.all` | — | `/laporan-whatsapp`, `getWhatsAppReportClasses` in `lib/whatsapp-access.ts` (school-wide in HEAD; see ambiguity A3). The data-only `readWhatsAppReportClasses` is deliberately unguarded and reserved for the background worker, which has no user session |
| `students.master.read` | — | `/siswa`, `GET /api/admin/students` |
| `students.master.create` / `students.master.update` / `students.master.import` | — | `/siswa/input`, `POST/PATCH /api/admin/students` (bulk CSV import is a separate right from single create) |
| `students.master.delete` | — | `DELETE /api/admin/students` |
| `students.master.export` | — | `GET /api/export?type=students` |
| `students.profile.read` | `assigned_classes`, `all` | `/siswa/[studentId]`, `readStudentProfile` |
| `students.violations.create` | `assigned_classes`, `all` | `POST /api/students/[studentId]/violation-points` |
| `teachers.accounts.read` | — | `/guru`, `GET /api/admin/teachers` |
| `teachers.accounts.create` / `teachers.accounts.update` | — | `/guru/input`, `POST/PATCH /api/admin/teachers` (create and teacher identity only) |
| `accounts.credentials.manage` / `accounts.status.manage` | — | `PATCH /api/rbac/accounts/[userId]`; exactly one operation per request |
| `accounts.delete` | — | `DELETE /api/rbac/accounts/[userId]` (sole permanent-deletion entrypoint; separate from deactivation) |
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
| `bos.entries.create` | — | `POST /api/bos/entries` |
| `bos.entries.update` | — | `PATCH /api/bos/entries/[entryId]` |
| `bos.budget.update` | — | `PATCH /api/bos/settings` |
| `bos.categories.create` | — | `POST /api/bos/categories` (create / reuse / reactivate by slug, as in source) |
| `bos.categories.update` | — | `PATCH /api/bos/categories` (rename, activate/deactivate) |
| `bos.access.manage` | — | `/bos/akses`, `PATCH /api/bos/access`. **Domain-scoped delegation only**: assign/unassign the five allowlisted `legacy_bos_*` bundles. Never equivalent to `rbac.assignments.manage` |
| `sarpras.read` | — | `/sarpras`, overview loader |
| `sarpras.history.read` | — | `GET /api/sarpras/history` |
| `sarpras.photos.read` | — | `GET /api/sarpras/photos`, `GET /api/sarpras/photos/[photoId]` |
| `sarpras.locations.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/sarpras/locations` |
| `sarpras.item_types.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/sarpras/item-types` |
| `sarpras.items.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/sarpras/items` |
| `sarpras.photos.create` | — | `POST /api/sarpras/photos` |
| `sarpras.photos.delete` | — | `DELETE /api/sarpras/photos/[photoId]` |
| `euks.content.read` | — | `/e-uks` public-facing content (profile, officers, facilities, hero assets). Grants **no** health data |
| `euks.overview.read` | — | `/e-uks` visit aggregates and trend loaders |
| `euks.visits.read` | — | `/e-uks/riwayat-kunjungan`, `readEuksVisits` |
| `euks.visits.create/update/delete` | — | `POST /api/e-uks/visits`, `PATCH` / `DELETE /api/e-uks/visits/[visitId]` |
| `euks.monitoring.read` | — | `/e-uks/pantauan-kesehatan` shell and student selectors |
| `euks.measurements.read` | — | measurement panel of the monitoring loader |
| `euks.measurements.create` | — | `POST /api/e-uks/measurements` |
| `euks.measurements.delete` | — | `DELETE /api/e-uks/measurements/[measurementId]` |
| `euks.sick_absences.read` | — | sick-absence panel of the monitoring loader |
| `euks.sick_absences.update` | — | `PATCH /api/e-uks/sick-absences/[attendanceId]` — `note`/`followUp` only, on rows whose status is `SAKIT` **as read from the database**. Never status, date, class, or general attendance |
| `euks.complaint_options.read` | — | `GET /api/e-uks/complaint-options` |
| `euks.complaint_options.create` | — | `POST /api/e-uks/complaint-options` (create / reuse / reactivate) |
| `euks.complaint_options.update` | — | `PATCH /api/e-uks/complaint-options` (rename, activate/deactivate; no delete exists in source) |
| `euks.profile.update` | — | `PUT /api/e-uks/profile` |
| `euks.officers.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/e-uks/officers`, `PUT`/`DELETE …/officers/[id]/photo` |
| `euks.facilities.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/e-uks/facilities`, `PUT`/`DELETE …/facilities/[id]/photo` |
| `euks.hero_images.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/e-uks/hero-images`, `PUT`/`DELETE …/hero-images/[id]/photo` |
| `euks.hero_logos.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/e-uks/hero-logos`, `PUT`/`DELETE …/hero-logos/[id]/logo` |
| `school.settings.read` | — | `/pengaturan`, `GET /api/admin/settings` |
| `school.settings.update` | — | ordinary school/attendance fields of `PUT /api/admin/settings` |
| `school.class_access.manage` | — | `allowTeachersAccessAllClasses` field only. A settings editor cannot flip it |
| `school.branding.update` | — | branding fields of settings, `PUT/DELETE /app-logo`, `PUT /favicon.ico` |
| `school.upload_policy.read` | — | upload limits section of `/pengaturan`, `GET /api/admin/upload-policy` |
| `school.upload_policy.update` | — | `PUT /api/admin/upload-policy` |
| `school.holidays.read` | — | `GET /api/admin/holidays` |
| `school.holidays.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/admin/holidays` |
| `school.holidays.export` | — | `GET /api/export?type=holidays` |
| `database.backup` | — | `GET /api/admin/database`. Independent of restore |
| `database.restore` | — | `POST /api/admin/database`. Independent of backup |
| `accounts.read` | — | `/pengaturan/pengguna` account list (read-only entry to the account admin screen) |
| `rbac.roles.read` | — | role list/detail (new) |
| `rbac.roles.manage` | — | create/update/delete non-system roles, edit role permissions (new) |
| `rbac.assignments.manage` | — | add/remove `UserRole` (new; replaces `bos.access.manage`, `sarpras.access.manage`, workbook flag edits, `canManageTeacherProfiles`) |
| `rbac.audit.read` | — | read `AuditLog` entries for RBAC entities (new) |
| `development.read` | — | `/development`. Read-only CLI documentation page. Sensitive because it names deployment, backup, and database commands; grants no ability to run any of them |
| `whatsapp.read` | — | `GET /api/whatsapp`, `GET /api/whatsapp/configuration`. Connection state, schedule, send history. Never includes the pairing QR |
| `whatsapp.connection.manage` | — | `POST /api/whatsapp/connection`, `GET /api/whatsapp/qr`, `PATCH /api/whatsapp/configuration`. Sensitive: holds the school WhatsApp account, and logout stops all automatic sending until someone rescans the QR |
| `whatsapp.send` | — | `POST /api/whatsapp/send`. Sensitive: produces a real, unretractable message in the homeroom group |
| `schedule.own.read` | — | `/jadwal`, `GET /api/jadwal/guru` for the signed-in teacher, `GET /api/jadwal/waktu` |
| `schedule.classes.read` | — | `GET /api/jadwal/kelas`, `GET /api/jadwal/entries` |
| `schedule.teachers.read` | — | `GET /api/jadwal/guru` for **another** teacher. Not needed to read one's own |
| `schedule.free_teachers.read` | — | `GET /api/jadwal/jam-kosong` |
| `schedule.entries.create/update/delete` | — | `POST` / `PATCH` / `DELETE /api/jadwal/entries` |
| `schedule.time.manage` | — | `PUT /api/jadwal/waktu`. Sensitive: shifts displayed clock times school-wide because entries store period numbers, not times |
| `schedule.import` | — | `POST /api/jadwal/impor`, `POST`/`DELETE /api/jadwal/impor/[importId]`, `PUT /api/jadwal/mapping`. Sensitive: applying overwrites manual edits that differ from the file |
| `schedule.revisions.read` | — | `GET /api/jadwal/revisi` |
| `schedule.revisions.rollback` | — | `POST /api/jadwal/revisi`. Sensitive: changes the active timetable |

Not created (no operation exists in HEAD): `euks.export`, `bos.export`, `sarpras.export`, `students.violations.read` (violations are read inside `students.profile.read`), `teachers.duties.read`/`teachers.schedule.read` (read inside directory), `euks.*.read` for settings sub-entities (read inside `euks.overview.read`), `attendance.delete`, any `siswa`/`wali_murid` data permission.

## Role templates (initial seed, adjustable in UI)

| Role key | Name | Permissions |
|---|---|---|
| `system_admin` | Admin Sistem | bypass (protected) |
| `guru` | Guru | `attendance.dashboard.read.assigned_classes`, `attendance.reports.read.assigned_classes`, `attendance.read.assigned_classes`, `attendance.write.assigned_classes`, `attendance.export.assigned_classes`, `reports.whatsapp.read.all`, `students.profile.read.assigned_classes`, `students.violations.create.assigned_classes`, `teachers.directory.read`, `workbook.links.read.own`, `workbook.links.update.own`, `schedule.own.read`, `schedule.classes.read`, `schedule.free_teachers.read` |
| `pengawas` | Pengawas | `attendance.dashboard.read.all`, `attendance.reports.read.all`, `attendance.export.all`, `students.profile.read.all`, `teachers.directory.read`, `workbook.supervision.read`, `workbook.supervision.review` |
| `kepala_sekolah` | Kepala Sekolah | `attendance.dashboard.read.all`, `attendance.reports.read.all`, `attendance.export.all`, `reports.whatsapp.read.all`, `students.profile.read.all`, `teachers.directory.read`, `workbook.supervision.read`, `bos.read`, `sarpras.read`, `euks.overview.read`, `euks.visits.read`, `euks.monitoring.read` |
| `pengurus_uks` | Pengurus UKS | all `euks.*` |
| `pengurus_bos` | Pengurus BOS | `bos.read`, `bos.entries.create`, `bos.entries.update`, `bos.categories.create` |
| `pengurus_sarpras` | Pengurus Sarpras | `sarpras.read`, `sarpras.history.read`, `sarpras.photos.read`, `sarpras.locations.*`, `sarpras.item_types.*`, `sarpras.items.*`, `sarpras.photos.create/delete` |
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
| `canEditBos` | `legacy_bos_edit` (`bos.read`, `bos.entries.update`, `bos.budget.update`) |
| `canManageBosCategories` | `legacy_bos_categories` (`bos.read`, `bos.categories.update`) — **no** category creation |
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

`getAuthorizationContext()` resolves identity **before** it queries readiness, and that order is load-bearing. `requireUser()` calls `auth()`, which reads cookies; touching a dynamic API before any Prisma query makes Next mark authorized pages dynamic instead of prerendering them. With the order reversed, `next build` runs the readiness query inside the Docker builder stage — which has no database access — and the build fails with `Can't reach database server` on pages such as `/bos` and `/laporan-whatsapp`. Both gates still run before any permission is granted and both still fail closed; only the error seen by an anonymous caller on a not-ready system changes (`UnauthorizedError` instead of `RbacNotReadyError`). `tests/deployment-contract.test.ts` pins the ordering.

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
   - Navigation grants are derived through the canonical evaluator, not from raw `RolePermission` rows: `lib/nav-grants.ts` re-decides every **known** permission with `hasPermission()`. `system_admin` deliberately has zero `RolePermission` rows, so forwarding `context.grants` verbatim would hide every guarded destination from it. Deriving instead of materialising keeps the controlled bypass in one place — a role merely *named* "Admin Sistem", or a clone of `system_admin` under a different key, gains nothing, and unknown/mistyped keys stay closed. Navigation remains UX only; `requirePermission()` still decides access.
   - Teacher population comes from `User.isTeacher` (`lib/teacher-population.ts`), which also refuses account operations against holders of a **protected** role unless the caller is a system admin.
   Still legacy at the end of Phase 4: BOS, Sarpras, E-UKS, `/pengaturan`, database backup, and the `requireAdmin` helper they use.
4. **Phase 5 – domain enforcement (done).** BOS, Sarpras, E-UKS, school settings, branding, holidays and database backup/restore now authorize through the current database, with operation-specific keys:
   - Coarse `*.write` / `*.manage` keys were split into `create` / `update` / `delete` per operation, and `euks.content.read` was introduced so public-facing E-UKS content no longer implies health data. Migration `20260913130000_migrate_domain_permissions` copies every existing `RolePermission` edge onto **all** operations the old key used to open, so nobody loses access; `20260913140000_retire_superseded_domain_permissions` then removes the superseded rows.
   - No operation was invented: BOS entries have no delete, complaint options have no delete, and measurements have no update, because the source has none.
   - **Delegated BOS access** (`bos.access.manage`) stays a domain-scoped exception. `PATCH /api/bos/access` accepts only `{ userId, bundleKey, assigned }` via a strict schema — no `roleId` — resolves the role server-side from a closed allowlist of five `legacy_bos_*` bundles, and on **every** request re-validates that the bundle's current permission set still equals the expected BOS-only set. A contaminated bundle is rejected (409); a target holding any protected role is rejected (403). The mutation touches exactly one `UserRole` row, so other grants survive. It can never grant Guru, UKS, a global manager or `system_admin`, and cannot reach `active`, password, email or NIP.
   - Because permissions union across roles, removing a delegated bundle does not necessarily remove effective BOS access — the UI states this rather than implying revocation.
   - Response projection follows permission, not just rendering: `readStudentMonitoring` substitutes empty results for panels the caller cannot read, so a content-only account triggers no measurement/visit/sick-absence query at all.
   - `allowTeachersAccessAllClasses` requires `school.class_access.manage`; an ordinary settings editor cannot flip it. `PUT /api/admin/settings` authorizes before parsing so a rejected caller gets 403, not a Zod 400.
   - Public branding (`/site-branding.json`, `/app-logo`, `/favicon.ico` GET) stays public and exposes only the branding projection; mutations require `school.branding.update`.
   - The Sarpras access shortcut (`/sarpras/akses`, `PATCH /api/sarpras/access`, `readSarprasAccessScope`) was **removed**: it only wrote legacy boolean columns, which after this phase decide nothing — a control that appeared to work but did not.
   - `auth.ts` no longer prefilters `/bos`, `/sarpras` or `/e-uks` from JWT claims, and `lib/nav.ts` no longer carries `capability` / `legacyAdminOnly`.
5. **Phase 6 – admin UI & cleanup (done locally).** `/pengaturan/akses` manages role/permission, `/pengaturan/pengguna` manages assignment/status/credentials/deletion, and `/pengaturan/audit` reads RBAC audit. Authority mutations enforce same-origin, lock privilege-changing operations transactionally, reject stale versions/revisions with 409, and audit in the mutation transaction. Runtime population/navigation fallbacks to legacy columns were removed. `User.role`, boolean capability columns, and the `"Role"` enum remain physically present until a separate post-release migration.

Every phase keeps the Docker migrator (`prisma migrate deploy && prisma db seed`) valid: seed remains idempotent and must not require RBAC tables before their migration exists.

## Current authorization inventory

The current per-permission surface map is the **Surface policy model** above. Runtime enforcement is DB-backed throughout; there is no `requireAdmin`, JWT-role prefilter, legacy capability guard, or legacy population fallback. Key Phase 6 administration surfaces are:

| Surface | Guard | Purpose |
|---|---|---|
| `/pengaturan/akses` | `rbac.roles.read` or `rbac.roles.manage` | role and explicit permission-key management |
| `/pengaturan/pengguna` | `rbac.assignments.manage` or the relevant `accounts.*` permission | role assignment, credentials, status, deletion |
| `/pengaturan/audit` and `GET /api/rbac/audit` | `rbac.audit.read` | RBAC-only audit viewer/API |
| `POST/PATCH /api/admin/teachers` | operation-specific teacher/account permissions | teacher creation and identity only; no status/password/delete fallback |
| `PATCH/DELETE /api/rbac/accounts/[userId]` | operation-specific `accounts.*` permission | sole authority path for credentials, status, and permanent deletion |

`proxy.ts` only distinguishes public from authenticated routes. Every data surface performs its own page/route/service authorization against the current database.

## Required tests per family (Phase 2+)

- Evaluator: empty roles → deny; union across roles; unknown key → deny even for `system_admin`; inactive account → 401 before any check; `read` ≠ `write` ≠ `export`; scope non-bleed (`read.all` + `write.assigned_classes`).
- Class scope: homeroom filter in `where`; `allowTeachersAccessAllClasses` only with `isTeacher` and only for attendance families; client `classId` outside scope → 404.
- Route contracts (one per handler family): 401 anonymous, 403 wrong permission, 200 with permission, system_admin passes, business validation still rejects invalid payloads for system_admin.
- Nav: item visible iff permission; no visible item without a server guard.
- Public/authenticated: login, Auth.js, `GET /app-logo`, `GET /favicon.ico`, `GET /site-branding.json` reachable anonymously; profile endpoints reject cross-user ids.
- Role management: system role immutable fields, last system_admin protection, version conflict → 409, audit rows written.
- Backfill: ADMIN→`system_admin`+`isTeacher`, GURU→`guru`+`isTeacher`, each legacy boolean → expected keys, idempotent re-run.
