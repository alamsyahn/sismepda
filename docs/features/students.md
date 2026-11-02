# Students

ADMIN manages students at `/siswa` and imports/adds them at `/siswa/input`; legacy `/siswa/kelola` redirects to the canonical combined page. Students require a name, class, and at least one NIS or NISN. NIS and NISN are independently unique, editable and nullable. CSV/manual imports validate identifiers/classes; active status controls roster participation.

Birth date and sex (`birthDate`, `gender`) are optional demographic fields consumed by [E-UKS](e-uks.md) for BMI-for-age. They can be filled in three places: the manual form at `/siswa/input`, the CSV import, and the edit dialog at `/siswa`. Both are nullable so the roster stays usable while they are filled in gradually — an empty value never blocks a save, and an empty CSV cell never overwrites an existing value. CSV accepts the optional trailing columns `tanggal_lahir` and `jenis_kelamin`, located by header name so files written before these columns existed still import unchanged. `tanggal_lahir` accepts `YYYY-MM-DD`, `DD/MM/YYYY`, or `DD-MM-YYYY`; `jenis_kelamin` accepts `L`/`P` or `Laki-laki`/`Perempuan`. A row whose value is present but unparseable is flagged (`tanggal_lahir_tidak_valid`, `jenis_kelamin_tidak_valid`) rather than silently imported blank.

`CsvDelimiterField` (shared by student import, teacher import, and
`/export-data`) offers comma, semicolon, tab, pipe, or a typed character.
Two constraints hold it together: the tab option's value must come from a
TypeScript string expression, because a JSX attribute like `value="\t"` yields
backslash-plus-t — a two-character delimiter that fails `isValidCsvDelimiter()`
and makes the parser throw. And the trigger must map the selected value to a
label, since Base UI's `SelectValue` otherwise renders the raw delimiter
character. `tests/csv-delimiter-field.test.ts` asserts both.

Permanent deletion requires a matching confirmation identifier. The handler removes related attendance rows and violation points before deleting the student; this is destructive and changes historical aggregates. Deactivation is the non-destructive alternative. A linked personal account or any menstrual record/history/conflict blocks permanent deletion with HTTP 409 before any attendance is removed; sensitive history is not erased automatically.

`/siswa/[studentId]` is the canonical authenticated profile. It is resolved through class scope, so an inaccessible student appears not found. The profile shows current identity/class/status, attendance counts and percentage over recorded rows, monthly trend, current consecutive-HADIR streak, latest ALFA, current-month absence count, and paginated/filterable history. Dates/status are validated and pages clamped. The displayed class for historic attendance is the student's **current class**; the schema has no enrollment or class-history snapshot.

Authenticated users can add violation points only for a student in their accessible class. Entries record category, positive points, optional note, occurrence date and recording user. Severity/progress is derived from cumulative points; deletion/editing is not exposed by the current endpoint.

## Kartu QR siswa

`/scan` → **Kartu QR** issues printable cards per class with
`scan.cards.manage` plus `students.master.read`. Select students and choose
**Terbitkan QR yang belum ada**, or explicitly confirm **Ganti QR terpilih**.
Only new tokens are returned; existing active cards are skipped unless replaced.
Raw tokens are held only in that browser session and printable as cards/PDF;
print/save them before closing the tab. Reloading cannot recover an old token.

The QR is `SP1:` plus 24 cryptographically random bytes in base64url, linked to
`Student.id`, not NIS/NISN or a public profile URL. Only its SHA-256 hash is stored
in `StudentQrCredential`. A partial unique index permits one active credential per
student. Rotation is serialized, checks the expected current credential, and
revokes the prior token. It writes an audit event without token material. Moving
class or correcting a number does not require reissuing the QR. Deactivation
prevents new scans. A static QR can be copied: scanning is an authenticated,
supervised operator activity and displays name, class and identifier for checking;
it is not student self-attendance or identity proof on its own.

The printable sheet uses 35 mm QR fields with quiet zones, name, class, school,
and NIS (or NISN where NIS is absent). Scanner/device/print testing remains
necessary for each school's hardware. No student photo field or upload is added.

## Akun pribadi siswa

Administrator dengan `students.accounts.manage` membuat akun di `/pengaturan/akun-siswa`. Saat ini pembuatan hanya untuk siswi aktif pengguna Kartu Menstruasi, dengan email dan kata sandi sesuai kebijakan akun aplikasi. Tautan `User.studentId` unik mencegah dua akun untuk satu siswa; provisioning tidak mengambil alih akun yang sudah ada. Role `siswa` harus berisi tepat `euks.menstruation.read.own/create.own/update.own`; role yang belum dikonfigurasi menghasilkan pesan konfigurasi, bukan akun tanpa akses. Login memakai email dan kata sandi, bukan NIS/NISN. Pengguna dengan izin `accounts.credentials.manage`/`accounts.status.manage` dapat mereset kata sandi/menonaktifkan akun di Pengguna. Detail pencatatan dan privasi berada di [E-UKS](e-uks.md).

Relationships: attendance and reporting rules are canonical in [Attendance](attendance-reporting.md); scope is in [Authorization](../architecture/authentication-authorization.md). Primary files are `app/api/admin/students/route.ts`, `app/siswa/**`, `lib/student-input.ts` (pure parsing/validation, including demographics), `lib/server-student-profile.ts`, and `app/api/students/[studentId]/violation-points/route.ts`.
