import { prisma } from "@/lib/prisma";

export default async function DbTestPage() {
  const [
    settings,
    users,
    roles,
    permissions,
    attendanceStatuses,
    academicYears,
    semesters,
  ] = await Promise.all([
    prisma.appSetting.count(),
    prisma.user.count(),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.attendanceStatus.count(),
    prisma.academicYear.count(),
    prisma.semester.count(),
  ]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Database Test SISMEPDA</h1>

      <div className="mt-6 grid gap-4">
        <div>Settings: {settings}</div>
        <div>Users: {users}</div>
        <div>Roles: {roles}</div>
        <div>Permissions: {permissions}</div>
        <div>Attendance Statuses: {attendanceStatuses}</div>
        <div>Academic Years: {academicYears}</div>
        <div>Semesters: {semesters}</div>
      </div>
    </main>
  );
}