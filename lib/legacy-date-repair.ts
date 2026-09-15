/**
 * Aturan MURNI untuk memutuskan apakah perbaikan tanggal bisnis legacy
 * (TD-014) masih perlu dijalankan terhadap sebuah clone.
 *
 * Latar belakang: `prisma/legacy-date-repair.sql` ditulis untuk schema
 * PRA-migrasi `20260909100000_use_date_for_business_dates`, saat kolom tanggal
 * bisnis masih `timestamp without time zone` dan memuat proyeksi zona waktu
 * (`17:00:00` UTC = tengah malam WIB). Seluruh isinya — `date::time`,
 * `AT TIME ZONE`, penulisan kembali sebagai `::timestamp` — hanya sah pada tipe
 * itu. Setelah migrasi tersebut diterapkan ke produksi, dump produksi sudah
 * membawa kolom bertipe `date`, dan `date::time` menjadi cast yang tidak ada di
 * PostgreSQL ("cannot cast type date to time without time zone").
 *
 * Karena itu keputusan diambil dari METADATA SCHEMA, bukan dari percobaan lalu
 * penangkapan error: tipe kolom nyata dibaca dari `information_schema`, lalu
 * fungsi di bawah memutuskan satu dari tiga hasil. Tidak ada try/catch yang
 * dapat menyembunyikan kegagalan lain sebagai "tidak perlu diperbaiki".
 *
 * Tidak ada import Prisma, `pg`, `fs`, atau proses anak di sini supaya
 * keputusannya dapat diuji sebagai fungsi murni — pola yang sama dengan
 * `lib/database-target.ts`.
 */

/** Satu kolom tanggal bisnis yang dikonversi migrasi date-only. */
export type BusinessDateColumn = {
  table: string
  column: string
}

/**
 * Persis tujuh kolom yang dikonversi `20260909100000_use_date_for_business_dates`.
 * Daftar ini adalah kontrak: bila migrasi itu pernah berjalan, ketujuhnya
 * bertipe `date`; bila belum, ketujuhnya bertipe `timestamp without time zone`.
 */
export const businessDateColumns: readonly BusinessDateColumn[] = [
  { table: "AttendanceDay", column: "date" },
  { table: "SchoolHoliday", column: "date" },
  { table: "User", column: "teachingSince" },
  { table: "AdditionalDuty", column: "startDate" },
  { table: "StudentViolationPoint", column: "occurredAt" },
  { table: "BosEntry", column: "occurredAt" },
  { table: "SarprasItem", column: "acquisitionDate" },
] as const

/** Kunci kanonik `Tabel.kolom`, dipakai sebagai kunci peta tipe. */
export function columnKey(column: BusinessDateColumn): string {
  return `${column.table}.${column.column}`
}

/** Tipe PostgreSQL yang sah untuk kolom tanggal bisnis. */
const DATE_TYPE = "date"
const LEGACY_TYPE = "timestamp without time zone"

export type LegacyDateRepairPlan =
  /** Kolom masih timestamp legacy: skrip repair wajib jalan sebelum migrasi. */
  | { action: "repair"; reason: string }
  /** Migrasi date-only sudah permanen di sumber dump: repair tidak berlaku. */
  | { action: "skip"; reason: string }
  /** Keadaan di luar dua di atas. Tidak pernah ditebak. */
  | { action: "abort"; reason: string }

/**
 * SQL read-only untuk membaca tipe nyata ketujuh kolom di atas.
 *
 * Sengaja tidak memakai parameter: nama tabel/kolom berasal dari konstanta di
 * modul ini, bukan dari input, dan seluruhnya di-quote sebagai literal.
 */
export function businessDateColumnTypeQuery(): string {
  const pairs = businessDateColumns
    .map((c) => `('${c.table}','${c.column}')`)
    .join(",")
  return (
    "select c.table_name || '.' || c.column_name || '|' || c.data_type " +
    "from information_schema.columns c " +
    `join (values ${pairs}) as w(t, col) on w.t = c.table_name and w.col = c.column_name ` +
    "where c.table_schema = 'public' " +
    "order by 1"
  )
}

/**
 * Mengurai keluaran `psql -At` dari query di atas menjadi peta
 * `Tabel.kolom` → tipe. Baris kosong diabaikan; baris rusak membuat parser
 * mengembalikan `null` supaya pemanggil membatalkan alih-alih menebak.
 */
export function parseBusinessDateColumnTypes(stdout: string): Record<string, string> | null {
  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const observed: Record<string, string> = {}
  for (const row of rows) {
    const separator = row.indexOf("|")
    if (separator <= 0) return null
    const key = row.slice(0, separator).trim()
    const type = row.slice(separator + 1).trim().toLowerCase()
    if (!key || !type) return null
    observed[key] = type
  }
  return observed
}

