# E-UKS

E-UKS is the school health unit (Unit Kesehatan Sekolah) module inside SISMEPDA. It is not a separate application or database: it reuses the same PostgreSQL database, the same `Student`/`SchoolClass`/`Attendance` data, and the same Prisma schema. Student, class and attendance data are never duplicated into E-UKS tables.

## Routes and navigation

| Route | Purpose | Access |
|---|---|---|
| `/e-uks` | Halaman Utama: visit totals plus complaint/treatment/monthly trends derived from visit history | `euks.view` |
| `/e-uks/pantauan-kesehatan` | Per-student health monitoring: nutrition status, sick-absence history, UKS visit history, IMT and KMS charts | `euks.view` |
| `/e-uks/pantauan-kesehatan-kelas` | Per-class health monitoring: nutrition distribution, sick/visit trends, top complaints, data completeness, student table | `euks.monitoring.read` |
| `/e-uks/riwayat-kunjungan` | UKS visit log — the write surface and source of truth for every E-UKS statistic | `euks.view`, writes require `euks.edit` |
| `/e-uks/pengaturan` | UKS identity, officers, facilities, and the standard complaint list | ADMIN |

`lib/nav.ts` renders E-UKS as one collapsible group between Kurikulum and BOS; `match: "exact"` on `/e-uks` keeps the home item from staying active on sub-routes, and `activeNavGroupId` opens the group on every E-UKS route. Pantauan Kesehatan Kelas sits directly *above* Pantauan Kesehatan Siswa, following the school → class → student hierarchy: the class view is the aggregation level an officer passes through before individual monitoring. Ordering is presentation only — both items keep `euks.monitoring.read`. Active state is safe despite `/e-uks/pantauan-kesehatan` being a string prefix of `/e-uks/pantauan-kesehatan-kelas`, because `matches()` in `lib/nav.ts` compares the full href or requires a `/` separator.

## Authorization

E-UKS authorizes through RBAC against the current database on every request; `lib/euks-access.ts` is a thin wrapper over `requirePermission()`. Rights are granular per operation — `euks.content.read` for public-facing content, `euks.overview.read` for visit aggregates, `euks.visits.read/create/update/delete`, `euks.monitoring.read`, `euks.measurements.read/create/delete`, `euks.sick_absences.read/update`, `euks.complaint_options.read/create/update`, `euks.profile.update`, and `create/update/delete` for officers, facilities, hero images and hero logos. Holding one never widens another: a visit editor does not gain sick-absence editing, and reading complaint options does not permit configuring them.

E-UKS is school-wide for domain permission holders; homeroom assignment never restricts it. Health data is never public and `/e-uks` is not a public page. Permission also governs the payload, not just rendering: an account with only `euks.content.read` triggers no measurement, visit or sick-absence query at all, rather than receiving the data and having React hide it. `euks.sick_absences.update` may change only `note`/`followUp`, and only on attendance rows whose status is `SAKIT` as verified from the database — never status, date, class, or general attendance.

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
| `isSynthetic` | `false` for every real entry; `true` only for development test data |

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
| `isSynthetic` | `false` for every real entry; `true` only for development test data |

**IMT is always derived, never stored.** `calculateBmi()` computes kg/m² on read,
so a corrected height or weight can never leave a stale IMT behind. It returns
`null` for non-positive inputs instead of `Infinity`/`NaN`.

### Synthetic data markers

`EuksVisit.isSynthetic`, `StudentHealthMeasurement.isSynthetic`, and
`Student.syntheticDemographics` are `false` by default, so all existing and all
real data is marked real without a backfill. They exist only so the
development-only generator can be cleaned up selectively, and are never set by
the application UI or by `prisma/seed.ts`. Application queries deliberately
ignore them: local test data must exercise the same code paths as real data. See
[Development and verification](../operations/development.md).

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

## School nutrition summary (home page)

The `/e-uks` home page carries a **Ringkasan Status Gizi Siswa** section that
answers "what is the nutritional state of the school" without opening students
one at a time.

