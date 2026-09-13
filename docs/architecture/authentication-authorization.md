# Authentication and authorization

This document describes the authorization that runs today. The target
role/permission model, the full per-surface inventory, and the migration phases
are locked in [Role-based access control](rbac.md); new protected surfaces must
be added to that inventory.

## Authentication

Auth.js v5 credentials authentication (`auth.ts`) accepts an email (case-insensitive) or exact NIP plus password. Only active users qualify; bcrypt verifies `passwordHash`. Sessions are JWTs with a 30-day maximum age and carry identity only. `requireUser()` in `lib/rbac-access.ts` re-reads identity and `active` from PostgreSQL, and `getAuthorizationContext()` re-reads role membership and permissions on every request (memoized per request via `react.cache()`, never across requests). A grant or revocation therefore takes effect on the next request with the same cookie, without logging out. A database failure throws — there is never a fallback to JWT claims or legacy columns.

Login throttling is an in-memory, per-process map (`lib/login-rate-limit.ts`): 8 attempts per IP+identifier and 50 per IP in 15 minutes, capped at 10,000 keys. It trusts the first `x-forwarded-for` value, is reset on restart, and is not shared across replicas.

`proxy.ts` applies Auth.js to non-static paths. Public exceptions are Auth.js endpoints, the login page, static/file-like URLs (which is how GET `/favicon.ico` and `/site-branding.json` stay public), and GET `/app-logo`; mutation guards still protect branding. Logged-in users are redirected away from `/login`. Public-vs-authenticated policy lives in `lib/route-policy.ts` and fails closed: an unlisted path always requires login. The callback does not prefilter application routes by JWT role/capability; pages guard themselves server-side against current database permissions, so grants and revocations are not delayed by stale session claims.

## Roles, permissions, and class scope

Role membership comes from `UserRole`; effective permission is the union of each assigned role's `RolePermission` rows. Only the immutable key `system_admin` bypasses permission checks. Display names such as "Admin Sistem" never authorize. Accounts may intentionally have no role and therefore no grants.

`requireClassScopeFor(resource, action)` in `lib/rbac-class-access.ts` resolves scope **per operation**, so `attendance.read.all` never widens `attendance.write` or `attendance.export`, and a narrow scope always produces a `{ homeroomUserId }` filter rather than an unrestricted query. `SchoolSetting.allowTeachersAccessAllClasses` widens only the documented attendance/student families, only for `isTeacher = true` accounts, and only for operations the user already holds.

Every core page guards itself server-side (`lib/page-guards.ts`); client-component pages are guarded by a server `layout.tsx`. Root `/` renders a safe landing without running any dashboard query when the user lacks `attendance.dashboard.read.*`. Export is a distinct right per file type and the scope filter applies inside the generated CSV, not just to the button. Account operations separate editing (`teachers.accounts.update`) from credential and status changes (`accounts.credentials.manage`, `accounts.status.manage`), and refuse to touch holders of a protected role unless the caller is a system admin.

## Domain permissions and business attributes

BOS, Sarpras, E-UKS, Workbook, and teacher-profile operations all use explicit permission keys from the current database. Implications/dependencies are validated by the RBAC service; family notation is metadata, never a runtime wildcard.

Teacher population for directory, accounts, homeroom candidates, workbook supervision, E-UKS officer candidates, and teacher export comes only from `User.isTeacher` via `lib/teacher-population.ts`. `workbookSupervised` and `EuksOfficer.role` remain business attributes, not authorization. Legacy `User.role` and `can*` columns stay in the schema for backfill parity through one release cycle, but no runtime authorization or population check reads them.

The sidebar mirrors these policies but is presentation only. Every page/server mutation must use `lib/rbac-access.ts`, `lib/page-guards.ts`, or the appropriate DB-backed domain guard. Authority mutations require same-origin verification and write their audit row in the same transaction.

## Security-sensitive behavior

Photo/logo uploads validate size, MIME and magic bytes; SVG is rejected. CSV exports prefix spreadsheet-formula-leading cells. External document/workbook links allow only HTTP(S). Authority and other sensitive mutations explicitly verify `Origin`/`Referer` against configured trusted origins and fail closed when neither is available. See active risks in [technical debt](../technical-debt/README.md).
