# E-UKS

E-UKS is the school health unit (Unit Kesehatan Sekolah) module inside SISMEPDA. It is not a separate application or database: it reuses the same PostgreSQL database, the same `Student`/`SchoolClass`/`Attendance` data, and the same Prisma schema. Student, class and attendance data are never duplicated into E-UKS tables.

## Routes and navigation

| Route | Purpose | Access |
|---|---|---|
| `/e-uks` | Halaman Utama: visit totals plus complaint/treatment/monthly trends derived from visit history | `euks.view` |
| `/e-uks/pantauan-kesehatan` | Per-student health monitoring: nutrition status, sick-absence history, UKS visit history, IMT and KMS charts | `euks.view` |
| `/e-uks/riwayat-kunjungan` | UKS visit log — the write surface and source of truth for every E-UKS statistic | `euks.view`, writes require `euks.edit` |
| `/e-uks/pengaturan` | UKS identity, officers, facilities, and the standard complaint list | ADMIN |

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

## Nutrition status (BMI-for-age)

Classifying a school-age child uses **BMI-for-age (IMT/U)**, never the adult BMI
cut-offs (18.5/25/30), which are clinically wrong for children.

Two official sources, both stored in `lib/data/bmi-for-age-reference.json`:

| Part | Source |
| --- | --- |
| L/M/S values (z-score) | WHO Growth reference 5-19 years, BMI-for-age |
| Category cut-offs | Permenkes RI No. 2/2020, Tabel 15 (boys) & 16 (girls) |

The two agree: all 336 rows of the Permenkes tables were recomputed from the WHO
L/M/S values and matched within 0.051 BMI — half the 0.1 rounding unit of the
printed table. `tests/bmi-for-age.test.ts` re-checks every row on each run
against `tests/fixtures/permenkes-imt-u.json`, extracted straight from the
Permenkes PDF, so a corrupted dataset fails the suite rather than silently
shifting a category.

Cut-offs per Permenkes 2/2020 for ages 5-18: `< -3 SD` gizi buruk, `-3..< -2 SD`
gizi kurang, `-2..+1 SD` gizi baik, `> +1..+2 SD` gizi lebih, `> +2 SD`
obesitas. Boundary values sit in the *upper* band (exactly -2 SD is gizi baik).

`nutritionStatus()` returns a discriminated union — `{ kind: "known", category,
z, ageMonths }` or `{ kind: "unknown", reason }` — so a caller cannot forget the
unresolved case. The reasons are specific (`no_measurement`, `no_birth_date`,
`no_gender`, `age_out_of_range`) so the card names the missing input instead of
showing a dash. Age outside 5-19 years is never extrapolated.

Age comes from `ageInMonths()` at the measurement date, counted in full months
so a birthday later in the month does not round up. Category colour is mapped
once in `nutritionCategoryTone` so the card and any future table cannot disagree.

## KMS chart (height-for-age)

`/e-uks/pantauan-kesehatan` plots the student's height against the WHO
height-for-age reference bands, matching wireframe 06.

L/M/S values come from **WHO Growth reference 5-19 years, Height-for-age**
(`lib/data/height-for-age-reference.json`), cross-checked against the computed
SD columns shipped in the same WHO workbook — 2352 points, worst gap 0.0005 cm.
`tests/height-for-age.test.ts` re-runs that comparison against
`tests/fixtures/who-height-for-age.json` on every test run.

Permenkes 2/2020 is **not** used here: its height-for-age tables (Tabel 3 and
10) stop at 60 months, so they cannot cover secondary-school students. There is
therefore no Permenkes category for this indicator, and the chart deliberately
assigns **no status label** — it draws the reference bands and the student's
points, nothing more. Judging growth is a clinician's call, not an attendance
app's.

`lib/lms.ts` holds the LMS formula once; both BMI-for-age and height-for-age
call it, so the bands on the chart and the z-score behind a category can never
diverge. A point sitting between the median and -1 SD is exactly a point whose
z-score is between 0 and -1.