**The dashboard uses the latest valid health measurement per student, never
every historical measurement.** A student examined four times counts once, so
frequently-checked students do not outweigh the rest. The snapshot resolves the
latest row per student in SQL (`LEFT JOIN LATERAL … ORDER BY measuredAt DESC,
createdAt DESC, id DESC LIMIT 1` in `readSchoolNutritionSnapshot()`,
`lib/server-euks.ts`), one query for the whole school, with `createdAt`/`id` as
the deterministic tie-breakers for several rows on the same date. Active students only (`Student.active`), so
alumni cannot drag the figures.

Classification reuses `nutritionStatus()` — the same BMI-for-age resolver and
the same Permenkes/WHO reference described above. There is no second algorithm
and no adult cut-off anywhere in the dashboard; `tests/euks-nutrition.test.ts`
asserts the aggregate categories equal what `nutritionStatus()` returns for the
same input, including a case where a child is *gizi baik* at an IMT the adult
scale would call underweight.

A student is **measured** only when the latest row classifies. Everything else
is counted as not-yet-measured and broken down by the resolver's own reason
(`no_measurement`, `no_birth_date`, `no_gender`, `age_out_of_range`), so missing
demographics never silently inflate a category. Percentages of the categories
use measured students as the denominator; coverage uses the full roster.

`lib/euks-nutrition.ts` is deliberately Prisma-free. The server builds the
snapshot as **per-class buckets** — five counts plus a student total per class,
not one row per student — and the client component re-aggregates those buckets
for the grade filter. So the browser receives ~27 small objects instead of 840
student rows, and switching Semua/VII/VIII/IX re-renders without a request.

"Perlu perhatian" is derived (`ATTENTION_NUTRITION_CATEGORIES` = every category
whose `nutritionCategoryTone` is not `ok`), never a hand-written list, so adding
a category cannot leave it stale. Class ordering follows the existing
`compareClassNames()`. Category colours live in `--gizi-*` tokens in
`globals.css` rather than `--chart-*`, which is a deliberate greyscale in dark
mode and would render every category identical.

### Per-class heatmap

The per-class breakdown is a **heatmap** (`EuksNutritionHeatmap`,
`components/e-uks/euks-nutrition-heatmap.tsx`): one row per class, five category
columns plus a `Terukur` column. It replaced a 100% stacked bar per class,
because the question this page answers is "which class stands out on a given
category" — across 27 classes, comparing one category on stacked bars means
comparing segments that all start at different offsets, whereas a matrix column
is already a direct comparison.

The matrix is built by `nutritionHeatmap()` in `lib/euks-nutrition.ts`; the
component renders and never computes a percentage itself. **The two column kinds
use different denominators on purpose**: category cells divide by the class's
*measured* students (so a class does not look healthy merely because half of it
was never weighed), while the `Terukur` cell divides by the class roster,
because there the point *is* data completeness. A class with zero measured
students renders `–` rather than `0,0%`, since its categories have no
denominator at all.

Colour strength is normalised **per column against that column's own maximum**,
not against 100%. In real data *Gizi baik* sits in the tens of percent while
every other category is single-digit; normalising to 100% would wash out every
column except one and destroy the between-class pattern the heatmap exists to
show. Cells at zero get no tint; non-zero cells have a floor of `MIN_CELL_INTENSITY`
so a small value still reads as present.

Cell text uses the theme foreground and the colour sits in a separate layer
behind it, so contrast survives both themes and any tint level — measured at
162 cells, worst ratio 6.06 (light) and 5.14 (dark), all above WCAG AA. On
narrow viewports the table keeps its column widths and scrolls horizontally
inside its own container rather than being squeezed until numbers clip.

There is **no freshness rule**: the section shows the latest measurement date
and coverage, and never labels data "expired", because the project has no
owner-approved medical validity period. Raw IMT stays on
`/e-uks/pantauan-kesehatan`; a school-wide IMT average is intentionally absent,
as it is meaningless across mixed ages and sexes.

Access is `euks.measurements.read`, the same permission that guards Pantauan
Kesehatan Siswa. Without it the snapshot query never runs — the gate is in the
server component, not a hidden element.

