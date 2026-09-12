# BOS

BOS records an optional initial budget, normalized categories, realization entries and external documentation links. `/bos` shows budget/realisasi/sisa/percentage, top-five category breakdown plus “Lainnya”, and entries. Balance, percentage and overspend are derived; missing/zero budget yields no percentage, while overspend may exceed 100% and produce a negative balance. Money is PostgreSQL `Decimal(14,2)` and rendered as rupiah.

An entry has category, description, a timezone-independent school calendar date, amount, creator/updater and zero or more optional-label HTTP(S) document URLs. Files are not uploaded. New entries require an active category. Category names are whitespace-normalized and case-insensitive through a unique slug; creating an existing inactive category revives it. Categories with history are deactivated rather than removed by the current API.

Authorization is RBAC, read from the current database on every request. Operations are separately delegable: `bos.read`, `bos.entries.create`, `bos.entries.update`, `bos.budget.update`, `bos.categories.create`, `bos.categories.update`. Holding one never widens another — an entry creator cannot change the budget.

`/bos/akses` remains a **domain-scoped delegation exception**: a holder of `bos.access.manage` may assign or unassign only the five server-allowlisted `legacy_bos_*` bundles. The request carries a bundle key, never a role id, and the bundle's live permission set is re-checked against the expected BOS-only set on every call, so a bundle contaminated with cross-domain permissions is refused. Targets holding a protected role are refused. It cannot grant arbitrary roles, touch account status, password, e-mail or NIP, and it is never equivalent to global RBAC assignment. Because permissions union across roles, removing a bundle does not guarantee the user loses BOS access — another role or grant may still provide it, and the UI says so.

There is no delete endpoint for BOS entries. Primary files: `app/bos/**`, `app/api/bos/**`, `lib/bos*.ts`, `lib/server-bos.ts`. See [RBAC](../architecture/rbac.md) and [Authorization](../architecture/authentication-authorization.md).
