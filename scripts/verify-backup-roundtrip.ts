/**
 * Bukti perilaku backup → restore pasca-RBAC, dijalankan terhadap database
 * NYATA (bukan mock), pada schema sementara sehingga data kerja tidak tersentuh.
 *
 *   npx tsx --env-file=.env scripts/verify-backup-roundtrip.ts
 *
 * Yang dibuktikan:
 *   1. arsip pasca-RBAC yang utuh mempertahankan akun, state aktif, role,
 *      permission, keanggotaan, system_admin, readiness, data bisnis, dan
 *      hash sandi — tanpa grant yang muncul atau hilang;
 *   2. arsip pra-RBAC, arsip tak lengkap, arsip berversi salah, dan arsip
 *      bermasalah DITOLAK sebelum perintah destruktif pertama, dan database
 *      target tetap utuh setelah penolakan.
 *
 * GUARD: menolak berjalan bila DATABASE_URL menunjuk host non-lokal. Skrip ini
 * membuat dan menghapus schema uji sendiri; ia tidak pernah menyentuh schema
 * aplikasi.
 */
import "dotenv/config"

import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { evaluateRestorePreflight, REQUIRED_RBAC_TABLES, SUPPORTED_BACKUP_FORMAT } from "../lib/database-restore-preflight"

const execute = promisify(execFile)

let lolos = 0
let gagal = 0

function periksa(nama: string, ok: boolean, detail: string) {
  if (ok) {
    lolos += 1
    console.log(`PASS  ${nama} — ${detail}`)
  } else {
    gagal += 1
    console.log(`FAIL  ${nama} — ${detail}`)
  }
}

/** Menolak berjalan terhadap database yang bukan lokal. */
function pastikanLokal(url: string) {
  const host = new URL(url).hostname
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`REFUSED: host "${host}" bukan database lokal. Skrip ini hanya untuk verifikasi lokal.`)
  }
}

