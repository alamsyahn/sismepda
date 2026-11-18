import { z } from "zod"

export const WORSHIP_REPORT_PERMISSIONS = ["attendance.read.assigned_classes", "attendance.read.all"] as const
export const WORSHIP_EXPORT_MAX_DAYS = 366

export const worshipStatus = z.enum(["IKUT", "DISPENSASI", "BELUM"])
export const WORSHIP_STATUS_LABELS: Record<z.infer<typeof worshipStatus>, string> = {
  IKUT: "Ikut",
  DISPENSASI: "Dispensasi ibadah",
  BELUM: "Belum ada catatan",
}

export const worshipEditInput = z.object({
  classId: z.string().min(1).max(100),
  studentId: z.string().min(1).max(100),
  date: z.string(),
  revision: z.number().int().nonnegative(),
  status: worshipStatus,
  reason: z.string().trim().min(2).max(300),
}).strict()
