import { hasPermission, requirePermission } from "@/lib/auth-helpers";
import { formatDateInput, parseDateOnly } from "@/lib/date";
import { prisma } from "@/lib/prisma";

type AttendanceRecapPageProps = {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    schoolClassId?: string;
    statusCode?: string;
  }>;
};

function formatDateDisplay(date: Date) {
  return date.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default async function AttendanceRecapPage({
  searchParams,
}: AttendanceRecapPageProps) {
  const user = await requirePermission("attendance.report.view");
  const canExport = hasPermission(user, "attendance.report.export");

  const params = await searchParams;

  const today = formatDateInput();

  const startDate = params.startDate ?? today;
  const endDate = params.endDate ?? today;
  const selectedClassId = params.schoolClassId ?? "";
  const selectedStatusCode = params.statusCode ?? "";

  const exportParams = new URLSearchParams({
    startDate,
    endDate,
  });

  if (selectedClassId) {
    exportParams.set("schoolClassId", selectedClassId);
  }

  if (selectedStatusCode) {
    exportParams.set("statusCode", selectedStatusCode);
  }

  const exportUrl = `/api/attendance/recap/export?${exportParams.toString()}`;

  const startDateValue = parseDateOnly(startDate);
  const endDateValue = parseDateOnly(endDate);

  const [classes, attendanceStatuses] = await Promise.all([
    prisma.schoolClass.findMany({
      where: {
        academicYear: {
          isActive: true,
        },
      },
      include: {
        academicYear: true,
      },
      orderBy: [
        {
          gradeLevel: "asc",
        },
        {
          name: "asc",
        },
      ],
    }),

    prisma.attendanceStatus.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
    }),
  ]);

  const sessions = await prisma.attendanceSession.findMany({
    where: {
      attendanceDate: {
        gte: startDateValue,
        lte: endDateValue,
      },
      ...(selectedClassId
        ? {
            schoolClassId: selectedClassId,
          }
        : {}),
    },
    include: {
      schoolClass: {
        include: {
          academicYear: true,
        },
      },
      submittedBy: true,
      attendanceRecords: {
        where: selectedStatusCode
          ? {
              status: {
                code: selectedStatusCode,
              },
            }
          : undefined,
        include: {
          student: true,
          status: true,
          createdBy: true,
          updatedBy: true,
        },
        orderBy: {
          student: {
            name: "asc",
          },
        },
      },
    },
    orderBy: [
      {
        attendanceDate: "desc",
      },
      {
        schoolClass: {
          name: "asc",
        },
      },
    ],
  });

  const records = sessions.flatMap((session) =>
    session.attendanceRecords.map((record) => ({
      id: record.id,
      attendanceDate: session.attendanceDate,
      className: session.schoolClass.name,
      academicYearName: session.schoolClass.academicYear.name,
      studentName: record.student.name,
      nis: record.student.nis,
      nisn: record.student.nisn,
      statusCode: record.status.code,
      statusName: record.status.name,
      note: record.note,
      submittedByName: session.submittedBy?.name,
      submittedAt: session.submittedAt,
      updatedByName: record.updatedBy?.name,
      updatedAt: record.updatedAt,
    }))
  );

  const statusCountMap = new Map<string, number>();

  for (const status of attendanceStatuses) {
    statusCountMap.set(status.code, 0);
  }

  for (const record of records) {
    statusCountMap.set(
      record.statusCode,
      (statusCountMap.get(record.statusCode) ?? 0) + 1
    );
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Rekap Absensi</h1>
          <p className="mt-2 text-slate-600">
            Rekap sederhana berdasarkan tanggal, kelas, dan status kehadiran.
          </p>
        </div>

        {canExport && (
          <a
            href={exportUrl}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Export CSV
          </a>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">Filter Rekap</h2>

        <form
          method="GET"
          action="/attendance/recap"
          className="mt-4 grid gap-4 md:grid-cols-5"
        >
          <div>
            <label
              htmlFor="startDate"
              className="text-sm font-medium text-slate-700"
            >
              Tanggal Awal
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={startDate}
              className="mt-1 w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label
              htmlFor="endDate"
              className="text-sm font-medium text-slate-700"
            >
              Tanggal Akhir
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={endDate}
              className="mt-1 w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label
              htmlFor="schoolClassId"
              className="text-sm font-medium text-slate-700"
            >
              Kelas
            </label>
            <select
              id="schoolClassId"
              name="schoolClassId"
              defaultValue={selectedClassId}
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              <option value="">Semua kelas</option>
              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name} - {schoolClass.academicYear.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="statusCode"
              className="text-sm font-medium text-slate-700"
            >
              Status
            </label>
            <select
              id="statusCode"
              name="statusCode"
              defaultValue={selectedStatusCode}
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              <option value="">Semua status</option>
              {attendanceStatuses.map((status) => (
                <option key={status.id} value={status.code}>
                  {status.code} - {status.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
            >
              Tampilkan
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-6">
        {attendanceStatuses.map((status) => (
          <div key={status.id} className="rounded-xl bg-white p-5 shadow">
            <p className="text-sm text-slate-500">{status.name}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {statusCountMap.get(status.code) ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-500">{status.code}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Detail Rekap</h2>
          <p className="mt-1 text-sm text-slate-500">
            Periode {startDate} sampai {endDate} · Total record:{" "}
            {records.length}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">Tanggal</th>
                <th className="px-6 py-3 font-medium">Kelas</th>
                <th className="px-6 py-3 font-medium">Nama Siswa</th>
                <th className="px-6 py-3 font-medium">NIS</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Catatan</th>
                <th className="px-6 py-3 font-medium">Diinput Oleh</th>
                <th className="px-6 py-3 font-medium">Terakhir Diubah</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="px-6 py-3">
                    {formatDateDisplay(record.attendanceDate)}
                  </td>
                  <td className="px-6 py-3">{record.className}</td>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {record.studentName}
                  </td>
                  <td className="px-6 py-3">{record.nis ?? "-"}</td>
                  <td className="px-6 py-3">
                    {record.statusCode} - {record.statusName}
                  </td>
                  <td className="px-6 py-3">{record.note ?? "-"}</td>
                  <td className="px-6 py-3">
                    {record.submittedByName ?? "-"}
                  </td>
                  <td className="px-6 py-3">
                    <p>{record.updatedByName ?? "-"}</p>
                    <p className="text-xs text-slate-500">
                      {record.updatedAt.toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </p>
                  </td>
                </tr>
              ))}

              {records.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Tidak ada data absensi sesuai filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}