/**
 * Memutuskan apa yang harus dilakukan terhadap tahap TD-014.
 *
 * Fail-closed: kolom yang hilang, tipe tak dikenal, atau campuran tipe antar
 * kolom membatalkan refresh dengan pesan yang menyebut kolomnya. Campuran
 * berarti riwayat migrasi sumber dump tidak konsisten — kondisi yang harus
 * dilaporkan, bukan ditambal oleh skrip data.
 */
export function planLegacyDateRepair(observed: Record<string, string>): LegacyDateRepairPlan {
  const dateColumns: string[] = []
  const legacyColumns: string[] = []
  const missing: string[] = []
  const unknown: string[] = []

  for (const column of businessDateColumns) {
    const key = columnKey(column)
    const type = observed[key]
    if (!type) {
      missing.push(key)
    } else if (type === DATE_TYPE) {
      dateColumns.push(key)
    } else if (type === LEGACY_TYPE) {
      legacyColumns.push(key)
    } else {
      unknown.push(`${key} (${type})`)
    }
  }

  if (missing.length > 0) {
    return {
      action: "abort",
      reason:
        `Kolom tanggal bisnis tidak ditemukan di schema clone: ${missing.join(", ")}.\n` +
        "Dump tidak sesuai dengan schema yang dikenal workflow ini; tidak ada yang ditebak.",
    }
  }

  if (unknown.length > 0) {
    return {
      action: "abort",
      reason:
        `Tipe kolom tanggal bisnis di luar yang dikenal: ${unknown.join(", ")}.\n` +
        `Hanya \`${DATE_TYPE}\` dan \`${LEGACY_TYPE}\` yang dikenali.`,
    }
  }

  if (legacyColumns.length > 0 && dateColumns.length > 0) {
    return {
      action: "abort",
      reason:
        "Schema clone bercampur: " +
        `${dateColumns.length} kolom sudah \`date\` (${dateColumns.join(", ")}) ` +
        `sementara ${legacyColumns.length} masih \`${LEGACY_TYPE}\` (${legacyColumns.join(", ")}).\n` +
        "Riwayat migrasi sumber dump tidak konsisten. Laporkan; jangan perbaiki dengan skrip data.",
    }
  }

  if (legacyColumns.length > 0) {
    return {
      action: "repair",
      reason:
        `Kolom tanggal bisnis masih \`${LEGACY_TYPE}\`: dump berasal dari schema pra-migrasi ` +
        "`20260909100000_use_date_for_business_dates`, sehingga normalisasi legacy masih berlaku.",
    }
  }

  return {
    action: "skip",
    reason:
      "Ketujuh kolom tanggal bisnis sudah bertipe `date`: migrasi " +
      "`20260909100000_use_date_for_business_dates` sudah permanen di sumber dump, " +
      "sehingga tidak ada nilai non-midnight yang mungkin ada untuk dinormalkan.",
  }
}

/**
 * Verifikasi read-only untuk jalur `skip`: melewati repair tidak boleh berarti
 * melewati pemeriksaan. Invariant yang dijamin migrasi date-only harus tetap
 * berlaku pada clone — tidak ada tabrakan `(classId, date)` pada
 * `AttendanceDay`, dan tidak ada pada `SchoolHoliday.date`.
 */
export function businessDateInvariantQuery(): string {
  return (
    "select " +
    '(select count(*) from (select 1 from "AttendanceDay" group by "classId", date having count(*) > 1) a)' +
    " || '|' || " +
    '(select count(*) from (select 1 from "SchoolHoliday" group by date having count(*) > 1) h)'
  )
}

export type BusinessDateInvariantResult =
  | { ok: true; attendanceCollisions: 0; holidayCollisions: 0 }
  | { ok: false; reason: string }

/** Mengurai dan menilai hasil {@link businessDateInvariantQuery}. */
export function evaluateBusinessDateInvariant(stdout: string): BusinessDateInvariantResult {
  const parts = stdout.trim().split("|")
  if (parts.length !== 2) {
    return { ok: false, reason: `Hasil pemeriksaan invariant tidak terbaca: "${stdout.trim()}".` }
  }

  const [attendanceRaw, holidayRaw] = parts
  const attendance = Number(attendanceRaw)
  const holiday = Number(holidayRaw)
  if (!Number.isInteger(attendance) || !Number.isInteger(holiday)) {
    return { ok: false, reason: `Hasil pemeriksaan invariant bukan bilangan: "${stdout.trim()}".` }
  }

  if (attendance > 0 || holiday > 0) {
    return {
      ok: false,
      reason:
        `Clone melanggar invariant tanggal bisnis: ${attendance} tabrakan AttendanceDay(classId, date), ` +
        `${holiday} tabrakan SchoolHoliday(date).\n` +
        "Ini berarti data sumber dump tidak sesuai dengan constraint unique yang berlaku.",
    }
  }

  return { ok: true, attendanceCollisions: 0, holidayCollisions: 0 }
}
