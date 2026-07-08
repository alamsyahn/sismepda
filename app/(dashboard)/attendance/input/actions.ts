"use server";

import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const saveAttendanceSchema = z.object({
  schoolClassId: z.string().min(1),
  attendanceDate: z.string().min(1),
});

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function saveAttendanceAction(formData: FormData) {
  const user = await requirePermission("attendance.input.today");

  const parsed = saveAttendanceSchema.safeParse({
    schoolClassId: formData.get("schoolClassId"),
    attendanceDate: formData.get("attendanceDate"),
  });

  if (!parsed.success) {
    redirect("/attendance/input?error=invalid");
  }

  const { schoolClassId, attendanceDate } = parsed.data;
  const attendanceDateValue = parseDateOnly(attendanceDate);

  const studentIds = formData.getAll("studentId").map(String);

  if (studentIds.length === 0) {
    redirect("/attendance/input?error=no_students");
  }

  const schoolClass = await prisma.schoolClass.findUnique({
    where: {
      id: schoolClassId,
    },
  });

  if (!schoolClass) {
    redirect("/attendance/input?error=class_not_found");
  }

  const activeEnrollments = await prisma.classEnrollment.findMany({
    where: {
      schoolClassId,
      startDate: {
        lte: attendanceDateValue,
      },
      OR: [
        {
          endDate: null,
        },
        {
          endDate: {
            gte: attendanceDateValue,
          },
        },
      ],
      status: "ACTIVE",
    },
    select: {
      studentId: true,
    },
  });

  const activeStudentIds = new Set(
    activeEnrollments.map((enrollment) => enrollment.studentId)
  );

  const validStudentIds = studentIds.filter((studentId) =>
    activeStudentIds.has(studentId)
  );

  if (validStudentIds.length === 0) {
    redirect(
      `/attendance/input?schoolClassId=${schoolClassId}&attendanceDate=${attendanceDate}&error=no_active_students`
    );
  }

  const statuses = await prisma.attendanceStatus.findMany({
    where: {
      isActive: true,
    },
  });

  const statusMap = new Map(statuses.map((status) => [status.code, status]));

  await prisma.$transaction(async (tx) => {
    const session = await tx.attendanceSession.upsert({
      where: {
        schoolClassId_attendanceDate: {
          schoolClassId,
          attendanceDate: attendanceDateValue,
        },
      },
      update: {
        status: "SUBMITTED",
        submittedById: user.id,
        submittedAt: new Date(),
      },
      create: {
        schoolClassId,
        attendanceDate: attendanceDateValue,
        status: "SUBMITTED",
        submittedById: user.id,
        submittedAt: new Date(),
      },
    });

    for (const studentId of validStudentIds) {
      const statusCode = String(formData.get(`status-${studentId}`) ?? "H");
      const note = String(formData.get(`note-${studentId}`) ?? "").trim();

      const status = statusMap.get(statusCode);

      if (!status) {
        throw new Error(`Status absensi tidak valid: ${statusCode}`);
      }

      await tx.attendanceRecord.upsert({
        where: {
          attendanceSessionId_studentId: {
            attendanceSessionId: session.id,
            studentId,
          },
        },
        update: {
          statusId: status.id,
          note: note.length > 0 ? note : null,
          updatedById: user.id,
        },
        create: {
          attendanceSessionId: session.id,
          studentId,
          statusId: status.id,
          note: note.length > 0 ? note : null,
          createdById: user.id,
          updatedById: user.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "attendance.input",
        tableName: "attendance_sessions",
        recordId: session.id,
        newValue: {
          schoolClassId,
          attendanceDate,
          totalStudents: validStudentIds.length,
        },
      },
    });
  });

  revalidatePath("/attendance/input");
  revalidatePath("/dashboard");

  redirect(
    `/attendance/input?schoolClassId=${schoolClassId}&attendanceDate=${attendanceDate}&success=saved`
  );
}