Each class name in the first column is a link to
`/e-uks/pantauan-kesehatan-kelas?classId=<id>` (`classMonitoringLink()`), so the
heatmap doubles as the drill-down entry point. Only the class name is a link,
not the whole row or the coloured cells: a fully clickable chart hides where the
target actually is, and the name is the one element that reads as a class
identity. It is a real `<a>` — keyboard focusable, with hover/focus styling and
a `title` — and it always carries the stable `classId`, never the class name.

## Pantauan Kesehatan Kelas (per-class monitoring)

`/e-uks/pantauan-kesehatan-kelas` is the aggregation level between the E-UKS
home page (all classes) and Pantauan Kesehatan Siswa (one student). It answers
"how is this class doing, and who needs attention" and then hands off to the
existing per-student page.

Access is `euks.monitoring.read`. The permission already existed and is
semantically exact — no new permission was registered. As with the rest of
E-UKS, failing the check means the class query never runs.

### URL is the source of truth

Every piece of view state lives in the query string, parsed by
`readClassMonitoringView()` in `lib/euks-class-navigation.ts`:
`classId`, `periode`, `from`/`to`, `q` (search), `gizi`, `jk`, `perhatian`,
`urut`, `desc`. Unknown or malformed values fall back to defaults instead of
erroring, and an unknown `classId` renders the class-not-found notice with the
selector still usable, rather than a 404. Consequences: a refresh keeps the
selection, the URL can be shared, and returning from a student restores the
exact table the officer left.

With no `classId` the page renders only the heading, the selectors and "Pilih
kelas untuk melihat ringkasan kesehatan siswa." — no skeleton dashboard of
empty cards.

### Period

The period filter reuses the canonical trend granularities
(`TREND_GRANULARITIES` in `lib/attendance-trend.ts`: `harian`, `mingguan`,
`bulanan`, `semester`) together with `defaultRange()` and the school's semester
start setting. No new academic-year or semester concept was introduced. Default
is `bulanan`. If `semester` is selected while no semester start is configured,
the page falls back to `bulanan` rather than producing an empty range.

The period scopes sick days, sick trend, UKS visits, visit trend and top
complaints. It deliberately does **not** scope anthropometry: height, weight,
IMT and nutrition status always come from each student's latest valid
measurement, because a "sum of IMT over a period" is meaningless.

### Data and query shape

`readClassMonitoring()` in `lib/server-euks.ts` fetches everything in **four
queries total, independent of class size** — never `readStudentMonitoring()` in
a loop:

1. the class row (id, name);
2. one raw SQL `LEFT JOIN LATERAL` returning every active student with their
   latest valid measurement (the same lateral pattern as the school snapshot,
   with `databaseSchema`-qualified tables and the same
   `measuredAt DESC, createdAt DESC, id DESC` tie-breaker);
3. `Attendance` rows with status `SAKIT` in range, joined through
   `attendanceDay.date`;
4. `EuksVisit` rows in range.

Only the fields actually rendered are selected; no photos or blobs. No E-UKS
copy of Student/SchoolClass exists — the database stays the source of truth, and
no summary table caches chart numbers.

Aggregation itself lives in `lib/euks-class-monitoring.ts`, a pure module with
no Prisma and no React, so it is unit-testable and shared between the server
component and the client dashboard.

### Perlu Perhatian

The count in the summary band is a clickable dialog listing every flagged
student with **all** their reasons spelled out. There is deliberately no health
score or risk index — only signals that already have data and logic in the app:

- nutrition status is `Gizi buruk`, `Gizi kurang`, `Gizi lebih` or `Obesitas`
  (derived from `nutritionCategoryTone`, not a hand-written list);
- a sick streak of 3 days or more in the period, computed with the canonical
  `lib/sick-streak.ts` helper, so holidays follow existing rules;
- data that cannot be assessed: no measurement, no birth date, no gender, or age
  outside the reference range.

Each entry links straight to that student's detail page.

### Visualisations

All four are inline SVG or CSS, consistent with the rest of E-UKS; no chart
library was added.

