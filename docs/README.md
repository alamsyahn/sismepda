# SISMEPDA documentation map

This directory is the canonical description of the system as it works now. Start here, then open only the documents relevant to the task.

## Architecture

| Concern | Canonical document | Also read when |
|---|---|---|
| Boundaries, stack, request/data flow, module map | [System overview](architecture/overview.md) | Any cross-feature or unfamiliar task |
| Identity, sessions, roles, capabilities, class scope | [Authentication and authorization](architecture/authentication-authorization.md) | Access, users, protected routes, exports |
| Target RBAC model, permission catalog, surface policy inventory, migration phases | [Role-based access control](architecture/rbac.md) | Any authorization change, new protected surface, role/permission work |
| Models, ownership, lifecycle, migrations, binary data | [Database](architecture/database.md) | Schema, queries, backup/restore, data behavior |
| Upload slot registry, policy resolution, size/type enforcement, grandfathering | [Upload architecture](architecture/uploads.md) | Any feature that accepts a file or image from a user |
| Where uploaded bytes live, media keys, legacy bytea fallback, media migration, media backup | [Media storage](architecture/media-storage.md) | Any feature that stores, serves, or migrates binary media |
| Runtime topology, external networks, proxy, containers | [Deployment architecture](architecture/deployment.md) | Production/configuration changes |

## Features

| Domain | Canonical document | Primary routes |
|---|---|---|
| Attendance, dashboard, school/class/student recaps, trend, WhatsApp and attendance exports | [Attendance and reporting](features/attendance-reporting.md) | `/`, `/absensi/input`, `/rekap-*`, `/laporan-whatsapp`, `/export-data` |
| Student master data, profiles, history, violation points | [Students](features/students.md) | `/siswa`, `/siswa/[studentId]` |
| Teacher accounts, directory, employment, subjects, schedules, duties, homerooms | [Teachers and homerooms](features/teachers-homerooms.md) | `/guru`, `/guru/[teacherId]`, `/wali-kelas/input` |
| Personal profile, passwords, photos, site/app settings and branding | [Profiles and settings](features/profiles-settings.md) | `/profil`, `/pengaturan` |
| Teacher links, 19-item review, weighted supervision dashboard and audit | [Workbook supervision](features/workbook-supervision.md) | `/supervisi-buku-kerja` |
| Budget, categories, realization entries, document URLs and delegated rights | [BOS](features/bos.md) | `/bos` |
| Location tree, item types, quantities/condition, photos, history and delegated rights | [Sarpras](features/sarpras.md) | `/sarpras` |
| School health unit: visit log, student health monitoring, growth charts and UKS page content | [E-UKS](features/e-uks.md) | `/e-uks` |
| Lesson timetable, aSc TimeTables import, external ID mapping, time structure, revisions | [Jadwal](features/jadwal.md) | `/jadwal` |
| Subject master data (Data Master Mata Pelajaran) | [Jadwal](features/jadwal.md) | `/mata-pelajaran` |
| Scheduled WhatsApp attendance reports: Baileys worker, session, idempotency | [Automatic WhatsApp reporting](features/whatsapp-automation.md) | worker process |

Cross-feature rules are linked rather than repeated. Attendance class scope affects student profiles and attendance exports; teacher/homeroom management defines that scope. Audit logging is shared by Workbook, BOS, Sarpras, and E-UKS.

## Operations

- [Development and verification](operations/development.md)
- [Deployment, migration, rollback boundaries](operations/deployment.md) — `npm run deploy:check` / `deploy:prod` / `deploy:status`
- [Media rollout runbook: preflight, backup set, sekuensing, rollback](operations/media-rollout.md) — `npm run deploy:preflight` / `backup:production`
- [RBAC cutover runbook](operations/rbac-cutover.md)
- [Backup and restore](operations/backup-restore.md)
- [Local database workflow: dev vs production clone](operations/local-database-workflow.md)

## Active technical debt

- [Technical debt registry](technical-debt/README.md)

## Documentation maintenance

The required task lifecycle is: **read relevant docs → targeted code inspection → implement → test → review/update canonical docs**. Update an existing canonical file instead of creating a task-specific document. A full-system inspection is a separate mode and requires an explicit user request.
