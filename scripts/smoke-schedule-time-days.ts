/**
 * Smoke end-to-end lapisan service terhadap database lokal.
 *
 * Menelusuri skenario verifikasi manual A–M dari permintaan fitur, tetapi
 * lewat service, bukan lewat UI: hanya di sinilah sifat "salinan, bukan
 * referensi" benar-benar teruji melawan constraint dan transaksi PostgreSQL.
 * Skrip ini MENULIS data, jadi hanya untuk database dev/prodclone.
 */
import { prisma } from "@/lib/prisma"
import {
  applyTemplateToDay,
  copyDayStructure,
  createTemplateFromDay,
  deleteTimeTemplate,
  ensureActiveTimeProfile,
  replaceDaySlots,
  updateTimeTemplate,
} from "@/lib/server-schedule"
import { findProfileDay, resolveSlotForDayPeriod } from "@/lib/schedule-time"

const ACTOR = "smoke-script"
let failures = 0

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`)
  }
}

function slotsOf(profile: Awaited<ReturnType<typeof ensureActiveTimeProfile>>, day: number) {
  return findProfileDay(profile.days, day)?.slots ?? []
}

async function main(): Promise<void> {
  const actorId =
    (await prisma.user.findFirst({ select: { id: true } }))?.id ?? ACTOR
  const profileId = (await ensureActiveTimeProfile()).id

  console.log("A/B. Senin dan Jumat memperoleh struktur berbeda")
  const senin = [
    { position: 1, kind: "PELAJARAN" as const, name: "Jam ke-1", startMinute: 420, endMinute: 460, ascPeriod: 1 },
    { position: 2, kind: "PELAJARAN" as const, name: "Jam ke-2", startMinute: 460, endMinute: 500, ascPeriod: 2 },
  ]
  const jumat = [
    { position: 1, kind: "PELAJARAN" as const, name: "Jam ke-1", startMinute: 420, endMinute: 450, ascPeriod: 1 },
  ]
  await replaceDaySlots({ profileId, day: 1, slots: senin, actorId })
  await replaceDaySlots({ profileId, day: 5, slots: jumat, actorId })

  let profile = await ensureActiveTimeProfile()
  check("Senin punya 2 baris", slotsOf(profile, 1).length === 2)
  check("Jumat punya 1 baris", slotsOf(profile, 5).length === 1)

  console.log("C/M. Period sama, jam berbeda antarhari (resolusi aSc)")
  const seninP1 = resolveSlotForDayPeriod(profile.days, 1, 1)
  const jumatP1 = resolveSlotForDayPeriod(profile.days, 5, 1)
  check("Senin period 1 selesai 07:40", seninP1?.endMinute === 460, seninP1?.endMinute)
  check("Jumat period 1 selesai 07:30", jumatP1?.endMinute === 450, jumatP1?.endMinute)
  check("Jumat tidak meminjam period 2 dari Senin", resolveSlotForDayPeriod(profile.days, 5, 2) === null)

  console.log("D. Simpan Senin sebagai template")
  const template = await createTemplateFromDay({
    profileId,
    day: 1,
    name: `Smoke ${Date.now()}`,
    actorId,
  })
  check("template menyalin 2 baris", template.slots.length === 2)

  console.log("E. Terapkan template ke Selasa")
  await applyTemplateToDay({ profileId, templateId: template.id, day: 2, actorId })
  profile = await ensureActiveTimeProfile()
  check("Selasa terisi 2 baris", slotsOf(profile, 2).length === 2)

  console.log("F/G. Edit template — Selasa tidak boleh ikut berubah")
  await updateTimeTemplate({
    templateId: template.id,
    name: template.name,
    slots: [
      { position: 1, kind: "PELAJARAN", name: "Diubah", startMinute: 300, endMinute: 330, ascPeriod: 1 },
    ],
    actorId,
  })
  profile = await ensureActiveTimeProfile()
  const selasaSetelahEditTemplate = slotsOf(profile, 2)
  check("Selasa tetap 2 baris", selasaSetelahEditTemplate.length === 2)
  check("Selasa tetap mulai 07:00", selasaSetelahEditTemplate[0]?.startMinute === 420, selasaSetelahEditTemplate[0]?.startMinute)

  console.log("H/I. Hapus template — Selasa harus utuh")
  await deleteTimeTemplate({ templateId: template.id, actorId })
  profile = await ensureActiveTimeProfile()
  check("Selasa tetap 2 baris setelah template dihapus", slotsOf(profile, 2).length === 2)
  check("Selasa masih punya period 1", resolveSlotForDayPeriod(profile.days, 2, 1) !== null)

  console.log("J/K/L. Salin Selasa → Rabu, lalu ubah Selasa")
  await copyDayStructure({ profileId, fromDay: 2, toDay: 3, actorId })
  await replaceDaySlots({
    profileId,
    day: 2,
    slots: [{ position: 1, kind: "PELAJARAN", name: "Baru", startMinute: 360, endMinute: 400, ascPeriod: 1 }],
    actorId,
  })
  profile = await ensureActiveTimeProfile()
  const rabu = slotsOf(profile, 3)
  check("Rabu tetap 2 baris", rabu.length === 2, rabu.length)
  check("Rabu tidak ikut berubah", rabu[0]?.startMinute === 420, rabu[0]?.startMinute)

  console.log("Validasi: struktur korup ditolak")
  let rejected = false
  try {
    await replaceDaySlots({
      profileId,
      day: 6,
      slots: [
        { position: 1, kind: "PELAJARAN", name: "A", startMinute: 500, endMinute: 400, ascPeriod: 1 },
      ],
      actorId,
    })
  } catch {
    rejected = true
  }
  check("mulai > selesai ditolak", rejected)

  let duplicateRejected = false
  try {
    await replaceDaySlots({
      profileId,
      day: 6,
      slots: [
        { position: 1, kind: "PELAJARAN", name: "A", startMinute: 420, endMinute: 460, ascPeriod: 1 },
        { position: 2, kind: "PELAJARAN", name: "B", startMinute: 460, endMinute: 500, ascPeriod: 1 },
      ],
      actorId,
    })
  } catch {
    duplicateRejected = true
  }
  check("jam ke- ganda dalam satu hari ditolak", duplicateRejected)

  await prisma.$disconnect()
  console.log(failures === 0 ? "\\nSMOKE OK" : `\\nSMOKE GAGAL: ${failures} pemeriksaan`)
  if (failures > 0) process.exitCode = 1
}

main()