- **Distribusi Status Gizi** — 100% stacked horizontal bar. Percentages divide by
  the *whole class*, including `Belum dapat dinilai`, so the unassessed share
  stays visible instead of being hidden by a measured-only denominator (this is
  the opposite choice from the home-page heatmap, and for the opposite reason:
  here completeness is part of the class picture). Categories come from the
  canonical IMT/U resolver; clicking a category filters the student table.
- **Tren Ketidakhadiran karena Sakit** — one column per bucket, day count and
  unique-student count in the tooltip, plus a note on how many students hit the
  sick-streak threshold. Empty buckets are rendered as zero-value columns, not
  skipped. Column heights come from a CSS grid whose bar row is `1fr`: a flex
  `items-end` wrapper leaves columns at content height, so percentage bar
  heights resolve to 0px and only the zero markers stay visible. Bars are
  floored at 8% of the plot so a single sick day still reads as a bar, and when
  all buckets are zero the card shows an explicit empty state instead of a
  flat axis.
- **Tren Kunjungan UKS** — area/line chart scoped to the selected class only.
- **Keluhan Terbanyak** — horizontal ranking of complaints exactly as recorded.
  No synonym or medical mapping is applied; `ISPA` and `batuk pilek` stay
  separate unless the canonical complaint list says otherwise.

### Kelengkapan Data Kesehatan

Reported with the canonical reasons kept distinct (`no_measurement`,
`no_birth_date`, `no_gender`, `age_out_of_range`) rather than collapsed into a
single `–`. The point is that "we have not measured this student" and "this
student's age is outside the reference" require different follow-up from the UKS
officer.

### Student table and drill-down

`Data Kesehatan Siswa — <class>` lists number, name, L/P, age, sick count, UKS
visits, height, weight, IMT, nutrition status, and **Terakhir Diukur** — the
measurement date is mandatory, because height/weight/IMT without a date can
mislead. Nutrition status is a text badge, never colour alone. Search, nutrition
filter, gender filter, attention-only toggle and sorting all write to the URL.
On narrow screens the table scrolls horizontally inside its container.

Each row exposes two ways into the student page: the **name itself is a link**
and the row keeps its **Lihat Detail** button. Only the name is clickable, not
the whole row — the row carries other controls, and a fully clickable row makes
table interaction ambiguous. Both use the stable `studentId`, never the name,
and both go to the existing
`/e-uks/pantauan-kesehatan?classId=…&studentId=…&returnTo=…`. No second student
detail page was created. `returnTo` carries the full class-page URL, so the
student page shows `← Kembali ke VII A` and returns to the same period, filters
and sorting.

Scroll position survives the round trip without any scroll-state store: each
`<tr>` carries `id={studentRowAnchor(studentId)}` (`siswa-<id>`), and the name
link appends that as a fragment to `returnTo`. Coming back, the browser's native
anchor handling puts the student that was opened back into view instead of
dumping the officer at the top of the charts.

`returnTo` is validated twice: `safeReturnPath()` rejects absolute URLs, schemes,
protocol-relative `//host`, backslashes and control characters, and
`safeClassReturnPath()` additionally requires the path to be the class
monitoring route itself. Internal-only is not enough — otherwise a crafted link
could point the back button at an unrelated internal page. Anything else yields
no back button at all.

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
| `EuksOfficer` | List | `userId` is nullable: officers may be a `User` (teacher) or a manually typed student/outsider. `onDelete: SetNull` plus a stored `name` keeps the roster readable after an account is removed. Optional 9:16 portrait photo |
| `EuksFacility` | List, unique `slug` | An informational list for the home page, not stock control — inventory belongs to Sarpras. Optional 4:3 cover photo |
| `EuksComplaintOption` | List, unique `slug` | Standard complaint spellings offered on the visit form |

Facilities and complaint options reuse the BOS category rules: a case or
whitespace variant revives the existing row instead of creating a duplicate,
and renames are rejected with 409 when they would collide with another row.

