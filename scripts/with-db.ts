/**
 * Pemilih database untuk perintah npm: `tsx scripts/with-db.ts <peran> -- <cmd>`.
 *
 * Alasan keberadaan file ini:
 * - `next dev` hanya membaca `.env`/`.env.local`, dan Next tidak menyediakan
 *   cara memilih file environment lain lewat argumen. Tanpa pembungkus,
 *   berganti database berarti mengedit `.env` setiap kali — persis yang harus
 *   dihindari.
 * - `--env-file` milik Node tidak dipakai karena kita perlu MEMVALIDASI isi
 *   file sebelum proses anak dijalankan, bukan sesudahnya.
 *
 * Kontrak: file environment adalah satu-satunya tempat kredensial berada.
 * Skrip ini membaca DATABASE_URL dari file peran, memverifikasinya lewat guard
 * murni di `lib/database-target.ts`, lalu meneruskannya ke proses anak melalui
 * environment — tidak pernah lewat argumen baris perintah (argumen terlihat di
 * daftar proses) dan tidak pernah dicetak.
 */

import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  databaseTargets,
  describeTarget,
  isDatabaseRole,
  parseEnvFile,
  planDatabaseTarget,
} from "@/lib/database-target"

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const [roleArg, ...rest] = process.argv.slice(2)
const separatorIndex = rest.indexOf("--")
const command = separatorIndex === -1 ? rest : rest.slice(separatorIndex + 1)

if (!roleArg || !isDatabaseRole(roleArg)) {
  fail(
    `Pemakaian: tsx scripts/with-db.ts <local|prodclone> -- <perintah...>\n` +
      `Peran "${roleArg ?? ""}" tidak dikenal.`,
  )
}
if (command.length === 0) fail("Tidak ada perintah yang diberikan setelah `--`.")

const spec = databaseTargets[roleArg]
const envPath = resolve(process.cwd(), spec.envFile)

if (!existsSync(envPath)) {
  fail(
    `ABORT: ${spec.envFile} tidak ditemukan.\n` +
      `Peran "${spec.role}" (${spec.label}) membutuhkan file itu.\n` +
      (spec.role === "prodclone"
        ? `Jalankan \`npm run db:refresh-prodclone\` untuk membuat clone beserta file environment-nya.`
        : `Salin .env.example menjadi .env lalu isi DATABASE_URL.`),
  )
}

/**
 * File peran hanya menyediakan DATABASE_URL. Sisa variabel (AUTH_SECRET,
 * kredensial akun uji, dan seterusnya) tetap diwarisi dari `.env` yang dibaca
 * Next sendiri, sehingga tidak ada kredensial yang diduplikasi antar file.
 */
const fileEnv = parseEnvFile(readFileSync(envPath, "utf8"))
const decision = planDatabaseTarget(spec, fileEnv.DATABASE_URL)

if (!decision.ok) {
  fail(`ABORT: ${spec.envFile} tidak sah untuk peran "${spec.role}".\n${decision.reason}`)
}

console.log(`[db:${spec.role}] ${spec.label} → ${describeTarget(decision.parsed)}`)

/**
 * `EXPECTED_DEV_DATABASE_NAME` juga diikutkan agar guard E-UKS yang sudah ada
 * ikut mengunci database yang sama tanpa operator perlu menyunting .env: tanpa
 * ini, menjalankan generator di bawah peran prodclone akan gagal dengan pesan
 * yang membingungkan alih-alih pesan peran yang tepat.
 */
/**
 * `shell: true` sengaja dihindari: di Windows ia menggabungkan argumen menjadi
 * satu string perintah (celah injeksi, dan Node memperingatkannya lewat
 * DEP0190). Sebagai gantinya biner `.cmd` milik npm dipanggil langsung lewat
 * `cmd.exe /c`, persis pola yang dipakai `scripts/dev-bootstrap.ts`.
 */
const [executable, ...executableArgs] =
  process.platform === "win32" ? ["cmd.exe", "/c", ...command] : command

const child = spawn(executable, executableArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: fileEnv.DATABASE_URL,
    EXPECTED_DEV_DATABASE_NAME: spec.expectedDatabase,
    SISMEPDA_DB_ROLE: spec.role,
  },
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
child.on("error", (error) => fail(`Gagal menjalankan perintah: ${error.message}`))