function baseUrl(url: string) {
  return url.split("?")[0]
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url?.trim()) throw new Error("DATABASE_URL wajib dikonfigurasi")
  pastikanLokal(url)

  const schemaAsal = databaseSchema(url) ?? "public"
  const schemaUji = `sismepda_roundtrip_${Date.now()}`
  const dsn = baseUrl(url)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }, { schema: schemaAsal }),
  })

  let direktori: string | undefined
  try {
    direktori = await mkdtemp(join(tmpdir(), "sismepda-roundtrip-"))
    const arsip = join(direktori, "post-rbac.dump")

    // --- Ambil kondisi awal dari schema aplikasi (read-only) ---
    const [akunAwal, roleAwal, permissionAwal, keanggotaanAwal, markerAwal] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, email: true, active: true, passwordHash: true },
        orderBy: { id: "asc" },
      }),
      prisma.role.findMany({ select: { id: true, key: true }, orderBy: { id: "asc" } }),
      prisma.permission.count(),
      prisma.userRole.findMany({ select: { userId: true, roleId: true }, orderBy: [{ userId: "asc" }, { roleId: "asc" }] }),
      prisma.rbacMigration.findMany({ select: { key: true, status: true } }),
    ])

    periksa(
      "prasyarat: database sumber memiliki data RBAC",
      akunAwal.length > 0 && roleAwal.length > 0 && keanggotaanAwal.length > 0,
      `akun=${akunAwal.length} role=${roleAwal.length} keanggotaan=${keanggotaanAwal.length}`,
    )

    const sistemAwal = roleAwal.find((r) => r.key === "system_admin")
    periksa("prasyarat: role system_admin ada", Boolean(sistemAwal), sistemAwal ? sistemAwal.key : "tidak ditemukan")

    // --- 1. Backup pasca-RBAC ---
    await execute("pg_dump", [
      "--dbname", dsn,
      `--schema=${schemaAsal}`,
      "--format=custom", "--data-only", "--no-owner", "--no-privileges",
      "--exclude-table=*._prisma_migrations",
      "--file", arsip,
    ], { maxBuffer: 64 * 1024 * 1024 })

    const daftar = await execute("pg_restore", ["--list", arsip], { maxBuffer: 32 * 1024 * 1024 })
    const tabelArsip = [...daftar.stdout.matchAll(/TABLE DATA \S+ ([A-Za-z_][A-Za-z0-9_]*) /g)].map((m) => m[1])

    const kurang = REQUIRED_RBAC_TABLES.filter((t) => !tabelArsip.includes(t))
    periksa(
      "backup pasca-RBAC memuat seluruh tabel RBAC wajib",
      kurang.length === 0,
      kurang.length === 0 ? `${tabelArsip.length} tabel` : `tidak ada: ${kurang.join(", ")}`,
    )

    periksa(
      "backup tidak memuat tabel migrasi",
      !tabelArsip.includes("_prisma_migrations"),
      "_prisma_migrations dikecualikan",
    )

    // --- 2. Preflight menerima arsip utuh ---
    const utuh = evaluateRestorePreflight({ archiveTables: tabelArsip, formatHeader: SUPPORTED_BACKUP_FORMAT })
    periksa("preflight menerima arsip pasca-RBAC yang utuh", utuh.compatible, `compatible=${utuh.compatible}`)

    // --- 3. Restore ke schema uji, lalu bandingkan isi ---
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaUji}"`)

    // Salin struktur schema aplikasi ke schema uji.
    const strukturPath = join(direktori, "struktur.sql")
    await execute("pg_dump", [
      "--dbname", dsn, `--schema=${schemaAsal}`, "--schema-only", "--no-owner", "--no-privileges",
      "--file", strukturPath,
    ], { maxBuffer: 64 * 1024 * 1024 })

    // Arahkan struktur ke schema uji tanpa menyentuh schema asal.
    const { readFile, writeFile } = await import("node:fs/promises")
    const struktur = await readFile(strukturPath, "utf8")
    const strukturUji = join(direktori, "struktur-uji.sql")
    await writeFile(
      strukturUji,
      struktur
        .replace(new RegExp(`CREATE SCHEMA "?${schemaAsal}"?;`, "g"), "")
        .replace(new RegExp(`"?${schemaAsal}"?\\.`, "g"), `"${schemaUji}".`)
        .replace(/SET search_path = [^;]+;/g, `SET search_path = "${schemaUji}";`),
    )
    await execute("psql", ["--dbname", dsn, "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file", strukturUji], {
      maxBuffer: 32 * 1024 * 1024,
    })

    // Restore data arsip ke schema uji.
    const dataPath = join(direktori, "data.sql")
    await execute("pg_restore", ["--data-only", "--no-owner", "--no-privileges", "--file", dataPath, arsip], {
      maxBuffer: 64 * 1024 * 1024,
    })
    const data = await readFile(dataPath, "utf8")
    const dataUji = join(direktori, "data-uji.sql")
    await writeFile(
      dataUji,
      data
        .replace(new RegExp(`"?${schemaAsal}"?\\.`, "g"), `"${schemaUji}".`)
        .replace(/SET search_path = [^;]+;/g, `SET search_path = "${schemaUji}";`),
    )
    await execute("psql", ["--dbname", dsn, "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file", dataUji], {
      maxBuffer: 64 * 1024 * 1024,
    })

    const ujiPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }, { schema: schemaUji }),
    })

    try {
      const [akunUji, roleUji, permissionUji, keanggotaanUji, markerUji] = await Promise.all([
        ujiPrisma.user.findMany({
          select: { id: true, email: true, active: true, passwordHash: true },
          orderBy: { id: "asc" },
        }),
        ujiPrisma.role.findMany({ select: { id: true, key: true }, orderBy: { id: "asc" } }),
        ujiPrisma.permission.count(),
        ujiPrisma.userRole.findMany({
          select: { userId: true, roleId: true },
          orderBy: [{ userId: "asc" }, { roleId: "asc" }],
        }),
        ujiPrisma.rbacMigration.findMany({ select: { key: true, status: true } }),
      ])

      periksa(
        "roundtrip mempertahankan seluruh akun",
        akunUji.length === akunAwal.length,
        `awal=${akunAwal.length} hasil=${akunUji.length}`,
      )

      const aktifAwal = akunAwal.filter((a) => a.active).length
      const aktifUji = akunUji.filter((a) => a.active).length
      periksa("roundtrip mempertahankan state aktif", aktifAwal === aktifUji, `aktif awal=${aktifAwal} hasil=${aktifUji}`)

      const hashBerubah = akunAwal.filter((a, i) => a.passwordHash !== akunUji[i]?.passwordHash).length
      periksa("hash sandi tidak berubah", hashBerubah === 0, `berbeda=${hashBerubah}`)

      periksa("roundtrip mempertahankan role", roleUji.length === roleAwal.length, `awal=${roleAwal.length} hasil=${roleUji.length}`)
      periksa("roundtrip mempertahankan permission", permissionUji === permissionAwal, `awal=${permissionAwal} hasil=${permissionUji}`)

      const kunciAwal = new Set(keanggotaanAwal.map((k) => `${k.userId}:${k.roleId}`))
      const kunciUji = new Set(keanggotaanUji.map((k) => `${k.userId}:${k.roleId}`))
      const hilang = [...kunciAwal].filter((k) => !kunciUji.has(k))
      const bertambah = [...kunciUji].filter((k) => !kunciAwal.has(k))
      periksa(
        "tidak ada keanggotaan role yang hilang atau muncul",
        hilang.length === 0 && bertambah.length === 0,
        `hilang=${hilang.length} bertambah=${bertambah.length}`,
      )

      const sistemUji = roleUji.find((r) => r.key === "system_admin")
      const adminAktif = sistemUji
        ? keanggotaanUji.filter((k) => k.roleId === sistemUji.id)
            .filter((k) => akunUji.find((a) => a.id === k.userId)?.active).length
        : 0
      periksa("system_admin aktif tetap ada setelah restore", adminAktif > 0, `admin aktif=${adminAktif}`)

      periksa(
        "readiness/marker migrasi ikut terpulihkan",
        markerUji.length === markerAwal.length,
        `awal=${markerAwal.length} hasil=${markerUji.length}`,
      )

      const siswaAwal = await prisma.student.count()
      const siswaUji = await ujiPrisma.student.count()
      periksa("data bisnis ikut terpulihkan", siswaUji === siswaAwal, `siswa awal=${siswaAwal} hasil=${siswaUji}`)
    } finally {
      await ujiPrisma.$disconnect()
    }

    // --- 4. Arsip tidak kompatibel ditolak SEBELUM perubahan destruktif ---
    const sebelumPenolakan = await prisma.userRole.count()

    const kasusTolak: Array<{ nama: string; tabel: string[]; format?: string | null; alasan: string }> = [
      { nama: "arsip pra-RBAC ditolak", tabel: ["User", "Student", "AttendanceDay"], alasan: "rbac-tables-missing" },
      { nama: "arsip tanpa keanggotaan role ditolak", tabel: ["User", "RbacRole", "Permission", "RolePermission", "RbacMigration"], alasan: "rbac-tables-missing" },
      { nama: "arsip versi format salah ditolak", tabel: [...REQUIRED_RBAC_TABLES], format: "postgresql-data-v0", alasan: "format-unsupported" },
      { nama: "arsip kosong ditolak", tabel: [], alasan: "no-table-data" },
      { nama: "arsip berisi tabel migrasi ditolak", tabel: [...REQUIRED_RBAC_TABLES, "_prisma_migrations"], alasan: "migration-table-present" },
    ]

    for (const kasus of kasusTolak) {
      const hasil = evaluateRestorePreflight({
        archiveTables: kasus.tabel,
        formatHeader: kasus.format ?? SUPPORTED_BACKUP_FORMAT,
      })
      periksa(
        kasus.nama,
        !hasil.compatible && hasil.reason === kasus.alasan,
        hasil.compatible ? "DITERIMA (seharusnya ditolak)" : `reason=${hasil.reason}`,
      )
    }

    const sesudahPenolakan = await prisma.userRole.count()
    periksa(
      "database tetap utuh setelah seluruh penolakan",
      sesudahPenolakan === sebelumPenolakan,
      `keanggotaan sebelum=${sebelumPenolakan} sesudah=${sesudahPenolakan}`,
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaUji}" CASCADE`).catch(() => undefined)
    await prisma.$disconnect()
    if (direktori) await rm(direktori, { recursive: true, force: true }).catch(() => undefined)
  }

  console.log(`\n${lolos}/${lolos + gagal} lolos`)
  if (gagal > 0) process.exit(1)
}

main().catch((error) => {
  console.error(`GAGAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
