/**
 * Kunci pemilik sesi WhatsApp.
 *
 * MENGAPA ADA
 *
 * Kredensial Baileys hanya boleh dipakai SATU soket. Dua proses yang memuat
 * direktori sesi yang sama akan membuka dua soket dengan identitas perangkat
 * yang sama; WhatsApp menanggapinya dengan mengambil alih sesi (440) lalu
 * mengeluarkan perangkat dari daftar tertaut (401). Gejalanya: penautan
 * berhasil, lalu beberapa menit kemudian sesi hilang dan menuntut QR baru.
 *
 * Kelas soket sudah dijaga di dalam satu proses (lihat `generation` pada
 * adapter). Yang tidak dapat dijaga dari sana adalah proses KEDUA: worker lama
 * yang belum mati saat deploy, worker lokal yang menunjuk volume produksi, atau
 * dua replica dari satu compose. Kunci ini menutup celah itu.
 *
 * CARA KERJA
 *
 * Satu berkas `owner.lock` di dalam direktori sesi, berisi metadata proses dan
 * stempel detak yang diperbarui berkala. Pemilik dianggap masih hidup bila
 * detaknya lebih muda dari {@link LOCK_STALE_MS}. Pendekatan berbasis waktu
 * dipilih karena PID tidak berarti lintas container: PID 1 ada di setiap
 * container, dan memeriksanya justru menghasilkan kesimpulan yang salah.
 *
 * Berkas ini TIDAK berisi kredensial; hanya metadata kepemilikan.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

export const LOCK_FILE_NAME = "owner.lock"

/**
 * Umur maksimum detak sebelum pemilik dianggap mati.
 *
 * Harus lebih besar dari beberapa kali interval detak, supaya worker yang
 * sekadar sibuk tidak dinyatakan mati oleh dirinya sendiri, dan cukup kecil
 * agar restart container tidak menunggu lama.
 */
export const LOCK_STALE_MS = 90_000
export const LOCK_HEARTBEAT_MS = 30_000

export type SessionLockRecord = {
  /** Penanda acak per proses; PID tidak unik lintas container. */
  ownerId: string
  pid: number
  startedAt: string
  heartbeatAt: string
}

export type LockDecision =
  | { status: "ACQUIRED"; record: SessionLockRecord }
  | { status: "TAKEN_OVER"; record: SessionLockRecord; previous: SessionLockRecord }
  | { status: "HELD_BY_OTHER"; holder: SessionLockRecord; ageMs: number }

function parse(raw: string): SessionLockRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<SessionLockRecord>
    if (typeof value.ownerId !== "string" || typeof value.heartbeatAt !== "string") return null
    return {
      ownerId: value.ownerId,
      pid: typeof value.pid === "number" ? value.pid : 0,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : value.heartbeatAt,
      heartbeatAt: value.heartbeatAt,
    }
  } catch {
    return null
  }
}

/**
 * Apakah pemegang kunci masih dianggap hidup.
 *
 * MURNI, supaya aturan basi/tidak-basi dapat diuji tanpa menyentuh disk.
 */
export function isLockStale(record: SessionLockRecord, now: Date, staleMs = LOCK_STALE_MS): boolean {
  const heartbeat = Date.parse(record.heartbeatAt)
  if (Number.isNaN(heartbeat)) return true
  return now.getTime() - heartbeat >= staleMs
}

/**
 * Coba menjadi pemilik tunggal direktori sesi.
 *
 * Kunci yang basi DIAMBIL ALIH, bukan dibiarkan memblokir selamanya: container
 * yang mati mendadak (OOM, kill -9) tidak sempat membersihkan miliknya, dan
 * sesi yang terkunci permanen sama buruknya dengan sesi yang direbut dua
 * proses.
 */
export function acquireSessionLock(
  sessionDir: string,
  { now = new Date(), ownerId = `${process.pid}-${Date.now().toString(36)}`, staleMs = LOCK_STALE_MS } = {},
): LockDecision {
  mkdirSync(sessionDir, { recursive: true })
  const path = join(sessionDir, LOCK_FILE_NAME)

  const existing = existsSync(path) ? parse(readFileSync(path, "utf8")) : null
  const record: SessionLockRecord = {
    ownerId,
    pid: process.pid,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  }

  if (existing && !isLockStale(existing, now, staleMs)) {
    return {
      status: "HELD_BY_OTHER",
      holder: existing,
      ageMs: now.getTime() - Date.parse(existing.heartbeatAt),
    }
  }

  writeFileSync(path, JSON.stringify(record), "utf8")
  return existing ? { status: "TAKEN_OVER", record, previous: existing } : { status: "ACQUIRED", record }
}

/** Perbarui detak kepemilikan. */
export function touchSessionLock(sessionDir: string, ownerId: string, now = new Date()): void {
  const path = join(sessionDir, LOCK_FILE_NAME)
  const existing = existsSync(path) ? parse(readFileSync(path, "utf8")) : null
  // Kunci yang sudah berpindah tangan tidak boleh direbut kembali diam-diam.
  if (existing && existing.ownerId !== ownerId) return
  writeFileSync(
    path,
    JSON.stringify({
      ownerId,
      pid: process.pid,
      startedAt: existing?.startedAt ?? now.toISOString(),
      heartbeatAt: now.toISOString(),
    } satisfies SessionLockRecord),
    "utf8",
  )
}

/** Lepas kepemilikan saat shutdown rapi, agar pengganti tidak menunggu basi. */
export function releaseSessionLock(sessionDir: string, ownerId: string): void {
  const path = join(sessionDir, LOCK_FILE_NAME)
  if (!existsSync(path)) return
  const existing = parse(readFileSync(path, "utf8"))
  if (existing && existing.ownerId !== ownerId) return
  rmSync(path, { force: true })
}
