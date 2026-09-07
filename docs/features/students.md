# Students

ADMIN manages students at `/siswa` and imports/adds them at `/siswa/input`; legacy `/siswa/kelola` redirects to the canonical combined page. Students require a name, class, and at least one NIS or NISN. NIS and NISN are independently unique, editable and nullable. CSV/manual imports validate identifiers/classes; active status controls roster participation.

Permanent deletion requires a matching confirmation identifier. The handler removes related attendance rows and violation points before deleting the student; this is destructive and changes historical aggregates. Deactivation is the non-destructive alternative.

`/siswa/[studentId]` is the canonical authenticated profile. It is resolved through class scope, so an inaccessible student appears not found. The profile shows current identity/class/status, attendance counts and percentage over recorded rows, monthly trend, current consecutive-HADIR streak, latest ALFA, current-month absence count, and paginated/filterable history. Dates/status are validated and pages clamped. The displayed class for historic attendance is the student's **current class**; the schema has no enrollment or class-history snapshot.

Authenticated users can add violation points only for a student in their accessible class. Entries record category, positive points, optional note, occurrence date and recording user. Severity/progress is derived from cumulative points; deletion/editing is not exposed by the current endpoint.

Relationships: attendance and reporting rules are canonical in [Attendance](attendance-reporting.md); scope is in [Authorization](../architecture/authentication-authorization.md). Primary files are `app/api/admin/students/route.ts`, `app/siswa/**`, `lib/server-student-profile.ts`, and `app/api/students/[studentId]/violation-points/route.ts`.
