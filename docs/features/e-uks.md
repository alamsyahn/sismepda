# E-UKS

E-UKS is the school health unit (Unit Kesehatan Sekolah) module inside SISMEPDA. It is not a separate application or database: it reuses the same PostgreSQL database, the same `Student`/`SchoolClass`/`Attendance` data, and the same Prisma schema. Student, class and attendance data are never duplicated into E-UKS tables.

## Routes and navigation

| Route | Purpose | Access |
|---|---|---|
| `/e-uks` | Halaman Utama: UKS identity, carousel, profile, pengurus, fasilitas, plus disease/action trends derived from visit history | `euks.view` |
| `/e-uks/pantauan-kesehatan` | Per-student health monitoring: nutrition status, sick-absence history, UKS visit history, IMT and KMS charts | `euks.view` |
| `/e-uks/riwayat-kunjungan` | UKS visit log — the write surface and source of truth for every E-UKS statistic | `euks.view`, writes require `euks.edit` |
| `/e-uks/pengaturan` | Content configuration for the home page | ADMIN |

`lib/nav.ts` renders E-UKS as one collapsible group between Kurikulum and BOS; `match: "exact"` on `/e-uks` keeps the home item from staying active on sub-routes, and `activeNavGroupId` opens the group on every E-UKS route.

## Authorization

E-UKS follows the Sarpras delegation model: `User.canViewEuks` and `User.canEditEuks`, where edit implies view and ADMIN always passes. `lib/euks.ts` holds the pure policy (used by the nav filter and the Auth.js proxy gate) and `lib/euks-access.ts` re-reads rights from PostgreSQL in `requireEuksViewer()`, `requireEuksEditor()` and `requireEuksAdmin()`. The `authorized` callback in `auth.ts` is a session-level pre-filter only; every page and route handler still calls its own guard. Health data is never public.

## Data model

### EuksVisit

One row per student visit to the health unit, and the single source of truth for every E-UKS statistic: the visit table, the per-student UKS history on Pantauan Kesehatan, the disease trend map, and the treatment statistics on the home page. No chart value is ever entered manually.

| Field | Notes |
|---|---|
| `studentId` | References the existing `Student`; student and class names are always read through this relation, never copied |
| `occurredAt` | `@db.Date` — a school date, not a timestamp |
| `complaint`, `treatment` | Free text; aggregation normalizes them (see below) |
| `followUp` | Optional |
| `recordedById` | The recording user, `SetNull` on delete so history survives account removal |

Indexed on `occurredAt` and on `(studentId, occurredAt)` to serve both the chronological log and per-student lookups.

Because complaints are free text, `countVisitTerms()` in `lib/euks.ts` groups them case- and whitespace-insensitively, so "Pusing", "pusing" and "Pusing " count as one term. Ties sort alphabetically to keep chart order stable.

### StudentHealthMeasurement

One row per height/weight measurement, so growth is historical rather than a
"current height" field that overwrites its own past. `@@unique([studentId, measuredAt])`
prevents two measurements on the same school date.

| Field | Notes |
|---|---|
| `studentId` | References the existing `Student`; cascade delete |
| `measuredAt` | `@db.Date` — a school date |
| `heightCm`, `weightKg` | `Decimal(5,1)`; converted with `Number()` before crossing to client components, because Prisma `Decimal` is not serializable |
| `note` | Optional |
| `recordedById` | `SetNull` so history survives account removal |

**IMT is always derived, never stored.** `calculateBmi()` computes kg/m² on read,
so a corrected height or weight can never leave a stale IMT behind. It returns
`null` for non-positive inputs instead of `Infinity`/`NaN`.

The relational content collections for carousel/pengurus/fasilitas are introduced
by the following phases and documented here as they land.

## Nutrition status is intentionally unresolved

The "Status Gizi (berdasarkan IMT)" card renders "Belum dapat ditentukan".
Classifying a school-age child requires **BMI-for-age** against a WHO/Permenkes
LMS reference, which needs the student's **age and sex** — and `Student` stores
neither `birthDate` nor `gender`. Adult BMI cut-offs (18.5/25/30) are clinically
wrong for children and are deliberately not used. `nutritionStatus()` therefore
returns `"unknown"` until both the reference dataset and the demographic fields
exist. See the technical debt registry.

## API

`POST /api/e-uks/measurements` records one measurement (409 when that student already has one on that date); `DELETE /api/e-uks/measurements/[measurementId]` removes one. Both require `euks.edit` and write an `AuditLog` entry in the same transaction.

`POST /api/e-uks/visits` creates a visit; `PATCH`/`DELETE /api/e-uks/visits/[visitId]` edit and remove one. All three require `euks.edit`, validate with zod, reject inactive students, and append an `AuditLog` entry (`EUKS_VISIT_CREATED`/`UPDATED`/`DELETED`) inside the same transaction as the change. Clients refresh via `router.refresh()` rather than optimistic updates.

## Open reference-data requirement

KMS (Kartu Menuju Sehat) growth charts require an official reference dataset (WHO/Kemenkes LMS or SD tables). No such dataset exists in the repository, so KMS curve values must not be invented, interpolated or read off a screenshot. See the technical debt registry.