Officers and facilities support full CRUD. Toggling and deleting are
deliberately different actions and both are offered: the switch sets `active`
(the row stays, it just stops showing on Halaman Utama), while delete removes
the row permanently behind a confirmation dialog. Deleting an officer removes
only the `EuksOfficer` row — the linked teacher account is never touched,
because UKS membership is a relation, not ownership. Complaint options remain
deactivate-only, since deleting one would orphan nothing but also gains
nothing: visit history stores complaint text, not a reference.

Edit and delete live behind a `⋮` menu (`components/ui/menu.tsx`, a thin
wrapper over Base UI `Menu`) rather than inline icons, so a row stays readable
at a photo thumbnail, name, role, reorder arrows, and toggle.

### Settings photos

Officers and facilities each carry one optional photo, stored as
`photoData` / `photoMimeType` / `photoUpdatedAt` on their own row by
`20260912100000_add_euks_settings_photos`. All three columns are nullable with
no backfill: rows created before the feature simply have no photo and render a
placeholder.

Bytes live in the row rather than on disk, following `User.photoData` and
`SarprasPhoto`. That choice answers the file-handling questions structurally
instead of procedurally — there are no filenames to collide, no orphans when a
photo is replaced (the update overwrites the same columns) or when a record is
deleted (the bytes go with the row), no upload directory to mount in
VPS/Docker, and no path to traverse.

An officer photo is stored on `EuksOfficer`, never on the linked `User`.
Changing the roster photo of a teacher must not change that teacher's own
profile picture; the UKS module holds overrides, and it never writes to an
account.

| Endpoint | Method | Access |
|---|---|---|
| `/api/e-uks/officers/[officerId]/photo` | `GET` serve, `PUT` upload/replace, `DELETE` clear | GET `euks.view`; writes ADMIN |
| `/api/e-uks/facilities/[facilityId]/photo` | `GET` serve, `PUT` upload/replace, `DELETE` clear | GET `euks.view`; writes ADMIN |

`DELETE` clears the photo only and leaves the entry in place, so an admin can
return a row to the placeholder without recreating it.

The accepted type is decided by `detectProfilePhotoType()` on the file's magic
bytes, not the client's `Content-Type`, and the limit is
`MAX_EUKS_PHOTO_BYTES` (2 MB, matching Sarpras) checked on the request body —
a client-declared header cannot talk past either.

`lib/image-resize.ts` crops cover to the target ratio and shrinks the longest
edge to 1280 px in the browser before upload, so a 4000 px phone photo does not
have to be rejected for size. It degrades to the original file if the browser
lacks `createImageBitmap`, leaving the server checks to decide. The crop is
cover-to-centre precisely because the display uses `object-cover` — preview and
stored result then frame identically.

Photo URLs come from `euksOfficerPhotoUrl()` / `euksFacilityPhotoUrl()`, which
return `null` when `photoUpdatedAt` is null (so a photoless row renders the
placeholder instead of requesting a certain 404) and otherwise append
`?v=<timestamp>` so a replaced photo appears immediately rather than after the
browser cache expires. List queries select `photoUpdatedAt` only, never the
blob.

Upload is a second request after the row exists. If it fails, the officer or
facility is still saved without a photo and the toast says so — the failure
mode is a complete row missing a picture, never a half-written record.

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

### Home page composition

