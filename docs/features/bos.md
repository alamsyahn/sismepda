# BOS

BOS records an optional initial budget, normalized categories, realization entries and external documentation links. `/bos` shows budget/realisasi/sisa/percentage, top-five category breakdown plus “Lainnya”, and entries. Balance, percentage and overspend are derived; missing/zero budget yields no percentage, while overspend may exceed 100% and produce a negative balance. Money is PostgreSQL `Decimal(14,2)` and rendered as rupiah.

An entry has category, description, Jakarta calendar date, amount, creator/updater and zero or more optional-label HTTP(S) document URLs. Files are not uploaded. New entries require an active category. Category names are whitespace-normalized and case-insensitive through a unique slug; creating an existing inactive category revives it. Categories with history are deactivated rather than removed by the current API.

GURU rights are independent booleans: view, create entry, edit data/budget, manage categories, and manage access. Any non-view right implies view; ADMIN always passes. Unlike Sarpras, a delegated GURU can grant/revoke BOS rights at `/bos/akses`. Guards re-read rights from the database. Mutations write atomic audit entries, but there is no dedicated BOS audit-history UI.

There is no delete endpoint for BOS entries. Primary files: `app/bos/**`, `app/api/bos/**`, `lib/bos*.ts`, `lib/server-bos.ts`. See [Authorization](../architecture/authentication-authorization.md).
