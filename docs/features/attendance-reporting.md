# Attendance and reporting

## Scope and flow

### Scan Siswa

`/scan` (top-level **Scan Siswa**, directly below **Dashboard**, alongside **Absensi**) is the shared operational entry point for
**Kehadiran** and **Kunjungan UKS**. The default is Kehadiran when the account can
use it; a UKS-only operator opens directly in UKS. Camera access is requested
only by **Aktifkan kamera**, prefers the rear camera, and requires HTTPS. The
lazy-loaded `qr-scanner` package supplies a decoder fallback where native
BarcodeDetector is unavailable. Camera tracks stop on source/page change.

Laptop scanners must support **2D QR**, USB HID keyboard mode and an automatic
Enter suffix. Enter is sent by the device, not manually by the operator. The
dedicated input receives focus on entry and after a completed scan; losing focus
shows **Scanner belum siap** with an activation button. No global keyboard
capture is installed. During UKS entry the scanner is paused, so a scanned code
cannot replace a student or enter a complaint field. Name/NIS/NISN lookup is a
separate, explicit manual source with the same server scope.

`POST /api/scan` resolves an active opaque `SP1:` credential and, for attendance,
creates `Attendance` in the existing class/date `AttendanceDay`. Missing rows
remain **Belum diisi** until a real attendance action occurs. A second scan gets
a new `ScanEvent` but never a second attendance or a changed first-arrival time.
Existing SAKIT/IZIN/ALFA/DISPENSASI is retained and produces **Perlu ditinjau
petugas**. Holiday scans and scans outside configured attendance open/close times
when `autoLock=true` are logged without changing attendance. Time is derived from
the server instant and configured school zone, never the scanner's clock.

`ScanEvent` stores the server timestamp, school date, class snapshot, source,
operator identity snapshot, result and optional visit link. It never stores the
raw QR or UKS complaint/treatment. Each physical scan has a UUID request id;
retries reuse it. `(actorId, requestId)` is represented by a unique requestKey,
with a payload fingerprint and transaction lock: replay returns the same result;
reusing an id for another command returns 409. Continuous camera frames are
debounced separately from intentional repeat scans. In-flight requests block a
new scan. After a network error, the screen offers replay of the same command
and never claims it was saved without server confirmation. Offline capture is
not supported. A pending UKS form stays in memory, not browser persistence.

All attendance writers use `lockAttendanceDay` and an integer
`AttendanceDay.revision`. GET returns the revision; roster POST must send the
loaded revision, checks it under the same lock, increments it, and rejects a
stale roster with 409. Scan increments it only when adding attendance. A local
draft is tagged with its base revision and is not applied on top of a newer
server revision. This prevents a teacher's older full-roster save from clearing
new scanner attendance. Successful writes keep the existing completion-report
trigger; scanning does not notify teachers once per arrival.

`GET /api/scan` returns current capabilities and acts as a 15-second foreground
connection/RBAC check. `GET /api/scan/students` returns a limited, authorized
identity projection for lookup/cards. `GET /api/scan/history` is date/mode/name
filtered and paginated (30 rows); its active tab refreshes every 10 seconds.
Attendance history follows **read** scope independently of scanner **write**
scope. UKS history requires `euks.visits.read`; health details are not included.
Unresolved/deleted identities are shown only to the recording operator. The
history never infers an attendance/visit from a failed or cancelled scan.

Access is explicit: `scan.attendance.use` **and** `attendance.write.*` for
attendance; `scan.uks.use` **and** `euks.visits.create` for UKS; `scan.history.read`
**and** the appropriate domain read permission for history; `scan.cards.manage`
**and** `students.master.read` for card administration. Navigation/page access
uses the union; each API still enforces its own operation and scope against the
current database. CSRF origin checks protect all new scan mutations. New keys
are registered by migration without granting them to existing roles. Assign
operator permissions through **Pengaturan → Akses**; a gate operator processing
all classes needs explicit `attendance.write.all` (or the documented teacher
class-widening policy), not just permission to see the Scan menu.

