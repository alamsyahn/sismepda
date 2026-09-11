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

Only permission columns exist so far (`20260911120000_add_euks_access`). The remaining models — visit records, student health measurements, and the relational content collections for carousel/pengurus/fasilitas — are introduced by the following phases and documented here as they land.

## Open reference-data requirement

KMS (Kartu Menuju Sehat) growth charts require an official reference dataset (WHO/Kemenkes LMS or SD tables). No such dataset exists in the repository, so KMS curve values must not be invented, interpolated or read off a screenshot. See the technical debt registry.
