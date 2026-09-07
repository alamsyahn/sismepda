# Authentication and authorization

## Authentication

Auth.js v5 credentials authentication (`auth.ts`) accepts an email (case-insensitive) or exact NIP plus password. Only active users qualify; bcrypt verifies `passwordHash`. Sessions are JWTs with a 30-day maximum age and carry role plus Workbook/BOS/Sarpras capabilities. `requireUser()` re-reads `User.active` on protected server operations, so a disabled account is rejected even when its JWT exists, but it returns the JWT role rather than re-reading the current database role (TD-008). Capability guards for Workbook, BOS, and Sarpras re-read their current rights from PostgreSQL.

Login throttling is an in-memory, per-process map (`lib/login-rate-limit.ts`): 8 attempts per IP+identifier and 50 per IP in 15 minutes, capped at 10,000 keys. It trusts the first `x-forwarded-for` value, is reset on restart, and is not shared across replicas.

`proxy.ts` applies Auth.js to non-static paths. Public exceptions are Auth.js endpoints, the login page, static/file-like URLs, and GET `/app-logo`; mutation guards still protect branding. Logged-in users are redirected away from `/login`.

## Global roles and class scope

- `ADMIN`: global access and implicit success for delegated permissions.
- `GURU`: general attendance/reporting/directory/profile access plus default access only to classes where `SchoolClass.homeroomUserId` equals the user ID.
- `SchoolSetting.allowTeachersAccessAllClasses=true` expands every GURU's attendance-related class scope globally.

`getClassAccess()`/`canAccessClass()` is reused by attendance, dashboard, class/student recaps, student profiles, violation points, and attendance exports. Data-master pages `/siswa`, `/guru`, their input routes, `/wali-kelas/input`, `/pengaturan`, and workbook scope management are ADMIN-only. Teacher profile editing is ADMIN or `canManageTeacherProfiles`; viewing the directory/profile is authenticated.

## Delegated capabilities

| Domain | GURU rights | Implication/manager |
|---|---|---|
| Workbook | `canViewWorkbookSupervision`, `canSuperviseWorkbooks`; per-teacher `workbookSupervised` includes/excludes review target | supervise implies view; ADMIN assigns scope |
| BOS | view, create, edit, manage categories, manage access | any non-view right implies view; a GURU may hold manage-access |
| Sarpras | view, edit | edit implies view; only ADMIN manages access |

The sidebar mirrors these policies but is presentation only. Every page/server mutation must use its domain guard (`lib/*-access.ts` or `lib/auth-guards.ts`). Permission changes are audited for Workbook, BOS and Sarpras.

## Security-sensitive behavior

Photo/logo uploads validate size, MIME and magic bytes; SVG is rejected. CSV exports prefix spreadsheet-formula-leading cells. External document/workbook links allow only HTTP(S). No CSRF mechanism beyond Auth.js/session and same-origin browser behavior is implemented explicitly. See active risks in [technical debt](../technical-debt/README.md).
