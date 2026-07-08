import { hasPermission, requirePermission } from "@/lib/auth-helpers";
import { formatDateInput, parseDateOnly } from "@/lib/date";
import { prisma } from "@/lib/prisma";

type DashboardPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

type PieChartItem = {
  label: string;
  value: number;
  color: string;
};

type SummaryPieChartProps = {
  title: string;
  description: string;
  centerValue: number;
  centerLabel: string;
  items: PieChartItem[];
};

function SummaryPieChart({
  title,
  description,
  centerValue,
  centerLabel,
  items,
}: SummaryPieChartProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  let currentPercentage = 0;

  const pieSegments = items
    .filter((item) => item.value > 0)
    .map((item) => {
      const start = currentPercentage;
      const size = total > 0 ? (item.value / total) * 100 : 0;
      currentPercentage += size;

      return `${item.color} ${start}% ${currentPercentage}%`;
    })
    .join(", ");

  const pieBackground =
    total > 0 ? `conic-gradient(${pieSegments})` : "#e2e8f0";

  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
        <div
          className="relative h-44 w-44 shrink-0 rounded-full"
          style={{ background: pieBackground }}
        >
          <div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white shadow-inner">
            <p className="text-3xl font-bold text-slate-900">{centerValue}</p>
            <p className="text-xs text-slate-500">{centerLabel}</p>
          </div>
        </div>

        <div className="w-full space-y-3">
          {items.map((item) => {
            const percentage =
              total > 0 ? Math.round((item.value / total) * 100) : 0;

            return (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />

                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.label}
                    </p>
                    <p className="text-xs text-slate-500">{percentage}%</p>
                  </div>
                </div>

                <p className="text-xl font-bold text-slate-900">{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const user = await requirePermission("attendance.view.today");
  const params = await searchParams;

  const selectedDate = params.date ?? formatDateInput();
  const selectedDateValue = parseDateOnly(selectedDate);

  const canInputAttendance = hasPermission(user, "attendance.input.today");

  const [
    activeAcademicYear,
    activeSemester,
    activeClasses,
    attendanceStatuses,
  ] = await Promise.all([
    prisma.academicYear.findFirst({
      where: {
        isActive: true,
      },
      orderBy: {
        startDate: "desc",
      },
    }),

    prisma.semester.findFirst({
      where: {
        isActive: true,
      },
      include: {
        academicYear: true,
      },
      orderBy: {
        startDate: "desc",
      },
    }),

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

  const activeClassIds = activeClasses.map((schoolClass) => schoolClass.id);

  const attendanceSessions =
    activeClassIds.length > 0
      ? await prisma.attendanceSession.findMany({
          where: {
            attendanceDate: selectedDateValue,
            schoolClassId: {
              in: activeClassIds,
            },
          },
          include: {
            schoolClass: true,
            submittedBy: true,
            attendanceRecords: {
              include: {
                student: true,
                status: true,
              },
              orderBy: {
                student: {
                  name: "asc",
                },
              },
            },
          },
          orderBy: {
            schoolClass: {
              name: "asc",
            },
          },
        })
      : [];

  const submittedClassIds = new Set(
    attendanceSessions.map((session) => session.schoolClassId),
  );

  const submittedClasses = activeClasses.filter((schoolClass) =>
    submittedClassIds.has(schoolClass.id),
  );

  const unsubmittedClasses = activeClasses.filter(
    (schoolClass) => !submittedClassIds.has(schoolClass.id),
  );

  const statusCountMap = new Map<string, number>();

  for (const status of attendanceStatuses) {
    statusCountMap.set(status.code, 0);
  }

  const specialAttendanceRecords = [];

  for (const session of attendanceSessions) {
    for (const record of session.attendanceRecords) {
      statusCountMap.set(
        record.status.code,
        (statusCountMap.get(record.status.code) ?? 0) + 1,
      );

      if (record.status.code !== "H") {
        specialAttendanceRecords.push({
          id: record.id,
          studentName: record.student.name,
          nis: record.student.nis,
          className: session.schoolClass.name,
          statusCode: record.status.code,
          statusName: record.status.name,
          note: record.note,
        });
      }
    }
  }

  const nonPresentStatuses = attendanceStatuses.filter(
    (status) => status.code !== "H",
  );

  const classRecapChartItems = [
    {
      label: "Sudah Rekap",
      value: submittedClasses.length,
      color: "#16a34a",
    },
    {
      label: "Belum Rekap",
      value: unsubmittedClasses.length,
      color: "#dc2626",
    },
  ];

  const attendanceStatusColors = [
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#0ea5e9",
    "#64748b",
    "#14b8a6",
  ];

  const nonPresentChartItems = nonPresentStatuses.map((status, index) => ({
    label: `${status.name} (${status.code})`,
    value: statusCountMap.get(status.code) ?? 0,
    color: attendanceStatusColors[index % attendanceStatusColors.length],
  }));

  const totalNonPresentStudents = nonPresentChartItems.reduce(
    (sum, item) => sum + item.value,
    0,
  );

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Dashboard Absensi
          </h1>

          <p className="mt-2 text-slate-600">
            Ringkasan rekap absensi harian SISMEPDA.
          </p>

          <p className="mt-1 text-sm text-slate-500">
            Tahun Pelajaran: {activeAcademicYear?.name ?? "-"} · Semester:{" "}
            {activeSemester?.name ?? "-"}
          </p>
        </div>

        <form method="GET" action="/dashboard" className="flex gap-2">
          <input
            type="date"
            name="date"
            defaultValue={selectedDate}
            className="rounded-md border px-3 py-2 text-sm"
          />

          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Tampilkan
          </button>
        </form>
      </div>

      {/* <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-white p-6 shadow">
          <p className="text-sm text-slate-500">Total Kelas Aktif</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {activeClasses.length}
          </p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          <p className="text-sm text-slate-500">Kelas Sudah Rekap</p>
          <p className="mt-2 text-3xl font-bold text-green-700">
            {submittedClasses.length}
          </p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          <p className="text-sm text-slate-500">Kelas Belum Rekap</p>
          <p className="mt-2 text-3xl font-bold text-red-700">
            {unsubmittedClasses.length}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-5">
        {nonPresentStatuses.map((status) => (
          <div key={status.id} className="rounded-xl bg-white p-5 shadow">
            <p className="text-sm text-slate-500">{status.name}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {statusCountMap.get(status.code) ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-500">{status.code}</p>
          </div>
        ))}
      </div> */}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SummaryPieChart
          title="Rekap Kelas Hari Ini"
          description={`Tanggal ${selectedDate}`}
          centerValue={activeClasses.length}
          centerLabel="total kelas"
          items={classRecapChartItems}
        />

        <SummaryPieChart
          title="Status Ketidakhadiran"
          description="Sakit, izin, alfa, terlambat, dispensasi, dan status selain hadir."
          centerValue={totalNonPresentStudents}
          centerLabel="total siswa"
          items={nonPresentChartItems}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-white shadow">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold text-slate-900">Kelas Belum Rekap</h2>
            <p className="mt-1 text-sm text-slate-500">
              Tanggal {selectedDate}
            </p>
          </div>

          <div className="divide-y">
            {unsubmittedClasses.map((schoolClass) => (
              <div
                key={schoolClass.id}
                className="flex items-center justify-between gap-4 px-6 py-4"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {schoolClass.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {schoolClass.academicYear.name}
                  </p>
                </div>

                {canInputAttendance && (
                  <a
                    href={`/attendance/input?schoolClassId=${schoolClass.id}&attendanceDate=${selectedDate}`}
                    className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Input
                  </a>
                )}
              </div>
            ))}

            {unsubmittedClasses.length === 0 && (
              <div className="px-6 py-8 text-center text-slate-500">
                Semua kelas sudah melakukan rekap.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white shadow">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold text-slate-900">
              Siswa Tidak Hadir / Terlambat / Dispensasi
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Tanggal {selectedDate}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-6 py-3 font-medium">Nama</th>
                  <th className="px-6 py-3 font-medium">Kelas</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Catatan</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {specialAttendanceRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="px-6 py-3">
                      <p className="font-medium text-slate-900">
                        {record.studentName}
                      </p>
                      <p className="text-xs text-slate-500">
                        NIS: {record.nis ?? "-"}
                      </p>
                    </td>
                    <td className="px-6 py-3">{record.className}</td>
                    <td className="px-6 py-3">
                      {record.statusCode} - {record.statusName}
                    </td>
                    <td className="px-6 py-3">{record.note ?? "-"}</td>
                  </tr>
                ))}

                {specialAttendanceRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-8 text-center text-slate-500"
                    >
                      Belum ada siswa dengan status selain Hadir.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Kelas Sudah Rekap</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">Kelas</th>
                <th className="px-6 py-3 font-medium">Diinput Oleh</th>
                <th className="px-6 py-3 font-medium">Waktu Input</th>
                <th className="px-6 py-3 font-medium">Jumlah Record</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {attendanceSessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {session.schoolClass.name}
                  </td>
                  <td className="px-6 py-3">
                    {session.submittedBy?.name ?? "-"}
                  </td>
                  <td className="px-6 py-3">
                    {session.submittedAt
                      ? session.submittedAt.toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                        })
                      : "-"}
                  </td>
                  <td className="px-6 py-3">
                    {session.attendanceRecords.length}
                  </td>
                </tr>
              ))}

              {attendanceSessions.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada kelas yang melakukan rekap pada tanggal ini.
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
