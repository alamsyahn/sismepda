# Workbook supervision

The seed supplies four equally weighted (25%) workbooks with 19 total checklist items. Every authenticated teacher can maintain one HTTP(S) link per workbook from `/profil`; blank input clears a link. Seed updates names/order but intentionally never removes extra workbook/items with dependent user data.

Teachers with `canViewWorkbookSupervision` can open `/supervisi-buku-kerja` read-only; `canSuperviseWorkbooks` can change checklist states; ADMIN always has both. `workbookSupervised=false` excludes a teacher from the supervision target population. ADMIN manages these flags at `/supervisi-buku-kerja/kelola`.

Each teacher/item state is `UNREVIEWED`, `PRESENT`, or `MISSING`; the control cycles in that order. Only PRESENT contributes to completion. A workbook is complete only when every item is PRESENT, unreviewed only when all are unreviewed, otherwise in progress. Overall teacher and school percentages weight each workbook by its configured weight rather than raw item count. Aggregate workbook completion is PRESENT items divided by teacher count × item count. Values and state are derived, not persisted.

Link, status and scope mutations write `AuditLog` entries atomically with changes. Teacher profile history reads the latest user-targeted audit records. Primary files: `lib/workbook*.ts`, `lib/server-workbook.ts`, `app/api/workbooks/**`, and `components/supervisi/**`. Authorization follows [the global model](../architecture/authentication-authorization.md).
