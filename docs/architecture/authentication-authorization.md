# Authentication and authorization

This document describes the authorization that runs today. The target
role/permission model, the full per-surface inventory, and the migration phases
are locked in [Role-based access control](rbac.md); new protected surfaces must
be added to that inventory.

## Authentication

Auth.js v5 credentials authentication (`auth.ts`) accepts an email (case-insensitive) or exact NIP plus password. Only active users qualify; bcrypt verifies `passwordHash`. Sessions are JWTs with a 30-day maximum age and carry role plus Workbook/BOS/Sarpras/E-UKS capabilities. `requireUser()` re-reads `User.active` on protected server operations, so a disabled account is rejected even when its JWT exists, but it returns the JWT role rather than re-reading the current database role (TD-008). Capability guards for Workbook, BOS, Sarpras, and E-UKS re-read their current rights from PostgreSQL.

Login throttling is an in-memory, per-process map (`lib/login-rate-limit.ts`): 8 attempts per IP+identifier and 50 per IP in 15 minutes, capped at 10,000 keys. It trusts the first `x-forwarded-for` value, is reset on restart, and is not shared across replicas.

`proxy.ts` applies Auth.js to non-static paths. Public exceptions are Auth.js endpoints, the login page, static/file-like URLs (which is how GET `/favicon.ico` and `/site-branding.json` stay public), and GET `/app-logo`; mutation guards still protect branding. Logged-in users are redirected away from `/login`. The `authorized` callback also prefilters `/siswa`, `/guru`, their input routes, `/wali-kelas/input`, `/pengaturan`, `/supervisi-buku-kerja/kelola` (JWT role) and `/bos`, `/sarpras`, `/e-uks` (JWT capabilities); it is a session-level gate only.

## Global roles and class scope

- `ADMIN`: global access and implicit success for delegated permissions.
- `GURU`: general attendance/reporting/directory/profile access plus default access only to classes where `SchoolClass.homeroomUserId` equals the user ID.
- `SchoolSetting.allowTeachersAccessAllClasses=true` expands every GURU's attendance-related class scope globally.

`getClassAccess()`/`canAccessClass()` is reused by attendance, dashboard, class/student recaps, attendance trend, student profiles, violation points, and attendance exports. `/laporan-whatsapp` is authenticated but not class-scoped. Data-master pages `/siswa`, `/guru`, their input routes, `/wali-kelas/input`, `/pengaturan`, workbook scope management, master-data exports (`students`, `teachers`, `homerooms`, `holidays`), branding writes, and database backup/restore are ADMIN-only. Teacher profile editing is ADMIN or `canManageTeacherProfiles`; viewing the directory/profile is authenticated. Data-master pages themselves render without a server guard and rely on the proxy gate plus `requireAdmin()` in the `/api/admin/*` handlers they call.

## Delegated capabilities

| Domain | GURU rights | Implication/manager |
|---|---|---|
| Workbook | `canViewWorkbookSupervision`, `canSuperviseWorkbooks`; per-teacher `workbookSupervised` includes/excludes review target | supervise implies view; ADMIN assigns scope |
| BOS | view, create, edit, manage categories, manage access | any non-view right implies view; a GURU may hold manage-access |
| Sarpras | view, edit | edit implies view; only ADMIN manages access |
| E-UKS | view, edit | edit implies view; only ADMIN edits configuration content and complaint options; no in-app UI grants E-UKS rights (columns are set directly) |
| Teachers | `canManageTeacherProfiles` | ADMIN passes; no in-app UI grants it |

Legacy `ADMIN`/`GURU` are the only global roles; a user's teacher identity is currently inferred from that role (directory, homeroom candidates, workbook population and access lists select `role IN (ADMIN, GURU)` or `role = GURU`). `workbookSupervised` and `EuksOfficer.role` are business attributes, not authorization.

The sidebar mirrors these policies but is presentation only. Every page/server mutation must use its domain guard (`lib/*-access.ts` or `lib/auth-guards.ts`). Permission changes are audited for Workbook, BOS and Sarpras.

## Security-sensitive behavior

Photo/logo uploads validate size, MIME and magic bytes; SVG is rejected. CSV exports prefix spreadsheet-formula-leading cells. External document/workbook links allow only HTTP(S). No CSRF mechanism beyond Auth.js/session and same-origin browser behavior is implemented explicitly. See active risks in [technical debt](../technical-debt/README.md).