The additive migration `20261102090000_student_scan` adds only QR credentials,
scan events, attendance revision and catalog entries. Card lifecycle belongs to
[Students](students.md); UKS save/notify behavior belongs to [E-UKS](e-uks.md).
Tests: `tests/scan.test.ts`, guarded `scan-integration.test.ts` (complete forward
migrations in a fresh isolated local schema, concurrency and replay), and
`scan-http.integration.test.ts` (signed temporary local sessions, real API guards,
scope, revocation, CSRF, stale roster and UKS save permission). Run local suites
serially via `scripts/with-db.ts local`; they clean their fixtures and do not
contact WhatsApp or production.

Authenticated users use the dashboard (`/`), attendance input, school/class/student recaps, WhatsApp report and export center. ADMIN sees all classes. GURU sees only their homeroom class unless the global all-class setting is enabled; the same filter must apply to every read, write and attendance export.

`GET /api/attendance?date=` returns accessible class rosters and holiday state. `POST /api/attendance` accepts a class, date and full roster of unique student IDs with `HADIR|SAKIT|IZIN|ALFA|DISPENSASI|BELUM`. The class and every student are scope-checked. Future dates and school holidays are rejected. `BELUM` deletes the student's `Attendance` row; filled statuses are upserted. Partial saves are valid, but a class is complete only when every active student has a real status. An `AttendanceDay` remains the class/date submission envelope and records submitter/timestamps.

Attendance input has a name search box (`filterRosterByName` in
`lib/attendance-input.ts`) that filters the roster as the user types; all typed
words must appear in the name but order does not matter. It is a **display
filter only**: the save payload, the status summary and the bulk actions keep
using the full roster, because submitting a filtered roster would clear the
hidden students' statuses. Row numbers also come from the full roster, so they
still point at the student's position in the class. Changing class clears the
keyword, otherwise the new class looks empty for no visible reason. A `siswa`
query parameter pre-fills the box, which is how the E-UKS sick-absence table
jumps straight to one student alongside `classId` and `date`.

### Navigating to a student profile and back

Picking a class calls `router.replace()` with `?classId=…&date=…` (replace, not
push, so switching classes does not pile up history entries). Opening the page
with `classId` selects that class and loads its attendance immediately.

Only the student's name is a link to the profile — rows and cards stay
non-clickable to avoid accidental navigation. Opening a profile is a full page
navigation, so the editor unmounts and unsaved input would be lost. Before
navigating, `ProfileNameLink`'s `onNavigate` hook makes the page write two
`sessionStorage` entries (`lib/attendance-draft.ts`):

- the **draft** (statuses, notes, pending absences), scoped to class + date;
- the **return position** (the clicked `studentId`).

On the way back, the draft is layered over the freshly fetched server data —
only for students still on the roster, and only when class and date match, so
server data is never silently overwritten. A restored draft that differs from
the server marks the form dirty again. The return position is consumed once:
after the roster renders, the row element (`student-<studentId>` on desktop,
`student-mobile-<studentId>` on mobile) is scrolled into view with
`block: "center"`, then cleared. The draft is dropped after a successful save
and when switching classes. Nothing here touches the schema or database.

### Status selection UI

The form presents three primary statuses only — **Belum Diisi, Hadir, Tidak
Hadir** — as an accessible radio group (roving tabindex, arrow keys, check icon
so selection never depends on colour alone). "Tidak Hadir" is a UI grouping, not
a database status: choosing it reveals an inline radio group of Sakit / Izin /
Alfa / Dispensasi, and only that choice writes a real status. Until a reason is
picked the student stays `belum`, so no absence value can be submitted without
being chosen. Switching back to Hadir or Belum Diisi drops the reason and clears
its note. Existing records reopen with Tidak Hadir plus the stored reason and
note already selected. The status legend above the roster shows the same three
groups, where Tidak Hadir is the sum of the four reasons.

