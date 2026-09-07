# Profiles and settings

## Personal profile

Every authenticated user can view/update their own name, email/NIP and phone at `/profil`; changes that affect login identity require the current password. At least one login identifier must remain. Password changes require the current password, a different new password, and at least 8 characters. Profile photos accept JPEG, PNG or WebP up to 1 MB, are validated and stored in `User`, and are served privately with no-store semantics. The profile also owns the user's four external Workbook links.

## School and application settings

`/pengaturan` and `/api/admin/settings` are ADMIN-only. The singleton `SchoolSetting(default)` controls website title, application name/full name, school name/NPSN, academic year/semester, attendance time fields, global teacher class access, attendance status colors, favicon and app logo. Logo/favicon validation uses image signatures and rejects SVG; binary data is stored in PostgreSQL. Public branding endpoints support login/metadata rendering, while writes remain ADMIN-only.

The page also manages school holidays and invokes database backup/restore. Holiday dates are unique and attendance writes reject those dates. Status colors affect absence states globally; visually close colors trigger a warning rather than rejection.

See [Attendance](attendance-reporting.md) for what settings currently affect behavior and [Backup/restore](../operations/backup-restore.md) for destructive database operations. Primary files: `app/api/profile/**`, `app/api/admin/settings`, `app/api/admin/holidays`, branding routes, and `lib/server-site-branding.ts`.
