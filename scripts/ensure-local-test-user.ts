/**
 * Memastikan tepat satu akun uji khusus development/local ada di database lokal.
 *
 * Dipanggil manual (`npm run db:ensure-test-user`) atau setelah database lokal
 * ditimpa dari hasil restore, BUKAN pada start aplikasi. Script ini hanya
 * menyentuh satu baris User; tidak ada delete, truncate, reset, atau perubahan
 * schema, dan tidak ada data siswa/guru/kelas/absensi/setting yang dibaca-tulis.
 *
 * Semua guard keselamatan berada di lib/local-test-user.ts dan dievaluasi
 * sebelum koneksi database dibuka.
 */
import "dotenv/config"
import { compare, hash } from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, LegacyRole } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { planLocalTestUser } from "../lib/local-test-user"
import { SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"

const decision = planLocalTestUser(process.env)
if (!decision.ok) {
  console.error(`[ensure-local-test-user] DIBATALKAN: ${decision.reason}`)
  console.error("[ensure-local-test-user] Tidak ada penulisan database yang dilakukan.")
  process.exit(1)
}

const plan = decision.plan
const databaseUrl = process.env.DATABASE_URL!.trim()
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: databaseSchema(databaseUrl) }),
})

async function main() {
  console.log(
    `[ensure-local-test-user] Target lokal terverifikasi: host=${plan.databaseHost} db=${plan.databaseName} schema=${databaseSchema(databaseUrl)}`,
  )

  const existing = await prisma.user.findUnique({
    where: { email: plan.email },
    select: { id: true, role: true, active: true, passwordHash: true },
  })

  let userId: string

  if (!existing) {
    const created = await prisma.user.create({
      data: {
        email: plan.email,
        name: plan.name,
        // Kolom legacy tetap diisi karena masih ada di schema, tetapi BUKAN
        // sumber otorisasi: tidak satu pun modul lib/ membacanya. Akses nyata
        // datang dari keanggotaan role RBAC yang ditetapkan di bawah.
        role: LegacyRole.ADMIN,
        active: true,
        passwordHash: await hash(plan.password, 12),
      },
      select: { id: true, email: true, role: true },
    })
    console.log(`[ensure-local-test-user] Akun uji DIBUAT: ${created.email} (${created.role}) id=${created.id}`)
    userId = created.id
  } else {
    // Sudah ada: jangan duplikasi, jangan sentuh field lain. Hanya perbaiki hal
    // yang membuat akun uji tidak lagi bisa login.
    const repairs: string[] = []
    const data: { active?: boolean; role?: LegacyRole; passwordHash?: string } = {}

    if (!existing.active) {
      data.active = true
      repairs.push("active=true")
    }
    if (existing.role !== LegacyRole.ADMIN) {
      data.role = LegacyRole.ADMIN
      repairs.push("role=ADMIN")
    }
    if (!(await compare(plan.password, existing.passwordHash))) {
      data.passwordHash = await hash(plan.password, 12)
      repairs.push("passwordHash")
    }

    if (repairs.length === 0) {
      console.log(`[ensure-local-test-user] Akun uji sudah ada dan valid: ${plan.email}`)
    } else {
      await prisma.user.update({ where: { id: existing.id }, data })
      console.log(
        `[ensure-local-test-user] Akun uji sudah ada, diperbaiki minimal (${repairs.join(", ")}): ${plan.email}`,
      )
    }
    userId = existing.id
  }

  // Otorisasi pasca-RBAC berasal sepenuhnya dari keanggotaan role. Tanpa langkah
  // ini akun uji bisa login namun tidak memiliki satu pun permission pada
  // database lokal hasil bootstrap segar (yang tidak pernah menjalankan backfill).
  const systemRole = await prisma.role.findUnique({
    where: { key: SYSTEM_ADMIN_ROLE_KEY },
    select: { id: true },
  })

  if (!systemRole) {
    console.error(
      `[ensure-local-test-user] Role "${SYSTEM_ADMIN_ROLE_KEY}" belum ada. Jalankan \`npm run db:seed\` lebih dulu agar registry RBAC terpasang.`,
    )
    process.exitCode = 1
    return
  }

  // Idempoten: kunci unik (userId, roleId) membuat pemanggilan kedua no-op.
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: systemRole.id } },
    create: { userId, roleId: systemRole.id },
    update: {},
  })
  console.log(`[ensure-local-test-user] Role RBAC dipastikan: ${SYSTEM_ADMIN_ROLE_KEY}`)
}

main()
  .catch((error) => {
    console.error("[ensure-local-test-user] Gagal:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