A note is **required** for every absence reason. Label, placeholder and error
message follow the reason (`absenceNoteCopy` in `lib/attendance-input.ts`);
helper text reads "Wajib diisi" until the field is blurred while empty or the
user presses Simpan, only then does the inline error appear, and it clears as
soon as a value is typed.

The note field has two local modes. In edit mode it is an input plus a check
button; Enter, the check button, or blurring with valid content **finalises it
locally** — the field collapses into a read-only summary (check icon, text,
pencil button to reopen). `enterKeyHint="done"` makes mobile keyboards offer a
Done action. An empty value never finalises: focus stays in the input and the
inline error appears. Finalisation is display state only, so the UI deliberately
never says "Tersimpan" — nothing reaches the database until Simpan. Records
loaded from the server open in summary mode because their notes are already
complete. Changing the reason (Izin → Sakit) discards the old note, returns to
edit mode and refocuses the input with the new placeholder; switching to Hadir
or Belum Diisi, Semua Hadir and Kosongkan Semua also drop the finalised state.

Hadir and Belum Diisi show no note field at all (a
"—" placeholder on desktop). Both Simpan buttons behave identically: they show a
live count from the full roster ("⚠ N siswa masih memerlukan keterangan" versus
"✓ Semua data wajib sudah lengkap"), and pressing Simpan with a missing note
blocks submission, reveals the inline errors, clears an active name filter if it
hides the offender, then smooth-scrolls (with sticky-header offset) and focuses
the first offending note input — no native validation, alert or modal. Desktop
keeps the table layout; below `lg` each student becomes a stacked card with
touch-sized controls and a two-column reason grid. Semua Hadir and Kosongkan
Semua also reset the pending/error state so no absence parent stays active.

## Reporting rules

- Dashboard attendance percentage is HADIR divided by all **recorded statuses**, not registered students. Completion is complete classes divided by accessible classes.
- Daily school recap shows class/status summaries and absence ranking. The trend API supports daily, weekly, monthly and “since semester start” ranges, count/percentage displays, comparison with the immediately preceding equal-length range, holidays, future/no-data days and known missing records. Semester starts are derived from academic year plus semester (July 1 or January 1).
- Class recap has daily, cumulative and calendar/matrix views. A requested period is inclusive and limited to 31 days. Holidays override attendance; missing row on a submitted partial day remains “Belum diinput”. XLSX export includes all students regardless of UI absence filtering.
- Student recap lists daily student status and links to profiles.
- WhatsApp output provides absent/unfilled students and incomplete-class summaries; `S/I/A/D/?` are the compact symbols. It produces copyable text only—there is no WhatsApp API integration.
- CSV export types are students, teachers, homerooms, holidays,
  attendance-by-student and attendance-by-class. The holiday export carries
  `Tipe, Tanggal, Hari, Mulai, Sampai, Keterangan`; a year filter narrows dated
  entries but always keeps recurring rules, which are not tied to one year. Master-data exports require ADMIN; attendance exports follow class scope. Delimiter is validated and output includes BOM, download-safe filenames, no-store caching and formula-injection protection.

## Settings and edge cases

`SchoolSetting` stores academic year, semester, IANA `timeZone`, input open/close times, auto-lock and colors. The timezone defaults to `Asia/Jakarta` but may be set to `Asia/Makassar`, `Asia/Jayapura`, or another valid IANA zone. It applies only when deriving “today” or displaying/comparing real timestamps; date-only attendance and holiday values remain canonical `YYYY-MM-DD` and PostgreSQL `DATE` regardless of host, database-session, browser, Docker, or VPS timezone. Server code reads and passes the setting per request; client code consumes `SchoolTimeZoneProvider`. Current code uses close time for “on time” dashboard status and exposes the time/auto-lock settings, but attendance POST does not enforce open/close or auto-lock. Status color similarity is a non-blocking warning.

Primary code: `app/api/attendance*`, `app/api/dashboard`, `app/api/class-recap*`, `app/api/recap-students`, `app/api/export`, `lib/server-{dashboard,class-recap,attendance-trend,whatsapp-report}.ts`, and associated feature components.
