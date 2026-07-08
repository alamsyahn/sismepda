"use server";

import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const updateSettingsSchema = z.object({
  appName: z.string().trim().min(1, "Nama aplikasi wajib diisi"),
  appFullName: z.string().trim().min(1, "Nama lengkap aplikasi wajib diisi"),
  schoolName: z.string().trim().min(1, "Nama sekolah wajib diisi"),
});

export async function updateSystemSettingsAction(formData: FormData) {
  const user = await requirePermission("setting.manage");

  const parsed = updateSettingsSchema.safeParse({
    appName: formData.get("appName"),
    appFullName: formData.get("appFullName"),
    schoolName: formData.get("schoolName"),
  });

  if (!parsed.success) {
    redirect("/settings?error=invalid");
  }

  const { appName, appFullName, schoolName } = parsed.data;

  const oldSettings = await prisma.appSetting.findMany({
    where: {
      key: {
        in: ["app_name", "app_full_name", "school_name"],
      },
    },
  });
  
  const oldValue = Object.fromEntries(
    oldSettings.map((setting) => [setting.key, setting.value])
  );

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: {
        key: "app_name",
      },
      update: {
        value: appName,
      },
      create: {
        key: "app_name",
        value: appName,
        description: "Nama pendek aplikasi",
      },
    }),

    prisma.appSetting.upsert({
      where: {
        key: "app_full_name",
      },
      update: {
        value: appFullName,
      },
      create: {
        key: "app_full_name",
        value: appFullName,
        description: "Nama lengkap aplikasi",
      },
    }),

    prisma.appSetting.upsert({
      where: {
        key: "school_name",
      },
      update: {
        value: schoolName,
      },
      create: {
        key: "school_name",
        value: schoolName,
        description: "Nama sekolah",
      },
    }),

    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "settings.update",
        tableName: "app_settings",
        oldValue,
        newValue: {
          app_name: appName,
          app_full_name: appFullName,
          school_name: schoolName,
        },
      },
    }),
  ]);

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/attendance/input");
  revalidatePath("/attendance/recap");
  revalidatePath("/attendance/ranking");
  revalidatePath("/students");
  revalidatePath("/classes");

  redirect("/settings?success=updated");
}