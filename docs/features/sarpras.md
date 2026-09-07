# Sarpras

Sarpras models an unlimited-depth location tree, reusable item types, one item aggregate per location/type, photos and change history. `/sarpras` provides summary/status views, priority table, location browsing and item detail. Locations may contain both children and items; names are slug-unique per parent, including a database-enforced root uniqueness rule. Reparenting into self/descendants is rejected. Locations/item types in use cannot be deleted.

Each item stores target and available quantities, with available partitioned exactly into good, moderate and repair quantities. Values must be nonnegative; available may exceed target and is reported as surplus. Derived condition/status uses unit counts and the worst applicable condition; missing need is `max(target-available, 0)`. Optional metadata includes acquisition date, inventory code, description and HIGH/MEDIUM/LOW priority.

Up to six photos may be stored per item; each JPEG/PNG/WebP photo is limited to 2 MB and stored as database bytes. Item changes also create `SarprasHistory` snapshots. Mutations to locations, types, items and access write generic `AuditLog`; photo mutation is not represented in that generic audit list.

GURU may have view and/or edit; edit implies view. ADMIN always passes and only ADMIN manages access at `/sarpras/akses`. Viewers can read photos/history; every mutation requires edit. Primary files: `app/sarpras/**`, `app/api/sarpras/**`, `lib/sarpras*.ts`, and `lib/server-sarpras.ts`.
