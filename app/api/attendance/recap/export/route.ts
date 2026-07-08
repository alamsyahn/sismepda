import { authOptions } from "@/lib/auth-options";
import { hasPermission } from "@/lib/auth-helpers";
import { formatDateInput, parseDateOnly } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/"/g, '""');

  return `"${text}"`;
}

function makeCsvLine(values: unknown[]) {
  // Pakai titik koma agar lebih ramah Excel Indonesia.
  return values.map(escapeCsvValue).join(";");
}

function formatDate(date: Date) {
  return date.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
  });
}

function formatDateTime(date: Date | null) {
  if (!date) {
    return "";
  }

  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });
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
  const statusCode = searchParams.get("statusCode") || "";

  const startDateValue = parseDateOnly(startDate);
  const endDateValue = parseDateOnly(endDate);

  const sessions = await prisma.attendanceSession.findMany({
    where: {
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
    include: {
      schoolClass: {
        include: {
          academicYear: true,
        },
      },
      submittedBy: true,
      attendanceRecords: {
        where: statusCode
          ? {
              status: {
                code: statusCode,
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
        attendanceDate: "asc",
      },
      {
        schoolClass: {
          name: "asc",
        },
      },
    ],
  });

  const rows = sessions.flatMap((session) =>
    session.attendanceRecords.map((record) => [
      formatDate(session.attendanceDate),
      session.schoolClass.academicYear.name,
      session.schoolClass.name,
      record.student.nis ?? "",
      record.student.nisn ?? "",
      record.student.name,
      record.status.code,
      record.status.name,
      record.note ?? "",
      session.submittedBy?.name ?? "",
      formatDateTime(session.submittedAt),
      record.updatedBy?.name ?? "",
      formatDateTime(record.updatedAt),
    ])
  );

  const header = [
    "Tanggal",
    "Tahun Pelajaran",
    "Kelas",
    "NIS",
    "NISN",
    "Nama Siswa",
    "Kode Status",
    "Status",
    "Catatan",
    "Diinput Oleh",
    "Waktu Input",
    "Terakhir Diubah Oleh",
    "Waktu Terakhir Diubah",
  ];

  const csvContent = [
    "sep=;",
    makeCsvLine(header),
    ...rows.map(makeCsvLine),
  ].join("\n");

  const fileName = `rekap-absensi-${startDate}-sd-${endDate}.csv`;

  return new Response(`\uFEFF${csvContent}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}