### Sick-absence table

The sick-absence table on `/e-uks/pantauan-kesehatan` reads from `Attendance`
rows with status `SAKIT`. It owns three behaviours worth knowing:

**Consecutive-day counting.** `lib/sick-streak.ts` numbers each row with its
position inside its own run — the first sick day is 1, the next 2, and so on —
so the column reads "which sick day in a row is this", and the most recent row
shows how long the current run has reached. It is deliberately not the run's
total length repeated on every row: that made a run's first day already display
its final size, which reads as though the student had been sick that long from
the start.

Runs treat school holidays as if they did not exist: sick on the 7th, 8th and
10th with the 9th resolving to a holiday numbers them 1, 2, 3. Holidays come
from `lib/server-holidays.ts`, so all three calendar kinds apply — including a
recurring Sunday rule and a `SCHOOL_DAY` override that turns a holiday back into
a school day. Weekdays are not skipped on their own: this school teaches on
Saturday, and if Sunday should bridge two illnesses it must be entered as a
recurring holiday in Pengaturan rather than assumed here. A gap wider than `MAX_HOLIDAY_GAP`
consecutive holidays never joins two runs, so a long school break cannot merge
illnesses months apart. Day one is deliberately left unhighlighted; colour is
reserved for runs that need attention, red from the third day up.

**`Attendance.followUp`.** The school follow-up column is a nullable column on
`Attendance`, separate from `note`. `note` holds what the parent or student
reported; `followUp` holds what the school did about it. Existing rows stay
`NULL` until someone fills them in.

**In-place editing.** `PATCH /api/e-uks/sick-absences/[attendanceId]` updates
only `note` and `followUp`, and refuses rows whose status is not `SAKIT`.
Status, date and class are intentionally not editable here: changing them moves
attendance totals, which belongs on Input Absensi where the holiday, future-date
and class-scope checks live. The Edit button links to
`/absensi/input?classId=…&date=…&siswa=…` using the class recorded on that
attendance day, not the student's current class, so a student who changed
classes still lands on the register that holds the row. `siswa` carries the
student's name so the attendance search box arrives pre-filled and the register
is already narrowed to that child. Permission is `euks.edit` rather than
class ownership, because a UKS officer who is not a homeroom teacher still needs
to record follow-up.

### Select triggers must map value to label

Base UI's `Select.Value` renders the raw `value` unless it is given a render
function. With CUID ids as option values, a bare `<SelectValue />` shows
`cmrgmf4mk000c3stmnx5ff25t` instead of `VII A`. Every select in this module
passes a lookup function, matching the pattern already used in
`components/dashboard/dashboard-header.tsx`:

```tsx
<SelectValue placeholder="Pilih kelas">
  {(value: string) => classes.find((o) => o.id === value)?.name ?? "Pilih kelas"}
</SelectValue>
```

The dropdown panel is sized to the trigger (`w-(--anchor-width)`), so a narrow
trigger clips long student names in the list. The selector column is `sm:max-w-md`
and both triggers are `w-full` so full names fit.

### Settings content

`/e-uks/pengaturan` (ADMIN only) owns four pieces of content, all additive
tables created by `20260911160000_add_euks_settings`:

| Model | Shape | Notes |
|---|---|---|
| `EuksProfile` | Singleton, id `"default"` | Name, location, description. Follows the `BosSetting` pattern; all fields nullable until an admin fills them |
| `EuksOfficer` | List | `userId` is nullable: officers may be a `User` (teacher) or a manually typed student/outsider. `onDelete: SetNull` plus a stored `name` keeps the roster readable after an account is removed |
| `EuksFacility` | List, unique `slug` | An informational list for the home page, not stock control — inventory belongs to Sarpras |
| `EuksComplaintOption` | List, unique `slug` | Standard complaint spellings offered on the visit form |

