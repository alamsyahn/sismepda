import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execute = promisify(execFile)
const MAX_BACKUP_SIZE = 200 * 1024 * 1024

function databaseUrl() {
  if (!process.env.DATABASE_URL?.startsWith("postgresql://")) throw new Error("Database PostgreSQL belum dikonfigurasi")
  return process.env.DATABASE_URL
}

function backupName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `sismepda-backup-${stamp}.dump`
}

export async function GET() {
  let directory: string | undefined
  try {
    await requireAdmin()
    directory = await mkdtemp(join(tmpdir(), "sismepda-backup-"))
    const output = join(directory, "backup.dump")
    await execute("pg_dump", ["--dbname", databaseUrl(), "--format=custom", "--data-only", "--no-owner", "--no-privileges", "--exclude-table=_prisma_migrations", "--file", output], { maxBuffer: 10 * 1024 * 1024 })
    const backup = await readFile(output)
    return new Response(backup, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${backupName()}"`, "Cache-Control": "no-store", "X-SISMEPDA-Backup-Format": "postgresql-data-v1" } })
  } catch (error) {
    console.error("Database backup failed", error)
    return NextResponse.json({ error: "Backup database gagal dibuat" }, { status: 500 })
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function POST(request: Request) {
  let directory: string | undefined
  try {
    await requireAdmin()
    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_BACKUP_SIZE) return NextResponse.json({ error: "Ukuran backup maksimal 200 MB" }, { status: 413 })
    const form = await request.formData()
    const confirmation = form.get("confirmation")
    const file = form.get("backup")
    if (confirmation !== "RESTORE DATABASE") return NextResponse.json({ error: "Konfirmasi restore tidak sesuai" }, { status: 400 })
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BACKUP_SIZE) return NextResponse.json({ error: "File backup tidak valid" }, { status: 400 })

    directory = await mkdtemp(join(tmpdir(), "sismepda-restore-"))
    const archivePath = join(directory, "restore.dump")
    const dataSqlPath = join(directory, "data.sql")
    const restoreSqlPath = join(directory, "restore.sql")
    await writeFile(archivePath, Buffer.from(await file.arrayBuffer()))

    const archiveContents = await execute("pg_restore", ["--list", archivePath], { maxBuffer: 20 * 1024 * 1024 })
    if (archiveContents.stdout.includes("_prisma_migrations")) throw new Error("Backup tidak kompatibel karena berisi tabel migrasi")
    const archivedTables = [...archiveContents.stdout.matchAll(/TABLE DATA public ([A-Za-z_][A-Za-z0-9_]*) /g)].map((match) => match[1])
    if (archivedTables.length === 0) throw new Error("Backup tidak berisi data tabel SISMEPDA")
    await execute("pg_restore", ["--data-only", "--no-owner", "--no-privileges", "--file", dataSqlPath, archivePath], { maxBuffer: 20 * 1024 * 1024 })
    const dataSql = await readFile(dataSqlPath, "utf8")
    const truncateSql = `TRUNCATE TABLE ${archivedTables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE;\n`
    await writeFile(restoreSqlPath, truncateSql + dataSql)
    await execute("psql", ["--dbname", databaseUrl(), "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file", restoreSqlPath], { maxBuffer: 20 * 1024 * 1024 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Database restore failed", error)
    return NextResponse.json({ error: "Restore gagal. Database lama tidak diubah karena proses dibatalkan." }, { status: 400 })
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
