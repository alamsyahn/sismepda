"use server";

import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

type RawCsvRow = Record<string, string | undefined>;

type NormalizedStudentRow = {
  rowNumber: number;
  nis: string;
  nisn: string | null;
  name: string;
  gender: "MALE" | "FEMALE";
  className: string;
  startDate: string;
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function getValue(row: RawCsvRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeGender(value: string) {
  const normalized = value.trim().toLowerCase();

  if (["l", "lk", "laki-laki", "laki laki", "male", "m"].includes(normalized)) {
    return "MALE";
  }

  if (["p", "pr", "perempuan", "female", "f"].includes(normalized)) {
    return "FEMALE";
  }

  return "";
}

function detectDelimiter(content: string) {
  const firstLine =
    content
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? "";

  const semicolonCount = firstLine.split(";").length;
  const commaCount = firstLine.split(",").length;

  return semicolonCount >= commaCount ? ";" : ",";
}

function parseDateString(value: string) {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return trimmed;
}

const normalizedRowSchema = z.object({
  rowNumber: z.number(),
  nis: z.string().trim().min(1),
  nisn: z.string().nullable(),
  name: z.string().trim().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  className: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
});

async function createFailedImportLog(input: {
  userId: string;
  fileName: string;
  totalRows: number;
  failedRows: number;
  note: string;
}) {
  return prisma.importLog.create({
    data: {
      fileName: input.fileName,
      importType: "students_csv",
      totalRows: input.totalRows,
      successRows: 0,
      failedRows: input.failedRows,
      note: input.note,
      createdById: input.userId,
    },
  });
}

export async function importStudentsCsvAction(formData: FormData) {
  const user = await requirePermission("student.import");

  const file = formData.get("csvFile");

  const skipExisting = formData.get("skipExisting") === "yes";

  if (!(file instanceof File)) {
    redirect("/students/import?error=no_file");
  }

  const fileName = file.name;
  const content = await file.text();

  if (content.trim().length === 0) {
    const log = await createFailedImportLog({
      userId: user.id,
      fileName,
      totalRows: 0,
      failedRows: 0,
      note: "File CSV kosong.",
    });

    redirect(`/students/import?error=empty&logId=${log.id}`);
  }

  let rawRows: RawCsvRow[] = [];

  try {
    rawRows = parse(content, {
      bom: true,
      columns: (headers: string[]) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      delimiter: detectDelimiter(content),
    }) as RawCsvRow[];
  } catch (error) {
    const log = await createFailedImportLog({
      userId: user.id,
      fileName,
      totalRows: 0,
      failedRows: 0,
      note: `Gagal membaca CSV. Pastikan file memiliki header yang benar.\n\n${String(
        error
      )}`,
    });

    redirect(`/students/import?error=parse&logId=${log.id}`);
  }

  const activeAcademicYear = await prisma.academicYear.findFirst({
    where: {
      isActive: true,
    },
    orderBy: {
      startDate: "desc",
    },
  });

  if (!activeAcademicYear) {
    const log = await createFailedImportLog({
      userId: user.id,
      fileName,
      totalRows: rawRows.length,
      failedRows: rawRows.length,
      note: "Tidak ada tahun pelajaran aktif.",
    });

    redirect(`/students/import?error=no_active_year&logId=${log.id}`);
  }

  const activeClasses = await prisma.schoolClass.findMany({
    where: {
      academicYearId: activeAcademicYear.id,
    },
  });

  const classMap = new Map(
    activeClasses.map((schoolClass) => [
      schoolClass.name.trim().toLowerCase(),
      schoolClass,
    ])
  );

  const errors: string[] = [];
  const normalizedRows: NormalizedStudentRow[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;

    const nis = getValue(row, ["nis"]);
    const nisnRaw = getValue(row, ["nisn"]);
    const name = getValue(row, ["name", "nama", "nama_siswa"]);
    const genderRaw = getValue(row, ["gender", "jk", "jenis_kelamin"]);
    const className = getValue(row, ["class_name", "kelas", "nama_kelas"]);
    const startDateRaw =
      getValue(row, ["start_date", "tanggal_mulai", "mulai"]) ||
      activeAcademicYear.startDate.toISOString().slice(0, 10);

    const gender = normalizeGender(genderRaw);
    const startDate = parseDateString(startDateRaw);

    const parsed = normalizedRowSchema.safeParse({
      rowNumber,
      nis,
      nisn: nisnRaw.length > 0 ? nisnRaw : null,
      name,
      gender,
      className,
      startDate: startDate ?? "",
    });

    if (!parsed.success) {
      errors.push(
        `Baris ${rowNumber}: data tidak valid. Pastikan NIS, nama, gender, kelas, dan start_date benar.`
      );
      return;
    }

    if (!classMap.has(className.trim().toLowerCase())) {
      errors.push(
        `Baris ${rowNumber}: kelas "${className}" tidak ditemukan pada tahun pelajaran aktif.`
      );
      return;
    }

    normalizedRows.push(parsed.data);
  });

  const nisSet = new Set<string>();
  const nisnSet = new Set<string>();

  for (const row of normalizedRows) {
    if (nisSet.has(row.nis)) {
      errors.push(`Baris ${row.rowNumber}: NIS "${row.nis}" dobel di file CSV.`);
    }

    nisSet.add(row.nis);

    if (row.nisn) {
      if (nisnSet.has(row.nisn)) {
        errors.push(
          `Baris ${row.rowNumber}: NISN "${row.nisn}" dobel di file CSV.`
        );
      }

      nisnSet.add(row.nisn);
    }
  }

  const nises = normalizedRows.map((row) => row.nis);
  const nisns = normalizedRows
    .map((row) => row.nisn)
    .filter((value): value is string => Boolean(value));

  const existingStudents = await prisma.student.findMany({
    where: {
      OR: [
        {
          nis: {
            in: nises,
          },
        },
        ...(nisns.length > 0
          ? [
              {
                nisn: {
                  in: nisns,
                },
              },
            ]
          : []),
      ],
    },
    include: {
      classEnrollments: {
        where: {
          academicYearId: activeAcademicYear.id,
          status: "ACTIVE",
        },
      },
    },
  });

  const existingByNis = new Map(
    existingStudents
      .filter((student) => student.nis)
      .map((student) => [student.nis!, student])
  );

  const existingByNisn = new Map(
    existingStudents
      .filter((student) => student.nisn)
      .map((student) => [student.nisn!, student])
  );

  const rowsToImport: NormalizedStudentRow[] = [];
  const skippedRows: string[] = [];

  for (const row of normalizedRows) {
    const schoolClass = classMap.get(row.className.trim().toLowerCase())!;
    const existingByCurrentNis = existingByNis.get(row.nis);
    const existingByCurrentNisn = row.nisn ? existingByNisn.get(row.nisn) : null;

    const existingStudent = existingByCurrentNis ?? existingByCurrentNisn ?? null;

    if (skipExisting && existingStudent) {
      skippedRows.push(
        `Baris ${row.rowNumber}: dilewati karena siswa sudah ada. NIS: ${row.nis}, NISN: ${row.nisn ?? "-"}, Nama CSV: ${row.name}.`
      );
      continue;
    }

    if (row.nisn) {
      if (
        existingByCurrentNisn &&
        existingByCurrentNis &&
        existingByCurrentNisn.id !== existingByCurrentNis.id
      ) {
        errors.push(
          `Baris ${row.rowNumber}: NIS dan NISN mengarah ke dua siswa berbeda.`
        );
      }

      if (existingByCurrentNisn && !existingByCurrentNis) {
        errors.push(
          `Baris ${row.rowNumber}: NISN "${row.nisn}" sudah digunakan oleh siswa lain.`
        );
      }
    }

    if (existingByCurrentNis) {
      const activeEnrollment = existingByCurrentNis.classEnrollments[0];

      if (
        activeEnrollment &&
        activeEnrollment.schoolClassId !== schoolClass.id
      ) {
        errors.push(
          `Baris ${row.rowNumber}: siswa dengan NIS "${row.nis}" sudah aktif di kelas lain. Pindah kelas harus dilakukan lewat fitur mutasi/enrollment, bukan import.`
        );
      }
    }

    rowsToImport.push(row);
  }

  if (errors.length > 0) {
    const note = [
      "Import dibatalkan karena ada data yang tidak valid.",
      "",
      ...errors.slice(0, 50),
      errors.length > 50 ? `...dan ${errors.length - 50} error lainnya.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const log = await createFailedImportLog({
      userId: user.id,
      fileName,
      totalRows: rawRows.length,
      failedRows: errors.length,
      note,
    });

    redirect(`/students/import?error=validation&logId=${log.id}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    let createdStudents = 0;
    let updatedStudents = 0;
    let createdEnrollments = 0;

    for (const row of rowsToImport) {
      const schoolClass = classMap.get(row.className.trim().toLowerCase())!;

      const existingStudent = await tx.student.findUnique({
        where: {
          nis: row.nis,
        },
      });

      const student = await tx.student.upsert({
        where: {
          nis: row.nis,
        },
        update: {
          nisn: row.nisn,
          name: row.name,
          gender: row.gender,
          status: "ACTIVE",
        },
        create: {
          nis: row.nis,
          nisn: row.nisn,
          name: row.name,
          gender: row.gender,
          status: "ACTIVE",
        },
      });

      if (existingStudent) {
        updatedStudents++;
      } else {
        createdStudents++;
      }

      const existingEnrollment = await tx.classEnrollment.findFirst({
        where: {
          studentId: student.id,
          academicYearId: activeAcademicYear.id,
          schoolClassId: schoolClass.id,
        },
      });

      if (!existingEnrollment) {
        await tx.classEnrollment.create({
          data: {
            studentId: student.id,
            academicYearId: activeAcademicYear.id,
            schoolClassId: schoolClass.id,
            startDate: new Date(`${row.startDate}T00:00:00.000Z`),
            status: "ACTIVE",
          },
        });

        createdEnrollments++;
      }
    }

    const importLog = await tx.importLog.create({
      data: {
        fileName,
        importType: "students_csv",
        totalRows: normalizedRows.length,
        successRows: rowsToImport.length,
        failedRows: 0,
        note: [
          `Import berhasil.`,
          `Siswa baru: ${createdStudents}.`,
          `Siswa diperbarui: ${updatedStudents}.`,
          `Enrollment baru: ${createdEnrollments}.`,
          `Baris dilewati karena sudah ada: ${skippedRows.length}.`,
          "",
          ...skippedRows.slice(0, 50),
          skippedRows.length > 50
            ? `...dan ${skippedRows.length - 50} baris skip lainnya.`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        createdById: user.id,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "student.import_csv",
        tableName: "students",
        recordId: importLog.id,
        newValue: {
          fileName,
          totalRows: normalizedRows.length,
          importedRows: rowsToImport.length,
          skippedRows: skippedRows.length,
          createdStudents,
          updatedStudents,
          createdEnrollments,
          skipExisting,
        },
      },
    });

    return importLog;
  });

  revalidatePath("/students");
  revalidatePath("/classes");
  revalidatePath("/students/import");

  redirect(`/students/import?success=imported&logId=${result.id}`);
}