import { authOptions } from "@/lib/auth-options";
import { hasPermission } from "@/lib/auth-helpers";
import { formatDateInput, parseDateOnly } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";

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

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/"/g, '""');

  return `"${text}"`;
}

function makeCsvLine(values: unknown[]) {
  // Pakai titik koma agar ramah Excel Indonesia.
  return values.map(escapeCsvValue).join(";");
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  if (!hasPermission(session.user, "attendance.report.export")) {
    return new Response("Forbidden", {
      status: 403,
    });
  }

  const searchParams = request.nextUrl.searchParams;

  const today = formatDateInput();

  const startDate = searchParams.get("startDate") || today;
  const endDate = searchParams.get("endDate") || today;
  const schoolClassId = searchParams.get("schoolClassId") || "";
  const sortBy = searchParams.get("sortBy") || "total_absent";

  const startDateValue = parseDateOnly(startDate);
  const endDateValue = parseDateOnly(endDate);

  const attendanceStatuses = await prisma.attendanceStatus.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      sortOrder: "asc",
    },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: {
      attendanceSession: {
        attendanceDate: {
          gte: startDateValue,
          lte: endDateValue,
        },
        ...(schoolClassId
          ? {
              schoolClassId,
            }
          : {}),
      },
    },
    include: {
      student: true,
      status: true,
      attendanceSession: {
        include: {
          schoolClass: {
            include: {
              academicYear: true,
            },
          },
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

  const header = [
    "Peringkat",
    "Nama Siswa",
    "NIS",
    "NISN",
    "Kelas",
    "Sakit",
    "Izin",
    "Alfa",
    "Terlambat",
    "Dispensasi",
    "Total Tidak Hadir",
    "Total Khusus",
    "Periode Awal",
    "Periode Akhir",
  ];

  const rows = rankingRows.map((row, index) => [
    index + 1,
    row.studentName,
    row.nis ?? "",
    row.nisn ?? "",
    Array.from(row.classNames).join(", "),
    row.counts["S"] ?? 0,
    row.counts["I"] ?? 0,
    row.counts["A"] ?? 0,
    row.counts["T"] ?? 0,
    row.counts["D"] ?? 0,
    row.totalTidakHadir,
    row.totalKhusus,
    startDate,
    endDate,
  ]);

  const csvContent = [
    "sep=;",
    makeCsvLine(header),
    ...rows.map(makeCsvLine),
  ].join("\n");

  const fileName = `ranking-absensi-${startDate}-sd-${endDate}.csv`;

  return new Response(`\uFEFF${csvContent}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}