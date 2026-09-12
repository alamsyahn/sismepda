# Authentication and authorization

This document describes the authorization that runs today. The target
role/permission model, the full per-surface inventory, and the migration phases
are locked in [Role-based access control](rbac.md); new protected surfaces must
be added to that inventory.

## Authentication

Auth.js v5 credentials authentication (`auth.ts`) accepts an email (case-insensitive) or exact NIP plus password. Only active users qualify; bcrypt verifies `passwordHash`. Sessions are JWTs with a 30-day maximum age and still carry role plus BOS/Sarpras/E-UKS capabilities, which only the not-yet-migrated modules read. Core modules ignore those claims entirely: `requireUser()` in `lib/rbac-access.ts` re-reads identity and `active` from PostgreSQL, and `getAuthorizationContext()` re-reads role membership and permissions on every request (memoized per request via `react.cache()`, never across requests). A grant or revocation therefore takes effect on the next request with the same cookie, without logging out. A database failure throws — there is never a fallback to JWT claims or legacy columns.

Login throttling is an in-memory, per-process map (`lib/login-rate-limit.ts`): 8 attempts per IP+identifier and 50 per IP in 15 minutes, capped at 10,000 keys. It trusts the first `x-forwarded-for` value, is reset on restart, and is not shared across replicas.

`proxy.ts` applies Auth.js to non-static paths. Public exceptions are Auth.js endpoints, the login page, static/file-like URLs (which is how GET `/favicon.ico` and `/site-branding.json` stay public), and GET `/app-logo`; mutation guards still protect branding. Logged-in users are redirected away from `/login`. Public-vs-authenticated policy lives in `lib/route-policy.ts` and fails closed: an unlisted path always requires login. The callback no longer prefilters core routes by the JWT role — those pages now guard themselves server-side, and prefiltering on stale claims would have prevented new grants from taking effect. `/bos`, `/sarpras`, `/e-uks` are still prefiltered by JWT capabilities pending their own migration; that check only narrows access and the real guard stays in `lib/*-access.ts`.

## Global roles and class scope

- `ADMIN`: global access and implicit success for delegated permissions.
- `GURU`: general attendance/reporting/directory/profile access plus default access only to classes where `SchoolClass.homeroomUserId` equals the user ID.
- `SchoolSetting.allowTeachersAccessAllClasses=true` expands every GURU's attendance-related class scope globally.

`requireClassScopeFor(resource, action)` in `lib/rbac-class-access.ts` replaces the former `getClassAccess()`. Scope is resolved **per operation**, so `attendance.read.all` never widens `attendance.write` or `attendance.export`, and a narrow scope always produces a `{ homeroomUserId }` filter rather than an unrestricted query. `SchoolSetting.allowTeachersAccessAllClasses` widens only the documented attendance/student families, only for `isTeacher = true` accounts, and only for operations the user already holds.

Every core page guards itself server-side (`lib/page-guards.ts`); client-component pages are guarded by a server `layout.tsx`. Root `/` renders a safe landing without running any dashboard query when the user lacks `attendance.dashboard.read.*`. Export is a distinct right per file type and the scope filter applies inside the generated CSV, not just to the button. Account operations separate editing (`teachers.accounts.update`) from credential and status changes (`accounts.credentials.manage`, `accounts.status.manage`), and refuse to touch holders of a protected role unless the caller is a system admin.

## Delegated capabilities

| Domain | GURU rights | Implication/manager |
|---|---|---|
| Workbook | `canViewWorkbookSupervision`, `canSuperviseWorkbooks`; per-teacher `workbookSupervised` includes/excludes review target | supervise implies view; ADMIN assigns scope |
| BOS | view, create, edit, manage categories, manage access | any non-view right implies view; a GURU may hold manage-access |
| Sarpras | view, edit | edit implies view; only ADMIN manages access |
| E-UKS | view, edit | edit implies view; only ADMIN edits configuration content and complaint options; no in-app UI grants E-UKS rights (columns are set directly) |
| Teachers | `canManageTeacherProfiles` | ADMIN passes; no in-app UI grants it |

Teacher population for core surfaces (directory, accounts, homeroom candidates, workbook supervision) now comes from `User.isTeacher` via `lib/teacher-population.ts`; the legacy `role = GURU` predicate is still accepted alongside it as a transition fallback for rows not yet backfilled, and is used only for membership, never for authorization. `workbookSupervised` and `EuksOfficer.role` remain business attributes, not authorization.

The sidebar mirrors these policies but is presentation only. Every page/server mutation must use its domain guard (`lib/*-access.ts` or `lib/auth-guards.ts`). Permission changes are audited for Workbook, BOS and Sarpras.

## Security-sensitive behavior

Photo/logo uploads validate size, MIME and magic bytes; SVG is rejected. CSV exports prefix spreadsheet-formula-leading cells. External document/workbook links allow only HTTP(S). No CSRF mechanism beyond Auth.js/session and same-origin browser behavior is implemented explicitly. See active risks in [technical debt](../technical-debt/README.md).
