# Upload architecture

Every user-controlled file or image upload passes through one policy. There is no per-route size constant anywhere in the application: a route that needs a limit declares an Upload Slot instead.

## Layers

| Layer | File | Imports Prisma | Purpose |
|---|---|---|---|
| Slot registry | `lib/upload-slots.ts` | no | Code-defined inventory of every place that accepts a file |
| Policy resolver | `lib/upload-policy.ts` | no | Pure resolution and validation; configuration arrives as an argument |
| Server enforcement | `lib/server-upload-policy.ts` | yes | Reads persisted configuration, then enforces |
| Client hook | `lib/use-upload-policy.ts` | no | Fetches the resolved policy for one slot for UX only |

The registry and resolver are client-safe by design. Client components may import them as values; they must not import `lib/server-upload-policy.ts` as a value, which would pull `pg` into the browser bundle and break `next build`.

## Resolution order

```
upload request → slot key → resolver
    ├─ admin override for this slot?      → use it
    ├─ else admin global for the category → use it
    ├─ else slot's own defaultMaxBytes    → use it
    └─ else category default in code      → use it
unknown slot → UploadPolicyError (UPLOAD_SLOT_UNKNOWN), never unlimited
```

`defaultMaxBytes` on each slot reproduces the limit that route enforced before the central policy existed, so enabling this subsystem changed no behavior. Category defaults in code (`DEFAULT_GLOBAL_LIMITS`) are 2 MB for `image` and 5 MB for `document` — chosen to match the most common existing limits rather than to raise them; they only apply to slots that declare no default of their own.

Configured values are rejected unless they are safe integers between `MIN_CONFIGURABLE_UPLOAD_BYTES` (32 KB) and `MAX_CONFIGURABLE_UPLOAD_BYTES` (64 MB). An invalid stored value is ignored and resolution falls through to the next source rather than widening the limit. Bytes are the authoritative representation everywhere; MB appear only in the UI.

## Registered slots

| Key | Module | Category | Default |
|---|---|---|---|
| `profile.user.photo` | Profil & Akun | image | 1 MB |
| `teachers.master.photo` | Data Guru | image | 1 MB |
| `branding.app.logo` | Branding Aplikasi | image | 1 MB |
| `branding.favicon` | Branding Aplikasi | image | 512 KB |
| `euks.officer.photo` | E-UKS | image | 2 MB |
| `euks.facility.photo` | E-UKS | image | 2 MB |
| `euks.hero.image` | E-UKS | image | 2 MB |
| `euks.hero.logo` | E-UKS | image | 512 KB |
| `sarpras.item.photo` | Sarpras | image | 2 MB |
| `students.import.csv` | Data Siswa | document | 5 MB |
| `teachers.import.csv` | Data Guru | document | 5 MB |
| `database.restore.archive` | Operasi Sistem | document | 200 MB, `configurable: false` |

`database.restore.archive` is the single non-configurable slot: a restore archive size is an operational property of the backup, not a school policy, and lowering it from the settings page would silently break restore. It is excluded explicitly in the registry, not omitted, so the exclusion stays visible.

BOS stores document URLs only (`BosDocument.url`) and accepts no file, so it has no slot. Teacher photos have two write paths with two slots: a teacher uploading their own photo uses `profile.user.photo`, while an administrator editing a teacher from Data Master > Guru uses `teachers.master.photo`. The slots are separate so a school can raise the administrator limit without also raising what every teacher may upload.

## Enforcement

Size is checked twice on the server, both before storage:

1. `assertRequestSizeWithinSlot(slotKey, request)` rejects on `content-length` before `formData()` runs, so an oversized body is refused without being buffered.
2. `assertUploadAllowedForSlot(slotKey, candidate)` validates the actual byte length and the detected type.

Type validation reads the file's magic bytes through the existing per-domain detectors (`detectProfilePhotoType`, `detectAppLogoType`, `detectFaviconType`, `detectEuksLogoType`). The client-supplied `file.type` and the filename extension are never trusted, and the SVG sanitizer on E-UKS logos is unchanged. Domain validation that is not about size — CSV structure, image dimensions, Sarpras quantity rules — is untouched by this subsystem.

`UploadPolicyError` carries its own HTTP status: 413 `FILE_TOO_LARGE`, 415 `FILE_TYPE_NOT_ALLOWED`, 400 `UPLOAD_POLICY_INVALID`, 400 `UPLOAD_SLOT_UNKNOWN`. `describeAuthFailure` in `lib/api-errors.ts` passes those through unchanged, so every handler that already routes errors there — including `euksErrorResponse` — reports them correctly. Messages are Indonesian and name the file, its size, and the limit; no stack trace or internal path is exposed.

The client hook exists for UX only. It cannot relax anything: the server resolves the slot, policy, limit, and allowed types from its own configuration and ignores any policy value sent by the client.

## Grandfathering and replacement

A stored file is never re-examined. The only size gate runs while accepting an upload, and the policy modules touch no table other than their own configuration — a property asserted by `tests/upload-policy.test.ts`. Lowering a limit therefore leaves existing assets valid, displayable, and unmodified. There is deliberately no background revalidation, recompression, or cleanup job.

Replacing a file is an ordinary new upload and is judged by the current policy. An 8 MB image stored under a 10 MB limit stays; re-uploading the same 8 MB image after the limit drops to 5 MB is rejected.

## Persistence

| Data | Where | Note |
|---|---|---|
| Slot inventory | code (`lib/upload-slots.ts`) | keeps auto-discovery and enforcement on one source of truth |
| Global default per category | `SchoolSetting` nullable columns | `NULL` means "use the code default", not "unlimited" |
| Per-slot override | `UploadPolicyOverride` keyed by `slotKey` | a new slot needs no migration |

`UploadPolicyOverride.updatedById` intentionally has no relation to `User`: deleting an account must not delete school policy. The full actor trail lives in `AuditLog` under entity `UploadPolicy`, action `UPLOAD_POLICY_UPDATED`, with `entityId` fixed to `"default"`.

## Administration

`/pengaturan` renders the **Pengaturan Unggah** section (`components/settings/upload-policy-settings.tsx`), which reads `GET /api/admin/upload-policy`. That endpoint builds its list from `configurableUploadSlots()` and groups by the registry's `module` field, so a newly registered slot appears with no change to the page. Editing calls `PUT` on the same route, which authorizes first, then validates the slot key against the registry and the value against the configurable bounds.

Permissions are `school.upload_policy.read` and `school.upload_policy.update`, following the existing `school.*` convention. They need no template or invariant change because `system_admin` reaches them through the established bypass key, exactly like `school.branding.update`. `GET /api/upload-policy` is the read-only endpoint client components use; it requires a session but no admin permission.

## Adding a new upload

1. Register the slot in `lib/upload-slots.ts` with a stable key, label, module, category, and — if the feature has a justified limit of its own — `defaultMaxBytes`.
2. In the server handler, call `assertRequestSizeWithinSlot(key, request)` before parsing, then `assertUploadAllowedForSlot(key, { size, detectedMimeType })` before storing.
3. Write no size constant. A `const MAX_..._BYTES` in a route is the anti-pattern this subsystem removed.
4. In the client component, call `useUploadPolicy(key)` for the displayed limit and the early rejection message.
5. The Administration page picks the slot up automatically; add it to the route list in `tests/upload-policy.test.ts` so enforcement stays asserted.

A slot that must not be admin-configurable sets `configurable: false` and explains why in `description`.
