# Database architecture

PostgreSQL is the only durable store. Prisma 7 uses `@prisma/adapter-pg`; `lib/database-config.ts` extracts an optional `?schema=` parameter and passes it to the runtime adapter, allowing isolated local schemas. Prisma CLI configuration is in `prisma.config.ts`; `prisma/schema.prisma` and the migration directories are the canonical model inventory and forward history.

## Domain ownership

- Identity/school: `User`, `SchoolClass`, `SchoolSetting`, `SchoolHoliday`.
- Attendance: `Student`, `AttendanceDay` (unique class/date), `Attendance` (unique day/student), `StudentViolationPoint`.
- Teacher: `Subject`, `TeacherSubject`, `TeachingAssignment`, `AdditionalDuty`.
- Workbook: `Workbook`, `WorkbookItem`, `TeacherWorkbook`, `TeacherWorkbookItemStatus`.
- BOS: `BosSetting`, `BosCategory`, `BosEntry`, `BosDocument`.
- Sarpras: `SarprasLocation`, `SarprasItemType`, `SarprasItem`, `SarprasPhoto`, `SarprasHistory`.
- Cross-module: `AuditLog`.

## Lifecycles and invariants

Classes and students are retained by restrictive foreign keys where attendance history refers to them. Student deletion is an explicit ADMIN operation that first deletes related attendance records/points as implemented by the route. Teacher deletion reassigns attendance submissions to the acting admin before deletion because submission ownership is restrictive. Homeroom deletion effects use `SetNull`.

Workbook child data cascades with workbook/user/item deletion; reviewer deletion sets reviewer to null. BOS category references restrict category removal (the UI deactivates categories); documents cascade with entries, and creator/updater deletion sets null. Sarpras location/item-type references restrict deletion while used; item photos/history cascade; actor/creator/updater deletion sets null. Sarpras enforces nonnegative quantities and condition-total equality in both domain validation and a database check constraint. A partial unique index enforces unique root location slugs because PostgreSQL treats nullable composite keys specially.

Binary bytes are stored directly for user photos, favicon, app logo, and Sarpras photos. BOS monetary values are `Decimal(14,2)`. Dates representing school calendar days depend on Jakarta-local conversion conventions; do not replace these with UTC string slicing.

## Migrations and seed

Production uses `prisma migrate deploy`; development scripts use `prisma migrate dev`. The seed requires `DATABASE_URL`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`; it idempotently creates the admin, 27 classes (VII–IX A–I), the singleton school setting, and four workbook masters with 19 items. It deliberately does not delete workbook/items outside the current master because user links/statuses may depend on them.

Schema validation: `npx prisma validate`. A migration must update both `schema.prisma` and a forward migration, regenerate the client, and be exercised against an isolated schema before deployment.
