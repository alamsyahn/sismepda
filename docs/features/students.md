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
**Cetak kartu pelajar** to print all selected students, automatically issuing only
missing credentials. Existing active credentials are retained, including cards
issued before this feature. **Terbitkan QR yang belum ada** still skips existing
cards; **Ganti QR terpilih** requires explicit confirmation and revokes old cards.

The QR is `SP1:` plus 24 cryptographically random bytes in base64url, linked to
`Student.id`, not NIS/NISN or a public profile URL. Only its SHA-256 hash is stored
in `StudentQrCredential`. A partial unique index permits one active credential per
student. Rotation is serialized, checks the expected current credential, and
revokes the prior token. It writes an audit event without token material. Moving
class or correcting a number does not require reissuing the QR. Deactivation
prevents new scans. A static QR can be copied: scanning is an authenticated,
supervised operator activity and displays name, class and identifier for checking;
it is not student self-attendance or identity proof on its own.

For reprints, `SP2:<tokenHash>:<HMAC-SHA256>` signs the existing credential hash
with `AUTH_SECRET` (fallback `NEXTAUTH_SECRET`) and a domain-specific prefix.
No plaintext token storage or schema migration is needed. SP1 and SP2 resolve
to the same database row, share the same scan/rotation lock, and are both
invalidated by revocation. Signatures are checked in constant time before lookup;
unsigned hashes are never accepted. Rotating the authentication secret invalidates
SP2 prints made with the old key; SP1 originals are unaffected. Printing requires
the same two permissions and origin check as issuing. Reprint-only requests do
not create issuance audit entries; mixed requests audit only new credentials.

Cards measure 90 × 55 mm and follow the navy/blue school design, using the app
logo, school name, student name, NIPD / NIS and class. The header title and school
name share a centered separator; identity rules are thin light blue. A vector
Code 128 barcode below the QR encodes the existing NIS string exactly, including
five-digit identifiers and leading zeroes; the same digits appear below the bars.
It is generated locally using `bwip-js` (Code 128 encoder), with a ten-module white quiet
zone on both sides, without an external barcode service. Missing or non-numeric
NIS displays an unavailable message instead of inventing a value or substituting
NISN. The barcode is an identifier for compatible external services; `/scan`
attendance/UKS continues to require the existing SP1/SP2 QR credential. Adding
the barcode does not rotate credentials or change stored student data/schema.
QR fields include a four-module quiet zone and retain their 24 mm image size.
Print settings offer A4 (default), A3, F4 (210 × 330 mm), custom
dimensions in mm, and portrait/landscape orientation. The preview paginates
complete cards with 5 mm cutting gaps and 8 mm page margins (8 cards on A4
portrait, 9 landscape). Print at 100% with browser headers/footers disabled and
matching printer paper. The school logo is embedded before printing. Scanner/
device/print testing remains necessary for each school's hardware.

## Akun pribadi siswa

Administrator dengan `students.accounts.manage` membuat akun di `/pengaturan/akun-siswa`. Saat ini pembuatan hanya untuk siswi aktif pengguna Kartu Menstruasi, dengan email dan kata sandi sesuai kebijakan akun aplikasi. Tautan `User.studentId` unik mencegah dua akun untuk satu siswa; provisioning tidak mengambil alih akun yang sudah ada. Role `siswa` harus berisi tepat `euks.menstruation.read.own/create.own/update.own`; role yang belum dikonfigurasi menghasilkan pesan konfigurasi, bukan akun tanpa akses. Login memakai email dan kata sandi, bukan NIS/NISN. Pengguna dengan izin `accounts.credentials.manage`/`accounts.status.manage` dapat mereset kata sandi/menonaktifkan akun di Pengguna. Detail pencatatan dan privasi berada di [E-UKS](e-uks.md).

Relationships: attendance and reporting rules are canonical in [Attendance](attendance-reporting.md); scope is in [Authorization](../architecture/authentication-authorization.md). Primary files are `app/api/admin/students/route.ts`, `app/siswa/**`, `lib/student-input.ts` (pure parsing/validation, including demographics), `lib/server-student-profile.ts`, and `app/api/students/[studentId]/violation-points/route.ts`.
