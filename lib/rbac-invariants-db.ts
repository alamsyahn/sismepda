/**
 * Penegakan invariant kewenangan di dalam transaksi database.
 *
 * Pemeriksaan murni di `lib/rbac-invariants.ts` tidak cukup: dua permintaan
 * bersamaan bisa sama-sama membaca "masih ada 2 admin", lalu keduanya mencabut,
 * dan sekolah kehilangan seluruh Admin Sistem. Karena yang dilindungi adalah
 * KETIADAAN baris (tidak ada baris untuk dikunci dengan SELECT FOR UPDATE),
 * penguncian baris tidak menyelesaikan masalah.
 *
 * Solusinya: PostgreSQL transaction-level advisory lock. Seluruh mutasi yang
 * dapat mengurangi populasi Admin Sistem mengambil kunci yang SAMA, sehingga
 * mereka terserialisasi. Kunci dilepas otomatis saat transaksi selesai atau
 * gagal, jadi tidak ada kunci yang menggantung.
 */

import type { Prisma } from "@/app/generated/prisma/client"
import { SYSTEM_ADMIN_ROLE_KEY } from "@/lib/rbac-permissions"
import { assertSystemAdminRemains, type InvariantDenial } from "@/lib/rbac-invariants"

/**
 * Kunci advisory tunggal untuk seluruh populasi Admin Sistem.
 *
 * Angka konstan dan arbitrer, tetapi harus stabil: mengubahnya membuat
 * transaksi lama dan baru tidak lagi saling mengunci.
 */
const SYSTEM_ADMIN_POPULATION_LOCK = 774_100_601

export type TransactionClient = Prisma.TransactionClient

/**
 * Mengambil kunci populasi Admin Sistem untuk transaksi ini.
 *
 * `pg_advisory_xact_lock` MENUNGGU, bukan gagal cepat: permintaan kedua
 * tertahan sampai yang pertama commit, lalu membaca kondisi terbaru dan
 * ditolak oleh pemeriksaan invariant. Itulah yang membuat "minimal satu dari
 * dua permintaan bersamaan gagal" menjadi benar.
 */
export async function lockSystemAdminPopulation(tx: TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYSTEM_ADMIN_POPULATION_LOCK})`
}

/**
 * Id seluruh Admin Sistem yang masih aktif, tidak termasuk `excludeUserId`.
 *
 * Harus dipanggil SETELAH `lockSystemAdminPopulation` dan setelah perubahan
 * ditulis, agar yang terbaca adalah kondisi akhir transaksi.
 */
export async function findRemainingActiveSystemAdmins(
  tx: TransactionClient,
  excludeUserId?: string,
): Promise<string[]> {
  const rows = await tx.userRole.findMany({
    where: {
      role: { key: SYSTEM_ADMIN_ROLE_KEY },
      user: { active: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    },
    select: { userId: true },
  })

  return rows.map((row) => row.userId)
}

export class InvariantViolationError extends Error {
  constructor(readonly denial: InvariantDenial) {
    super(denial.error)
    this.name = "InvariantViolationError"
  }
}

/**
 * Memverifikasi — di dalam transaksi, setelah perubahan ditulis — bahwa masih
 * ada Admin Sistem aktif. Melempar `InvariantViolationError` untuk membatalkan
 * transaksi bila tidak.
 *
 * Urutan pemakaian yang benar di dalam `prisma.$transaction`:
 *   1. `lockSystemAdminPopulation(tx)`
 *   2. tulis perubahan
 *   3. `assertSystemAdminPopulationIntact(tx, ...)`
 *
 * Menulis lebih dulu lalu memverifikasi membuat pemeriksaan melihat efek
 * sesungguhnya, termasuk penonaktifan akun dan pencabutan role sekaligus.
 */
export async function assertSystemAdminPopulationIntact(
  tx: TransactionClient,
  input: { actorId: string; targetId: string },
): Promise<void> {
  const remaining = await findRemainingActiveSystemAdmins(tx)
  const denial = assertSystemAdminRemains({
    remainingActiveAdminIds: remaining,
    actorId: input.actorId,
    targetId: input.targetId,
  })

  if (denial) throw new InvariantViolationError(denial)
}
