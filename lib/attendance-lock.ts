import type { Prisma } from "@/app/generated/prisma/client"

/** All attendance writers share this lock, including an initially absent day. */
export async function lockAttendanceDay(tx: Prisma.TransactionClient, classId: string, date: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`attendance:${classId}:${date}`}))`
}
