"use server";

import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const createStudentSchema = z.object({
  nis: z.string().trim().min(1, "NIS wajib diisi"),
  nisn: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nama siswa wajib diisi"),
  gender: z.enum(["MALE", "FEMALE"]),
  schoolClassId: z.string().min(1, "Kelas wajib dipilih"),
  startDate: z.string().min(1, "Tanggal mulai wajib diisi"),
});

export async function createStudentAction(formData: FormData) {
  const user = await requirePermission("student.create");

  const parsed = createStudentSchema.safeParse({
    nis: formData.get("nis"),
    nisn: formData.get("nisn"),
    name: formData.get("name"),
    gender: formData.get("gender"),
    schoolClassId: formData.get("schoolClassId"),
    startDate: formData.get("startDate"),
  });

  if (!parsed.success) {
    redirect("/students?error=invalid");
  }

  const { nis, nisn, name, gender, schoolClassId, startDate } = parsed.data;

  const cleanNisn = nisn && nisn.length > 0 ? nisn : null;

  const duplicateStudent = await prisma.student.findFirst({
    where: {
      OR: [
        { nis },
        ...(cleanNisn ? [{ nisn: cleanNisn }] : []),
      ],
    },
  });

  if (duplicateStudent) {
    redirect("/students?error=duplicate");
  }

  const schoolClass = await prisma.schoolClass.findUnique({
    where: {
      id: schoolClassId,
    },
    include: {
      academicYear: true,
    },
  });

  if (!schoolClass) {
    redirect("/students?error=class_not_found");
  }

  await prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        nis,
        nisn: cleanNisn,
        name,
        gender,
        status: "ACTIVE",
      },
    });

    const enrollment = await tx.classEnrollment.create({
      data: {
        studentId: student.id,
        schoolClassId: schoolClass.id,
        academicYearId: schoolClass.academicYearId,
        startDate: new Date(startDate),
        status: "ACTIVE",
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "student.create",
        tableName: "students",
        recordId: student.id,
        newValue: {
          id: student.id,
          nis: student.nis,
          nisn: student.nisn,
          name: student.name,
          gender: student.gender,
          status: student.status,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "class_enrollment.create",
        tableName: "class_enrollments",
        recordId: enrollment.id,
        newValue: {
          id: enrollment.id,
          studentId: student.id,
          studentName: student.name,
          schoolClassId: schoolClass.id,
          schoolClassName: schoolClass.name,
          academicYearId: schoolClass.academicYearId,
          startDate,
          status: enrollment.status,
        },
      },
    });
  });

  revalidatePath("/students");
  revalidatePath("/classes");

  redirect("/students?success=created");
}

const updateStudentSchema = z.object({
  studentId: z.string().min(1),
  nis: z.string().trim().min(1, "NIS wajib diisi"),
  nisn: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nama siswa wajib diisi"),
  gender: z.enum(["MALE", "FEMALE"]),
  status: z.enum([
    "ACTIVE",
    "GRADUATED",
    "TRANSFERRED_OUT",
    "DROPPED_OUT",
    "INACTIVE",
  ]),
});

