import { appConfig } from "@/lib/app-config";
import { prisma } from "@/lib/prisma";

export type SystemSettings = {
  appName: string;
  appFullName: string;
  schoolName: string;
};

export async function getSystemSettings(): Promise<SystemSettings> {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: {
        in: ["app_name", "app_full_name", "school_name"],
      },
    },
  });

  const settingMap = new Map(
    settings.map((setting) => [setting.key, setting.value])
  );

  return {
    appName: settingMap.get("app_name") ?? appConfig.appName,
    appFullName: settingMap.get("app_full_name") ?? appConfig.appFullName,
    schoolName: settingMap.get("school_name") ?? appConfig.schoolName,
  };
}