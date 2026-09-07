# Teachers and homerooms

ADMIN manages teacher accounts at `/guru` and creates/imports them at `/guru/input`; `/guru/kelola` redirects to `/guru`. A teacher login requires at least email or NIP, both unique where present. Accounts hold active state, role, contact/profile data and delegated capabilities. Permanent deletion requires identifier confirmation and reassigns restrictive attendance submissions to the acting admin before removing the user. It does not reassign `StudentViolationPoint.recordedById`, so deletion fails when the teacher has recorded violation points (TD-009).

All authenticated users can browse `/guru/direktori` and `/guru/[teacherId]`, including photo, employment details, subjects, duties and teaching assignments. ADMIN or GURU with `canManageTeacherProfiles` may edit employment metadata, subjects, schedules and duties. Schedule entries bind teacher, class, subject, weekday and inclusive period range; reversed ranges and overlapping schedules for the same teacher/day are rejected. The system does not model bell times, rooms, class-side conflict detection, substitutions, or live “currently teaching” behavior.

ADMIN maps at most one homeroom teacher to each class at `/wali-kelas/input`; a user can be homeroom of at most one class because both sides are unique. This assignment defines default GURU access for attendance, student profiles, violation points and exports. See [Authorization](../architecture/authentication-authorization.md).

Teacher photos are database bytes and viewable to authenticated users. Teacher details also connect to [Workbook supervision](workbook-supervision.md). Primary files: `app/api/admin/teachers`, `app/api/admin/homerooms`, `app/api/teachers/**`, `lib/server-teacher-profile.ts`, and `lib/teacher-access.ts`.
