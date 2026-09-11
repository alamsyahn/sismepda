# Attendance and reporting

## Scope and flow

Authenticated users use the dashboard (`/`), attendance input, school/class/student recaps, WhatsApp report and export center. ADMIN sees all classes. GURU sees only their homeroom class unless the global all-class setting is enabled; the same filter must apply to every read, write and attendance export.

`GET /api/attendance?date=` returns accessible class rosters and holiday state. `POST /api/attendance` accepts a class, date and full roster of unique student IDs with `HADIR|SAKIT|IZIN|ALFA|DISPENSASI|BELUM`. The class and every student are scope-checked. Future dates and school holidays are rejected. `BELUM` deletes the student's `Attendance` row; filled statuses are upserted. Partial saves are valid, but a class is complete only when every active student has a real status. An `AttendanceDay` remains the class/date submission envelope and records submitter/timestamps.

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
