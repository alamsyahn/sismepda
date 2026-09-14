/**
 * Entrypoint deployment produksi SISMEPDA.
 *
 *     npm run deploy:check     # read-only, tidak menyentuh produksi
 *     npm run deploy:prod      # satu perintah: UI, backend, dan/atau migrasi
 *     npm run deploy:prod -- --dry-run
 *     npm run deploy:status    # read-only, cepat
 *
 * Berkas ini hanya menyediakan eksekusi proses nyata; seluruh keputusan ada di
 * `lib/deployment.ts` (murni) dan `lib/deployment-flow.ts` (orkestrasi).
 *
 * Windows: `npm` adalah `.cmd`, bukan executable, sehingga dipanggil lewat
 * `cmd.exe /c` dengan argumen terpisah — bukan `shell: true`, yang akan
 * menggabungkan argumen menjadi satu string dan membuka celah injeksi. Pola ini
 * sama dengan `scripts/with-db.ts` dan `scripts/refresh-prodclone.ts`.
 */

import { spawnSync } from "node:child_process"

import { production, redactSecrets } from "@/lib/deployment"
import {
  DeployAbort,
  runCheck,
  runDeploy,
  runStatus,
  type CommandResult,
  type DeploymentRunner,
} from "@/lib/deployment-flow"

const args = process.argv.slice(2)
const mode = args[0]
const dryRun = args.includes("--dry-run")
const skipValidation = args.includes("--skip-validation")

function exec(
  command: string,
  commandArgs: readonly string[],
  options: { input?: string; streamed?: boolean } = {},
): CommandResult {
  const needsCmdShim = process.platform === "win32" && /^(npm|npx)$/.test(command)
  const spawnCommand = needsCmdShim ? "cmd.exe" : command
  const spawnArgs = needsCmdShim ? ["/c", command, ...commandArgs] : [...commandArgs]

  const result = spawnSync(spawnCommand, spawnArgs, {
    // `streamed` menampilkan progres build/migrasi yang panjang secara langsung;
    // keluarannya tetap ditangkap agar dapat dianalisis dan disaring.
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) {
    return { ok: false, stdout: "", stderr: String(result.error.message), code: null }
  }
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  if (options.streamed) {
    const combined = redactSecrets(`${stdout}${stderr}`).trimEnd()
    if (combined) console.log(combined.split("\n").map((line) => `    ${line}`).join("\n"))
  }
  return { ok: result.status === 0, stdout, stderr, code: result.status }
}

const runner: DeploymentRunner = {
  local: (command, commandArgs) => exec(command, commandArgs),
  /**
   * Skrip dikirim lewat stdin `bash -s`, bukan sebagai argumen. Dengan begitu
   * tidak ada skrip panjang yang muncul di daftar proses server, dan tidak ada
   * lapisan quoting tambahan yang bisa salah.
   */
  remote: (script, options = {}) =>
    exec("ssh", ["-o", "BatchMode=yes", production.sshAlias, "bash -s"], {
      input: script,
      streamed: options.streamed,
    }),
  log: (message) => console.log(message),
  now: () => new Date(),
}

function main(): number {
  switch (mode) {
    case "deploy":
      return runDeploy(runner, { dryRun, skipValidation })
    case "check":
      return runCheck(runner, { skipValidation })
    case "status":
      return runStatus(runner)
    default:
      console.error(
        "Pemakaian: tsx scripts/deploy.ts <deploy|check|status> [--dry-run] [--skip-validation]",
      )
      return 64
  }
}

try {
  process.exit(main())
} catch (error) {
  if (error instanceof DeployAbort) {
    console.error(`\nDEPLOY ABORTED\n${error.message}`)
    if (error.detail) console.error(`\n${error.detail}`)
    process.exit(error.exitCode)
  }
  console.error(`\nDEPLOY ABORTED\n${redactSecrets(String(error))}`)
  process.exit(1)
}