export async function updateStudentAction(formData: FormData) {
  const user = await requirePermission("student.update");

  const parsed = updateStudentSchema.safeParse({
    studentId: formData.get("studentId"),
    nis: formData.get("nis"),
    nisn: formData.get("nisn"),
    name: formData.get("name"),
    gender: formData.get("gender"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirect("/students?error=invalid");
  }

  const { studentId, nis, nisn, name, gender, status } = parsed.data;
  const cleanNisn = nisn && nisn.length > 0 ? nisn : null;

  const existingStudent = await prisma.student.findUnique({
    where: {
      id: studentId,
    },
  });

  if (!existingStudent) {
    redirect("/students?error=not_found");
  }

  const duplicateStudent = await prisma.student.findFirst({
    where: {
      id: {
        not: studentId,
      },
      OR: [
        {
          nis,
        },
        ...(cleanNisn
          ? [
              {
                nisn: cleanNisn,
              },
            ]
          : []),
      ],
    },
  });

  if (duplicateStudent) {
    redirect(`/students/${studentId}/edit?error=duplicate`);
  }

  await prisma.$transaction(async (tx) => {
    const updatedStudent = await tx.student.update({
      where: {
        id: studentId,
      },
      data: {
        nis,
        nisn: cleanNisn,
        name,
        gender,
        status,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "student.update",
        tableName: "students",
        recordId: studentId,
        oldValue: {
          id: existingStudent.id,
          nis: existingStudent.nis,
          nisn: existingStudent.nisn,
          name: existingStudent.name,
          gender: existingStudent.gender,
          status: existingStudent.status,
        },
        newValue: {
          id: updatedStudent.id,
          nis: updatedStudent.nis,
          nisn: updatedStudent.nisn,
          name: updatedStudent.name,
          gender: updatedStudent.gender,
          status: updatedStudent.status,
        },
      },
    });
  });

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}/edit`);

  redirect(`/students/${studentId}/edit?success=updated`);
}

const deleteStudentPermanentlySchema = z.object({
  studentId: z.string().min(1),
  confirmText: z.string().trim(),
});

export async function deleteStudentPermanentlyAction(formData: FormData) {
  const user = await requirePermission("student.delete");

  const parsed = deleteStudentPermanentlySchema.safeParse({
    studentId: formData.get("studentId"),
    confirmText: formData.get("confirmText"),
  });

  if (!parsed.success) {
    redirect("/students?error=invalid");
  }

  const { studentId, confirmText } = parsed.data;

  if (confirmText !== "HAPUS") {
    redirect(`/students/${studentId}/edit?error=confirm_delete`);
  }

  const student = await prisma.student.findUnique({
    where: {
      id: studentId,
    },
    include: {
      classEnrollments: {
        include: {
          schoolClass: {
            include: {
              academicYear: true,
            },
          },
        },
      },
      attendanceRecords: {
        include: {
          attendanceSession: {
            include: {
              schoolClass: true,
            },
          },
          status: true,
        },
      },
    },
  });

  if (!student) {
    redirect("/students?error=not_found");
  }

  const snapshot = {
    student: {
      id: student.id,
      nis: student.nis,
      nisn: student.nisn,
      name: student.name,
      gender: student.gender,
      status: student.status,
    },
    classEnrollments: student.classEnrollments.map((enrollment) => ({
      id: enrollment.id,
      schoolClassId: enrollment.schoolClassId,
      schoolClassName: enrollment.schoolClass.name,
      academicYearName: enrollment.schoolClass.academicYear.name,
      startDate: enrollment.startDate,
      endDate: enrollment.endDate,
      status: enrollment.status,
    })),
    attendanceRecords: student.attendanceRecords.map((record) => ({
      id: record.id,
      attendanceDate: record.attendanceSession.attendanceDate,
      schoolClassName: record.attendanceSession.schoolClass.name,
      statusCode: record.status.code,
      statusName: record.status.name,
      note: record.note,
    })),
    counts: {
      classEnrollments: student.classEnrollments.length,
      attendanceRecords: student.attendanceRecords.length,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "student.delete_permanent",
        tableName: "students",
        recordId: student.id,
        oldValue: snapshot,
        newValue: null,
      },
    });

    await tx.attendanceRecord.deleteMany({
      where: {
        studentId: student.id,
      },
    });

    await tx.classEnrollment.deleteMany({
      where: {
        studentId: student.id,
      },
    });

    await tx.student.delete({
      where: {
        id: student.id,
      },
    });
  });

  revalidatePath("/students");
  revalidatePath("/classes");
  revalidatePath("/attendance/recap");
  revalidatePath("/attendance/ranking");
  revalidatePath("/dashboard");

  redirect("/students?success=deleted");
}

const endStudentEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  enrollmentId: z.string().min(1),
  endDate: z.string().min(1),
  note: z.string().trim().optional(),
});

export async function endStudentEnrollmentAction(formData: FormData) {
  const user = await requirePermission("student.update");

  const parsed = endStudentEnrollmentSchema.safeParse({
    studentId: formData.get("studentId"),
    enrollmentId: formData.get("enrollmentId"),
    endDate: formData.get("endDate"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    redirect("/students?error=invalid");
  }

  const { studentId, enrollmentId, endDate, note } = parsed.data;

  const endDateValue = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(endDateValue.getTime())) {
    redirect(`/students/${studentId}/edit?error=invalid_end_date`);
  }

  const enrollment = await prisma.classEnrollment.findFirst({
    where: {
      id: enrollmentId,
      studentId,
    },
    include: {
      student: true,
      schoolClass: {
        include: {
          academicYear: true,
        },
      },
    },
  });

  if (!enrollment) {
    redirect(`/students/${studentId}/edit?error=enrollment_not_found`);
  }

  if (enrollment.status !== "ACTIVE") {
    redirect(`/students/${studentId}/edit?error=enrollment_not_active`);
  }

  if (endDateValue < enrollment.startDate) {
    redirect(`/students/${studentId}/edit?error=end_before_start`);
  }

  await prisma.$transaction(async (tx) => {
    const updatedEnrollment = await tx.classEnrollment.update({
      where: {
        id: enrollment.id,
      },
      data: {
        endDate: endDateValue,
        status: "TRANSFERRED_OUT",
        note: note && note.length > 0 ? note : "Siswa dikeluarkan dari kelas",
      },
    });

    const updatedStudent = await tx.student.update({
      where: {
        id: studentId,
      },
      data: {
        status: "TRANSFERRED_OUT",
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "class_enrollment.end",
        tableName: "class_enrollments",
        recordId: enrollment.id,
        oldValue: {
          id: enrollment.id,
          studentId: enrollment.studentId,
          studentName: enrollment.student.name,
          schoolClassId: enrollment.schoolClassId,
          schoolClassName: enrollment.schoolClass.name,
          academicYearName: enrollment.schoolClass.academicYear.name,
          startDate: enrollment.startDate,
          endDate: enrollment.endDate,
          status: enrollment.status,
          note: enrollment.note,
        },
        newValue: {
          id: updatedEnrollment.id,
          studentId: updatedEnrollment.studentId,
          studentName: updatedStudent.name,
          schoolClassId: updatedEnrollment.schoolClassId,
          schoolClassName: enrollment.schoolClass.name,
          academicYearName: enrollment.schoolClass.academicYear.name,
          startDate: updatedEnrollment.startDate,
          endDate: updatedEnrollment.endDate,
          status: updatedEnrollment.status,
          note: updatedEnrollment.note,
          studentStatus: updatedStudent.status,
        },
      },
    });
  });

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}/edit`);
  revalidatePath("/classes");
  revalidatePath("/attendance/input");
  revalidatePath("/dashboard");

  redirect(`/students/${studentId}/edit?success=enrollment_ended`);
}