`/e-uks` is a landing page, not a dashboard: hero → pengurus → fasilitas →
ringkasan status gizi → insight → CTA. Statistics are kept in full but moved
below the identity sections, because a school profile page that opens with
counters reads as an admin screen. The nutrition summary follows the same rule —
it sits under the identity sections, and only for holders of
`euks.measurements.read` (see [School nutrition summary](#school-nutrition-summary-home-page)).

`EuksHeroImage` holds the hero slideshow, added by
`20260912110000_add_euks_hero_images` together with the nullable
`EuksProfile.serviceHours` / `.contact` columns. Photo bytes live in the row on
the same reasoning as officer and facility photos above, and admins manage the
list (add, replace, reorder, activate, delete) in Pengaturan E-UKS. There is no
maximum count — the school decides how many slides it wants.

Ordering is an explicit `sortOrder` integer, not creation order, so reordering
never depends on when a photo was uploaded. Reorder swaps the `sortOrder` of
two adjacent rows inside one transaction, which keeps the list consistent even
if two admins move photos at the same time. `isActive` lets a photo be taken
out of rotation without deleting it.

Hero photos are sized to 1920 px (`EUKS_HERO_MAX_EDGE`) rather than the 1280 px
used for cards, because a hero fills the viewport width where a card does not.

| Endpoint | Method | Access |
|---|---|---|
| `/api/e-uks/hero-images` | `POST` create, `PATCH` update/reorder, `DELETE` remove | ADMIN |
| `/api/e-uks/hero-images/[imageId]/photo` | `GET` serve, `PUT` upload/replace | GET `euks.view`; writes ADMIN |
| `/api/e-uks/hero-logos` | `POST` create, `PATCH` update/reorder, `DELETE` remove | ADMIN |
| `/api/e-uks/hero-logos/[logoId]/logo` | `GET` serve, `PUT` upload/replace, `DELETE` clear file | GET `euks.view`; writes ADMIN |

### Hero logos

`EuksHeroLogo` (migration `20260912120000_add_euks_hero_logos`) holds the
institution logos overlaid on the top-left of the hero. It is a separate table
from `EuksHeroImage` despite the similar shape: a logo is a static layer drawn
`object-contain` at a fixed height and may be an SVG, whereas a hero image is a
16:9 background cropped `cover` and never an SVG. Merging them would force a
"kind" column plus branching in every query and every component.

Logos accept JPG, PNG, SVG, and WebP up to 512 KB. `name` is required and
becomes the `alt` text, because a logo represents an institution and must not
degrade into an unlabelled image for screen-reader users.

SVG support is the reason `lib/euks-logo.ts` exists rather than reusing
`detectProfilePhotoType`. SVG has no magic bytes, so the detector skips the BOM,
XML declaration, comments, and DOCTYPE and then requires the first real element
to be `<svg` — searching for `<svg` anywhere would accept an HTML file with an
inline `<svg>`. Uploads that parse as SVG are additionally rejected when they
carry `<script>`, `<foreignObject>`, event handlers, `javascript:` URLs, remote
`<use>`, or entity definitions. Serving is defence in depth: logos are only ever
rendered through `<img src>` (which already blocks scripts and remote loads),
and the GET route adds `nosniff`, a `sandbox` CSP, and
`Cross-Origin-Resource-Policy: same-origin` so a logo opened directly in a tab
cannot inherit the app origin.

Logo files bypass `EuksPhotoField`, which resizes uploads through a canvas —
that would rasterise an SVG and destroy exactly what makes it worth uploading.

In the hero the logo row sits in the flex flow with `mb-auto` rather than being
absolutely positioned, so it cannot overlap the title when many logos wrap on a
narrow screen. `EuksHeroLogos` is wrapped in `memo`: the hero re-renders on
every slide change and the logos do not depend on the slide, so memoising keeps
the same DOM nodes alive and the logos genuinely never blink. Max width is set
to four times the height at each breakpoint (36/40/48 px → 144/160/192 px) so
that any logo up to a 4:1 ratio displays at full height, keeping the row
visually even.

The carousel is roughly sixty lines of component code with no new dependency.
What the page needs is a background crossfade, not a scrollable track: Embla,
Swiper, and Keen all ship a drag/snap engine whose behaviour would then have to
be switched off, and Embla's own fade plugin describes itself as eliminating
the concept of scrolling. Paying ~9.7 KB gzip to disable the feature being
imported is the wrong trade.

The title block is a sibling of the slide stack, not a child, so it is
structurally incapable of moving when a slide changes — the requirement is
enforced by the DOM shape rather than by CSS that a later edit could undo.

Autoplay runs at 6.5 s, pauses on hover and focus, and stops permanently once
the reader touches any control, following the APG carousel pattern; the pause
button is first in tab order and `prefers-reduced-motion` disables autoplay
entirely. A live region announces the current slide.

With no photos uploaded, the hero renders a leaf-green gradient with a dot
pattern instead of collapsing, so the page is presentable before the school has
supplied any imagery. The same applies per-section: officers fall back to
initials on a deterministic gradient, facilities to a mapped icon.

The `--euks-*` tokens in `app/globals.css` scope the leaf-green accent to this
module. The app's own primary colour is unchanged; E-UKS reads as a health unit
inside SISMEPDA rather than as a differently-themed app.

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

One departure from wireframe 03, forced by the free-text schema:

- The monthly chart plots total visits per month, not columns stacked by
  treatment type — stacking needs a fixed set of categories that does not exist.

Wireframe 02's identity content (profile, pengurus, fasilitas, hero photos) is
configuration managed in Pengaturan; the home page renders whatever is active
there.

Empty months inside the range are kept at zero rather than skipped, so a quiet
month reads as quiet instead of vanishing from the axis.

### Ringkasan Kunjungan visual grammar

The visit summary deliberately uses a *different shape per kind of question*,
because four blocks drawn as the same blue bar read as one repeated block and
the reader stops distinguishing them. Every number still comes from
`monthlyVisitCounts()` / `monthlyVisitStats()` / `rankTerms()` — the redesign
changed drawing only, not aggregation.

| Block | Shape | Question it answers |
|---|---|---|
| KPI band | three segments in one surface, small lucide icon each | how large |
| Tren Kunjungan UKS | line + soft area, full width | movement over time |
| Keluhan Terbanyak | ranked bars with `#n`, count and share | complaint ranking |
| Tindakan Terbanyak | lollipop (neutral stem + accent dot) | treatment ranking |

`monthlyVisitStats()` adds distinct visitors per month on top of the existing
month series; its `count` values are asserted equal to `monthlyVisitCounts()`
so a redesign can never silently move a number. Visits whose `studentId` is not
selected report `students: 0` rather than inventing a count.

The trend chart carries one thin dashed average reference line, one `Tertinggi`
marker, and nothing else — annotation past that competes with the data. The
final month is flagged `Sep*` when `isPartialFinalMonth()` says the last
recorded visit date is before the month's end, so a month still in progress is
not read as a collapse. One deterministic sentence sits under the chart (peak
month, plus the partial-month caveat); no causal claim is made, because nothing
in the data supports one.

Colour stays inside one accent family (`--euks-accent`) with hierarchy carried
by opacity and weight, never by hue per category, and every value is also
present as text or an SVG `<title>` so no information depends on colour. Point
hit areas are transparent 14px circles with `tabIndex`, so tooltips are
reachable by tap and keyboard, not hover only.

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

`/api/e-uks/officers` and `/api/e-uks/facilities` each expose `POST` (create), `PATCH` (edit fields, toggle `active`, or `move` one position) and `DELETE` (remove the row), all ADMIN-only and each writing an `AuditLog` entry (`EUKS_OFFICER_*`/`EUKS_FACILITY_*`, including `_PHOTO_UPDATED`) in the same transaction. The photo sub-routes are described under Settings photos.

`/api/e-uks/hero-images` exposes `POST` (create), `PATCH` (edit caption, toggle `active`, or `move` one position) and `DELETE`, all ADMIN-only, each writing an `EUKS_HERO_IMAGE_*` `AuditLog` entry in the same transaction. `PUT /api/e-uks/hero-images/[imageId]/photo` uploads or replaces the image; `GET` serves it to any `euks.view` reader. See Home page composition.

`/api/e-uks/hero-logos` mirrors that shape for the hero logo overlay: `POST`, `PATCH` (rename, toggle `active`, or `move` one position) and `DELETE`, ADMIN-only, each writing an `EUKS_HERO_LOGO_*` `AuditLog` entry in the same transaction. `PUT /api/e-uks/hero-logos/[logoId]/logo` uploads or replaces the file (JPG/PNG/SVG/WebP, 512 KB), `DELETE` clears it while keeping the row, and `GET` serves it to any `euks.view` reader. See Hero logos for the SVG validation rules.

## Open reference-data requirement

KMS (Kartu Menuju Sehat) growth charts require an official reference dataset (WHO/Kemenkes LMS or SD tables). No such dataset exists in the repository, so KMS curve values must not be invented, interpolated or read off a screenshot. See the technical debt registry.
