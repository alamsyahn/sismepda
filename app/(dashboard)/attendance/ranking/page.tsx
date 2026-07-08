import { hasPermission, requirePermission } from "@/lib/auth-helpers";
import { formatDateInput, parseDateOnly } from "@/lib/date";
import { prisma } from "@/lib/prisma";

type AttendanceRankingPageProps = {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    schoolClassId?: string;
    sortBy?: string;
  }>;
};

type RankingRow = {
  studentId: string;
  studentName: string;
  nis: string | null;
  nisn: string | null;
  classNames: Set<string>;
  counts: Record<string, number>;
  totalTidakHadir: number;
  totalKhusus: number;
};

const sortOptions = [
  {
    value: "total_absent",
    label: "Total Tidak Hadir",
  },
  {
    value: "A",
    label: "Alfa",
  },
  {
    value: "S",
    label: "Sakit",
  },
  {
    value: "I",
    label: "Izin",
  },
  {
    value: "T",
    label: "Terlambat",
  },
  {
    value: "D",
    label: "Dispensasi",
  },
];

export default async function AttendanceRankingPage({
  searchParams,
}: AttendanceRankingPageProps) {
  const user = await requirePermission("attendance.ranking.view");
  const canExport = hasPermission(user, "attendance.report.export");

  const params = await searchParams;

  const today = formatDateInput();

  const startDate = params.startDate ?? today;
  const endDate = params.endDate ?? today;
  const selectedClassId = params.schoolClassId ?? "";
  const sortBy = params.sortBy ?? "total_absent";

  const exportParams = new URLSearchParams({
    startDate,
    endDate,
    sortBy,
  });

  if (selectedClassId) {
    exportParams.set("schoolClassId", selectedClassId);
  }

  const exportUrl = `/api/attendance/ranking/export?${exportParams.toString()}`;

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

  const records = await prisma.attendanceRecord.findMany({
    where: {
      attendanceSession: {
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
    },
    include: {
      student: true,
      status: true,
      attendanceSession: {
        include: {
          schoolClass: true,
        },
      },
    },
  });

  const rankingMap = new Map<string, RankingRow>();

  for (const record of records) {
    const studentId = record.studentId;

    if (!rankingMap.has(studentId)) {
      const initialCounts: Record<string, number> = {};

      for (const status of attendanceStatuses) {
        initialCounts[status.code] = 0;
      }

      rankingMap.set(studentId, {
        studentId,
        studentName: record.student.name,
        nis: record.student.nis,
        nisn: record.student.nisn,
        classNames: new Set<string>(),
        counts: initialCounts,
        totalTidakHadir: 0,
        totalKhusus: 0,
      });
    }

    const row = rankingMap.get(studentId)!;

    row.classNames.add(record.attendanceSession.schoolClass.name);

    row.counts[record.status.code] = (row.counts[record.status.code] ?? 0) + 1;
  }

  const rankingRows = Array.from(rankingMap.values()).map((row) => {
    const sakit = row.counts["S"] ?? 0;
    const izin = row.counts["I"] ?? 0;
    const alfa = row.counts["A"] ?? 0;
    const terlambat = row.counts["T"] ?? 0;
    const dispensasi = row.counts["D"] ?? 0;

    return {
      ...row,
      totalTidakHadir: sakit + izin + alfa,
      totalKhusus: sakit + izin + alfa + terlambat + dispensasi,
    };
  });

  rankingRows.sort((a, b) => {
    const getScore = (row: RankingRow) => {
      if (sortBy === "total_absent") {
        return row.totalTidakHadir;
      }

      return row.counts[sortBy] ?? 0;
    };

    const scoreA = getScore(a);
    const scoreB = getScore(b);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    if ((b.counts["A"] ?? 0) !== (a.counts["A"] ?? 0)) {
      return (b.counts["A"] ?? 0) - (a.counts["A"] ?? 0);
    }

    return a.studentName.localeCompare(b.studentName);
  });

  const totalSakit = rankingRows.reduce(
    (sum, row) => sum + (row.counts["S"] ?? 0),
    0
  );
  const totalIzin = rankingRows.reduce(
    (sum, row) => sum + (row.counts["I"] ?? 0),
    0
  );
  const totalAlfa = rankingRows.reduce(
    (sum, row) => sum + (row.counts["A"] ?? 0),
    0
  );
  const totalTerlambat = rankingRows.reduce(
    (sum, row) => sum + (row.counts["T"] ?? 0),
    0
  );
  const totalDispensasi = rankingRows.reduce(
    (sum, row) => sum + (row.counts["D"] ?? 0),
    0
  );

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Ranking Absensi
          </h1>
          <p className="mt-2 text-slate-600">
            Ranking siswa berdasarkan jumlah ketidakhadiran, alfa, sakit, izin,
            terlambat, dan dispensasi.
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
        <h2 className="font-semibold text-slate-900">Filter Ranking</h2>

        <form
          method="GET"
          action="/attendance/ranking"
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
              htmlFor="sortBy"
              className="text-sm font-medium text-slate-700"
            >
              Urutkan Berdasarkan
            </label>
            <select
              id="sortBy"
              name="sortBy"
              defaultValue={sortBy}
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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

      <div className="mt-6 grid gap-4 md:grid-cols-5">
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm text-slate-500">Sakit</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {totalSakit}
          </p>
          <p className="mt-1 text-xs text-slate-500">S</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm text-slate-500">Izin</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {totalIzin}
          </p>
          <p className="mt-1 text-xs text-slate-500">I</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm text-slate-500">Alfa</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {totalAlfa}
          </p>
          <p className="mt-1 text-xs text-slate-500">A</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm text-slate-500">Terlambat</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {totalTerlambat}
          </p>
          <p className="mt-1 text-xs text-slate-500">T</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm text-slate-500">Dispensasi</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {totalDispensasi}
          </p>
          <p className="mt-1 text-xs text-slate-500">D</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Tabel Ranking</h2>
          <p className="mt-1 text-sm text-slate-500">
            Periode {startDate} sampai {endDate} · Total siswa dengan data
            absensi: {rankingRows.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Total tidak hadir dihitung dari Sakit + Izin + Alfa. Terlambat dan
            dispensasi ditampilkan terpisah.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">Peringkat</th>
                <th className="px-6 py-3 font-medium">Nama Siswa</th>
                <th className="px-6 py-3 font-medium">NIS</th>
                <th className="px-6 py-3 font-medium">Kelas</th>
                <th className="px-6 py-3 font-medium">S</th>
                <th className="px-6 py-3 font-medium">I</th>
                <th className="px-6 py-3 font-medium">A</th>
                <th className="px-6 py-3 font-medium">T</th>
                <th className="px-6 py-3 font-medium">D</th>
                <th className="px-6 py-3 font-medium">Total Tidak Hadir</th>
                <th className="px-6 py-3 font-medium">Total Khusus</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {rankingRows.map((row, index) => (
                <tr key={row.studentId}>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {index + 1}
                  </td>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {row.studentName}
                  </td>
                  <td className="px-6 py-3">{row.nis ?? "-"}</td>
                  <td className="px-6 py-3">
                    {Array.from(row.classNames).join(", ") || "-"}
                  </td>
                  <td className="px-6 py-3">{row.counts["S"] ?? 0}</td>
                  <td className="px-6 py-3">{row.counts["I"] ?? 0}</td>
                  <td className="px-6 py-3">{row.counts["A"] ?? 0}</td>
                  <td className="px-6 py-3">{row.counts["T"] ?? 0}</td>
                  <td className="px-6 py-3">{row.counts["D"] ?? 0}</td>
                  <td className="px-6 py-3 font-semibold text-slate-900">
                    {row.totalTidakHadir}
                  </td>
                  <td className="px-6 py-3">{row.totalKhusus}</td>
                </tr>
              ))}

              {rankingRows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada data absensi sesuai filter.
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