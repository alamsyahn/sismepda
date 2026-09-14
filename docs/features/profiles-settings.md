# Profiles and settings

## Personal profile

Every authenticated user can view/update their own name, email/NIP and phone at `/profil`; changes that affect login identity require the current password. At least one login identifier must remain. Password changes require the current password, a different new password, and at least 8 characters. Profile photos accept JPEG, PNG or WebP, are validated and stored in `User`, and are served privately with no-store semantics. The size limit comes from the `profile.user.photo` upload slot and is admin-configurable; see [Upload architecture](../architecture/uploads.md). The profile also owns the user's four external Workbook links.

## School and application settings

`/pengaturan` and `/api/admin/settings` are ADMIN-only. The singleton `SchoolSetting(default)` controls website title, application name/full name, school name/NPSN, academic year/semester, school IANA timezone, attendance time fields, global teacher class access, attendance status colors, favicon and app logo. The timezone defaults to `Asia/Jakarta`, accepts valid names such as `Asia/Makassar` and `Asia/Jayapura`, and controls timestamp display and the definition of “today”; it never changes business date-only values. Logo/favicon validation uses image signatures and rejects SVG; binary data is stored in PostgreSQL. Their size limits come from the `branding.app.logo` and `branding.favicon` upload slots. `/pengaturan` also hosts **Pengaturan Unggah**, which lists every configurable upload slot from the registry and requires `school.upload_policy.read` to view and `school.upload_policy.update` to change; see [Upload architecture](../architecture/uploads.md). Public branding endpoints support login/metadata rendering, while writes remain ADMIN-only.

The page also manages the school holiday calendar and invokes database
backup/restore. The calendar has three entry kinds, resolved by
`lib/holiday-rules.ts` and read through `lib/server-holidays.ts`:

- **Hari libur biasa** (`SINGLE`) — one dated day off.
- **Hari libur tetap** (`RECURRING`) — a weekday that repeats, valid from a
  start date to an optional end date; an empty end date means indefinitely and
  stays editable afterwards.
- **Hari masuk khusus** (`SCHOOL_DAY`) — cancels a holiday for one date.

School days win: a `SCHOOL_DAY` entry overrides both other kinds regardless of
the order rules are stored in, because overriding a holiday is exactly its
purpose. Recurring rules cannot be filtered by date range in SQL, so every rule
is read and evaluated in the application; the calendar is small enough that this
costs nothing and it keeps one piece of logic authoritative everywhere. A date
may hold one entry per kind, so `SINGLE` and `SCHOOL_DAY` can coexist and be
toggled without deleting either. Attendance writes reject resolved holiday
dates. Status colors affect absence states globally; visually close colors trigger a warning rather than rejection.

See [Attendance](attendance-reporting.md) for what settings currently affect behavior and [Backup/restore](../operations/backup-restore.md) for destructive database operations. Primary files: `app/api/profile/**`, `app/api/admin/settings`, `app/api/admin/holidays`, branding routes, and `lib/server-site-branding.ts`.