Facilities and complaint options reuse the BOS category rules: a case or
whitespace variant revives the existing row instead of creating a duplicate,
rows are deactivated rather than deleted, and renames are rejected with 409
when they would collide with another row.

The officer display name prefers the linked account's current name, so
renaming a teacher does not leave a stale roster; the stored `name` is only
the fallback for manual entries and deleted accounts.

Editing a complaint option never rewrites complaints on visits already
recorded — history must keep showing what was actually written at the time.

`EuksComplaintOption` is offered through a native `<datalist>` on the visit
form, so it suggests standard spellings without blocking free text. An empty
list changes nothing: the field behaves exactly as it did before.

`euksSlug()` in `lib/euks-settings.ts` is the same normalisation the trend
aggregation uses, and a test asserts the two stay identical. If they diverged,
a complaint could pass as new on the form yet merge in the statistics.

### Trend grouping is textual, not clinical

`EuksVisit.complaint` and `.treatment` are free text. `lib/euks-trends.ts`
groups them by normalised text (trimmed, case-folded) and labels each group
with the spelling operators used most often. It deliberately does no stemming,
synonym mapping, or medical grouping: deciding that "ISPA" and "batuk pilek"
are the same condition is a clinical judgement this app has no authority to
make, and a wrong mapping would silently distort every statistic on the page.
The page states this limitation to the reader. If the school later wants
consolidated categories, the correct fix is a curated complaint list on the
input form, not fuzzy matching after the fact.

Wireframe 02 also shows a photo carousel. It is deliberately not built: it
needs an image storage model and an upload endpoint, and the school chose to
defer it. Nothing else on the page depends on it.

Two departures from wireframe 03, both forced by the free-text schema:

- The monthly chart plots total visits per month, not columns stacked by
  treatment type — stacking needs a fixed set of categories that does not exist.
- Wireframe 02's identity content (profile, pengurus, fasilitas) is configuration
  managed in Pengaturan; the home page renders whatever is active there.

Empty months inside the range are kept at zero rather than skipped, so a quiet
month reads as quiet instead of vanishing from the axis.

### Why there is no weight-for-age chart

Wireframe 06 shows two charts, hand-labelled "Tinggi Badan" and "Berat Badan".
Only the height one is built. WHO states plainly that weight-for-age reference
data **are not published beyond age 10**, because the indicator cannot separate
height from body mass during the pubertal growth spurt — a tall 14-year-old
would read as overweight. SISMEPDA's students are VII-IX (roughly 12-15), so
every one of them falls in that excluded range.

Weight is not lost: it is recorded in the measurement table and drives the
BMI-for-age chart and the nutrition category, which is the indicator WHO and
Permenkes both intend for this age group.

`toHeightSeries()` drops measurements it cannot place — no birth date, or an
age outside the 5-19 year table — rather than clamping them to the edge of the
reference, which would put the student in the wrong band. The chart renders an
explicit message for each case: missing sex, no plottable measurement, or an
age outside the reference range.

## API

`POST /api/e-uks/measurements` records one measurement (409 when that student already has one on that date); `DELETE /api/e-uks/measurements/[measurementId]` removes one. Both require `euks.edit` and write an `AuditLog` entry in the same transaction.

`POST /api/e-uks/visits` creates a visit; `PATCH`/`DELETE /api/e-uks/visits/[visitId]` edit and remove one. All three require `euks.edit`, validate with zod, reject inactive students, and append an `AuditLog` entry (`EUKS_VISIT_CREATED`/`UPDATED`/`DELETED`) inside the same transaction as the change. Clients refresh via `router.refresh()` rather than optimistic updates.

## Open reference-data requirement

KMS (Kartu Menuju Sehat) growth charts require an official reference dataset (WHO/Kemenkes LMS or SD tables). No such dataset exists in the repository, so KMS curve values must not be invented, interpolated or read off a screenshot. See the technical debt registry.
