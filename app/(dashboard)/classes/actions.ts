"use server";

import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const createClassSchema = z.object({
  name: z.string().trim().min(1, "Nama kelas wajib diisi"),
  gradeLevel: z.coerce.number().int().min(7).max(9),
  academicYearId: z.string().min(1, "Tahun pelajaran wajib dipilih"),
});

export async function createClassAction(formData: FormData) {
  const user = await requirePermission("class.create");

  const parsed = createClassSchema.safeParse({
    name: formData.get("name"),
    gradeLevel: formData.get("gradeLevel"),
    academicYearId: formData.get("academicYearId"),
  });

  if (!parsed.success) {
    redirect("/classes?error=invalid");
  }

  const { name, gradeLevel, academicYearId } = parsed.data;

  const existingClass = await prisma.schoolClass.findUnique({
    where: {
      name_academicYearId: {
        name,
        academicYearId,
      },
    },
  });

  if (existingClass) {
    redirect("/classes?error=duplicate");
  }

  await prisma.$transaction(async (tx) => {
    const createdClass = await tx.schoolClass.create({
      data: {
        name,
        gradeLevel,
        academicYearId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "class.create",
        tableName: "classes",
        recordId: createdClass.id,
        newValue: {
          id: createdClass.id,
          name: createdClass.name,
          gradeLevel: createdClass.gradeLevel,
          academicYearId: createdClass.academicYearId,
        },
      },
    });
  });

  revalidatePath("/classes");
  redirect("/classes?success=created");
}