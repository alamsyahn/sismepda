/**
 * Local-only fixture for the Sarpras module.
 *
 * Creates a realistic location tree, master item types, and items that exercise
 * every dashboard status (including shortage-against-target), then prints the
 * computed statistics so the chart math can be verified against real reads.
 *
 * Guarded: refuses to run against anything but the local dev schema.
 */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { sarprasSlug, summarizeSarpras, primaryStatus, sarprasStatusLabels } from "../lib/sarpras"

const connectionString = process.env.DATABASE_URL ?? ""
const schema = databaseSchema(connectionString)

if (schema !== "sismepda_local") {
  console.error(`Refusing to seed: expected schema "sismepda_local", got "${schema}".`)
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) })

type ItemSpec = {
  location: string
  type: string
  target: number
  available: number
  good?: number
  moderate?: number
  repair?: number
  note?: string
  year?: number
  priority?: "HIGH" | "MEDIUM" | "LOW"
}

/** Kelas > VII A..IX I, plus labs and standalone rooms. */
const tree: Array<{ name: string; children?: string[] }> = [
  { name: "Kelas", children: ["VII A", "VII B", "VII C", "VIII A", "VIII B", "VIII I", "IX A"] },
  { name: "Laboratorium", children: ["Laboratorium Komputer", "Laboratorium IPA"] },
  { name: "Ruang Guru" },
  { name: "Lapangan" },
  { name: "Aula" },
  { name: "Tempat Parkir" },
]

const itemTypes = [
  "CCTV",
  "Proyektor",
  "Kipas Angin",
  "Meja Guru",
  "Kursi Siswa",
  "Komputer",
  "AC",
  "APAR",
]

const items: ItemSpec[] = [
  // Contoh dari spesifikasi: CCTV VIII I belum tersedia sama sekali.
  { location: "VIII I", type: "CCTV", target: 1, available: 0, note: "Belum tersedia", priority: "HIGH" },
  { location: "VII A", type: "CCTV", target: 1, available: 0, note: "Belum tersedia" },
  // Proyektor rusak: tersedia tetapi kondisinya perlu perbaikan.
  { location: "VIII B", type: "Proyektor", target: 1, available: 1, repair: 1, year: 2021, note: "Warna proyeksi berubah" },
  { location: "VII A", type: "Proyektor", target: 1, available: 1, good: 1, year: 2023 },
  // Barang berjumlah banyak dengan campuran kondisi.
  { location: "VII A", type: "Kursi Siswa", target: 32, available: 32, good: 28, moderate: 2, repair: 2, year: 2022, note: "Kaki patah pada 2 unit" },
  { location: "VII B", type: "Kursi Siswa", target: 32, available: 30, good: 30, year: 2022 },
  { location: "VIII A", type: "Kursi Siswa", target: 32, available: 32, good: 32, year: 2024 },
  // Kekurangan sebagian: target 4, tersedia 2 -> 2 unit masuk "Tidak Ada".
  { location: "Aula", type: "Kipas Angin", target: 4, available: 2, good: 2, year: 2020 },
  { location: "Ruang Guru", type: "AC", target: 2, available: 2, good: 1, moderate: 1, year: 2019 },
  { location: "Laboratorium Komputer", type: "Komputer", target: 30, available: 24, good: 18, moderate: 4, repair: 2, year: 2021 },
  { location: "Laboratorium IPA", type: "APAR", target: 2, available: 1, good: 1, year: 2023, priority: "HIGH" },
  { location: "Ruang Guru", type: "Meja Guru", target: 20, available: 20, good: 17, moderate: 3, year: 2018 },
  { location: "Lapangan", type: "CCTV", target: 2, available: 1, moderate: 1, year: 2022 },
  { location: "Tempat Parkir", type: "CCTV", target: 1, available: 0, note: "Diusulkan tahun ini", priority: "MEDIUM" },
]

async function main() {
  // Idempotent: clear only Sarpras tables, never touch other modules.
  await prisma.sarprasHistory.deleteMany()
  await prisma.sarprasPhoto.deleteMany()
  await prisma.sarprasItem.deleteMany()
  await prisma.sarprasLocation.deleteMany({ where: { parentId: { not: null } } })
  await prisma.sarprasLocation.deleteMany()
  await prisma.sarprasItemType.deleteMany()

  const locationIds = new Map<string, string>()
  let rootOrder = 0
  for (const root of tree) {
    const created = await prisma.sarprasLocation.create({
      data: { name: root.name, slug: sarprasSlug(root.name), sortOrder: rootOrder++ },
      select: { id: true },
    })
    locationIds.set(root.name, created.id)

    let childOrder = 0
    for (const child of root.children ?? []) {
      const childRow = await prisma.sarprasLocation.create({
        data: {
          name: child,
          slug: sarprasSlug(child),
          parentId: created.id,
          sortOrder: childOrder++,
        },
        select: { id: true },
      })
      locationIds.set(child, childRow.id)
    }
  }

  const typeIds = new Map<string, string>()
  for (const name of itemTypes) {
    const created = await prisma.sarprasItemType.create({
      data: { name, slug: sarprasSlug(name) },
      select: { id: true },
    })
    typeIds.set(name, created.id)
  }

  for (const spec of items) {
    const locationId = locationIds.get(spec.location)
    const itemTypeId = typeIds.get(spec.type)
    if (!locationId || !itemTypeId) throw new Error(`Unknown location/type: ${spec.location}/${spec.type}`)

    await prisma.sarprasItem.create({
      data: {
        locationId,
        itemTypeId,
        targetQuantity: spec.target,
        availableQuantity: spec.available,
        goodQuantity: spec.good ?? 0,
        moderateQuantity: spec.moderate ?? 0,
        repairQuantity: spec.repair ?? 0,
        acquisitionDate: spec.year ? new Date(spec.year, 6, 1) : null,
        description: spec.note ?? null,
        priority: spec.priority ?? null,
      },
    })
  }

  // Verify the dashboard math against what is actually stored.
  const stored = await prisma.sarprasItem.findMany({
    select: {
      targetQuantity: true,
      availableQuantity: true,
      goodQuantity: true,
      moderateQuantity: true,
      repairQuantity: true,
    },
  })
  const stats = summarizeSarpras(stored)

  const tabCounts = { MISSING: 0, REPAIR: 0, MODERATE: 0, GOOD: 0 }
  for (const item of stored) tabCounts[primaryStatus(item)] += 1

  console.log(`Lokasi   : ${locationIds.size}`)
  console.log(`Jenis    : ${typeIds.size}`)
  console.log(`Barang   : ${stored.length}`)
  console.log("")
  console.log("Statistik chart (unit):")
  for (const status of ["MISSING", "REPAIR", "MODERATE", "GOOD"] as const) {
    const value =
      status === "MISSING" ? stats.missing
      : status === "REPAIR" ? stats.repair
      : status === "MODERATE" ? stats.moderate
      : stats.good
    console.log(`  ${sarprasStatusLabels[status].padEnd(16)} ${String(value).padStart(4)}`)
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${String(stats.total).padStart(4)}`)
  console.log("")
  console.log("Jumlah baris per tab prioritas:")
  for (const status of ["MISSING", "REPAIR", "MODERATE", "GOOD"] as const) {
    console.log(`  ${sarprasStatusLabels[status].padEnd(16)} ${String(tabCounts[status]).padStart(4)}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
