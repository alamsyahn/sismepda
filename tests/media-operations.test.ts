/**
 * Test untuk operasi media yang berbahaya: sinkronisasi prodclone, backup,
 * verifikasi, restore, dan pelaporan wrapper.
 *
 * Prinsip: TIDAK ADA jaringan dan TIDAK ADA produksi di sini. Pembangunan &
 * validasi perintah diuji sebagai fungsi murni; backup diuji terhadap direktori
 * sementara. Sinkronisasi produksi yang sebenarnya adalah operasi manual dengan
 * persetujuan eksplisit, bukan efek samping dari `npm test`.
 */

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  archiveNameFor,
  assertArchiveOutsideSource,
  assertSafeArchiveEntry,
  backupRunId,
  isSafeArchiveEntry,
  MEDIA_ARCHIVE_PREFIX,
  MEDIA_MANIFEST_ENTRY,
  MediaBackupError,
  parseManifest,
} from "@/lib/media-backup"
import {
  describeMediaSync,
  MediaSyncError,
  planMediaSync,
  productionMediaDir,
  remoteMediaInventoryCommand,
  rsyncArgsFor,
  toRsyncPath,
} from "@/lib/media-sync"
import { decideMediaRoot, mediaRootForRole } from "@/lib/media-roots"
import { evaluateProdcloneRefresh } from "@/lib/prodclone-refresh"

const PROJECT = process.cwd()
const PRODCLONE_LOCAL = path.resolve(PROJECT, mediaRootForRole("prodclone"))

function plan(overrides: Partial<Parameters<typeof planMediaSync>[0]> = {}) {
  return planMediaSync({
    role: "prodclone",
    dryRun: false,
    cwd: PROJECT,
    resolve: (relative) => path.resolve(PROJECT, relative),
    ...overrides,
  })
}

// ── Akar media per lingkungan ────────────────────────────────────────────────

test("media root: local dan prodclone tidak pernah berbagi direktori", () => {
  assert.notEqual(mediaRootForRole("local"), mediaRootForRole("prodclone"))
})

test("media root: MEDIA_STORAGE_ROOT eksplisit mengalahkan peran", () => {
  const decision = decideMediaRoot({ MEDIA_STORAGE_ROOT: "/srv/media", SISMEPDA_DB_ROLE: "prodclone" })
  assert.equal(decision.path, "/srv/media")
  assert.equal(decision.source, "configured")
})

test("media root: peran prodclone terisolasi bila tidak dikonfigurasi", () => {
  assert.equal(decideMediaRoot({ SISMEPDA_DB_ROLE: "prodclone" }).path, ".media/prodclone")
  assert.equal(decideMediaRoot({ MEDIA_STORAGE_ROOT: "  ", SISMEPDA_DB_ROLE: "local" }).path, ".media/local")
})

test("media root: tanpa peran tidak menabrak direktori peran mana pun", () => {
  const fallback = decideMediaRoot({}).path
  assert.notEqual(fallback, mediaRootForRole("local"))
  assert.notEqual(fallback, mediaRootForRole("prodclone"))
})

// ── Sinkronisasi media: arah dan keamanan ────────────────────────────────────

test("sync: sumber selalu produksi dan tujuan selalu lokal", () => {
  const result = plan()
  assert.equal(result.remotePath, productionMediaDir)
  assert.equal(result.localPath, PRODCLONE_LOCAL)
  assert.ok(path.isAbsolute(result.localPath))
})

test("sync: rsync menarik dari remote ke lokal, bukan sebaliknya", () => {
  const args = rsyncArgsFor(plan())
  const source = args[args.length - 2]
  const destination = args[args.length - 1]

  assert.ok(source.includes(":"), "sumber harus berupa lokasi remote")
  assert.ok(source.startsWith(`${plan().remoteAlias}:`))
  // Tujuan tidak boleh terlihat seperti lokasi remote bagi rsync (host:path).
  assert.ok(!/^[^/]+:/.test(destination), "tujuan tidak boleh remote")
  assert.equal(destination, `${toRsyncPath(PRODCLONE_LOCAL)}/`)
})

test("sync: jalur lokal Windows tidak dapat disalahartikan sebagai host remote", () => {
  assert.equal(toRsyncPath("D:/sismepda/.media/prodclone"), "/d/sismepda/.media/prodclone")
  assert.equal(toRsyncPath("/srv/apps/sismepda/media"), "/srv/apps/sismepda/media")
})

test("sync: arah terbalik tidak dapat dibentuk", () => {
  // Tidak ada parameter untuk membalik arah; argumen rsync selalu remote→lokal.
  const args = rsyncArgsFor(plan())
  const remoteOccurrences = args.filter((argument) => argument.includes(`${plan().remoteAlias}:`))
  assert.equal(remoteOccurrences.length, 1, "remote hanya boleh muncul sebagai sumber")
  assert.equal(args.indexOf(remoteOccurrences[0]), args.length - 2)
})

test("sync: delete dan mutasi remote tidak pernah diaktifkan", () => {
  for (const dryRun of [false, true]) {
    const args = rsyncArgsFor(plan({ dryRun })).join(" ")
    for (const forbidden of [
      "--delete",
      "--delete-after",
      "--delete-before",
      "--delete-during",
      "--delete-excluded",
      "--remove-source-files",
      "--rsync-path",
      "sudo",
      "--chmod",
      "--chown",
    ]) {
      assert.ok(!args.includes(forbidden), `argumen terlarang muncul: ${forbidden}`)
    }
  }
})

test("sync: deleteEnabled selalu false", () => {
  assert.equal(plan().deleteEnabled, false)
})

test("sync: dry-run meminta rsync tidak menulis", () => {
  const args = rsyncArgsFor(plan({ dryRun: true }))
  assert.ok(args.includes("--dry-run"))
  assert.ok(args.includes("--stats"))
})

test("sync: peran selain prodclone ditolak", () => {
  assert.throws(() => plan({ role: "local" }), MediaSyncError)
})

test("sync: tujuan tidak aman ditolak", () => {
  const unsafe = ["/", "C:", PROJECT, "/home/operator", path.join(PROJECT, "app")]
  for (const destination of unsafe) {
    assert.throws(
      () => plan({ resolve: () => destination }),
      MediaSyncError,
      `tujuan seharusnya ditolak: ${destination}`,
    )
  }
})

test("sync: perintah inventaris remote murni baca", () => {
  const command = remoteMediaInventoryCommand()
  for (const forbidden of ["rm ", "mkdir", "chmod", "chown", "sudo", "mv ", "cp ", ">"]) {
    assert.ok(!command.includes(forbidden), `perintah remote memuat mutasi: ${forbidden}`)
  }
  assert.ok(command.includes("find"))
})

test("sync: ringkasan menampilkan target tanpa membocorkan rahasia", () => {
  const text = describeMediaSync(plan())
  assert.ok(text.includes(productionMediaDir))
  assert.ok(text.includes("Delete : disabled"))
  assert.ok(!/password|secret|token/i.test(text))
})

// ── Wrapper prodclone ────────────────────────────────────────────────────────

test("wrapper: database gagal → media dilewati, bukan sukses", () => {
  const outcome = evaluateProdcloneRefresh({ database: "failed", media: "skipped" })
  assert.equal(outcome.media, "skipped")
  assert.equal(outcome.complete, false)
  assert.notEqual(outcome.exitCode, 0)
})

test("wrapper: database sukses + media gagal → kegagalan sebagian yang jelas", () => {
  const outcome = evaluateProdcloneRefresh({ database: "success", media: "failed" })
  assert.equal(outcome.database, "success")
  assert.equal(outcome.complete, false)
  assert.notEqual(outcome.exitCode, 0)
  assert.match(outcome.summary, /SEBAGIAN/)
  assert.match(outcome.summary, /tidak di-rollback/)
})

test("wrapper: keduanya sukses → lengkap", () => {
  const outcome = evaluateProdcloneRefresh({ database: "success", media: "success" })
  assert.equal(outcome.complete, true)
  assert.equal(outcome.exitCode, 0)
})

// ── Keamanan entri arsip ─────────────────────────────────────────────────────

test("backup: entri arsip dengan traversal ditolak", () => {
  const unsafe = [
    "../escape.jpg",
    `${MEDIA_ARCHIVE_PREFIX}/../../escape.jpg`,
    "/etc/passwd",
    "C:/Windows/system32/x.dll",
    `${MEDIA_ARCHIVE_PREFIX}\\users\\x.jpg`,
    "random.txt",
    "",
  ]
  for (const entry of unsafe) {
    assert.equal(isSafeArchiveEntry(entry), false, `seharusnya ditolak: ${entry}`)
    assert.throws(() => assertSafeArchiveEntry(entry), MediaBackupError)
  }
})

test("backup: entri arsip yang sah diterima", () => {
  assert.ok(isSafeArchiveEntry(MEDIA_MANIFEST_ENTRY))
  assert.ok(isSafeArchiveEntry(`${MEDIA_ARCHIVE_PREFIX}/users/avatar/abc.jpg`))
})

test("backup: nama arsip menolak run ID yang dibuat-buat", () => {
  assert.equal(archiveNameFor("2026-01-02_03-04-05"), "media_2026-01-02_03-04-05.tar.gz")
  for (const bad of ["../etc", "2026-01-02", "", "x"]) {
    assert.throws(() => archiveNameFor(bad), MediaBackupError)
  }
})

test("backup: run ID berbentuk waktu UTC yang dapat diurutkan", () => {
  assert.equal(backupRunId(new Date("2026-03-04T05:06:07Z")), "2026-03-04_05-06-07")
})

test("backup: arsip di dalam direktori sumber ditolak", () => {
  assert.throws(
    () => assertArchiveOutsideSource("/srv/media/backup.tar.gz", "/srv/media"),
    MediaBackupError,
  )
  assert.doesNotThrow(() => assertArchiveOutsideSource("/srv/backups/x.tar.gz", "/srv/media"))
})

// ── Manifest ─────────────────────────────────────────────────────────────────

function manifestFixture() {
  return {
    version: 1,
    createdAt: "2026-03-04T05:06:07.000Z",
    runId: "2026-03-04_05-06-07",
    sourceId: "media-abcdef123456",
    fileCount: 1,
    totalBytes: 3,
    files: [{ key: "users/avatar/a.jpg", size: 3, sha256: "a".repeat(64) }],
  }
}

test("manifest: fixture yang sah diterima", () => {
  assert.equal(parseManifest(manifestFixture()).fileCount, 1)
})

test("manifest: jumlah atau ukuran yang tidak konsisten ditolak", () => {
  const wrongCount = { ...manifestFixture(), fileCount: 5 }
  assert.throws(() => parseManifest(wrongCount), MediaBackupError)

  const wrongBytes = { ...manifestFixture(), totalBytes: 999 }
  assert.throws(() => parseManifest(wrongBytes), MediaBackupError)
})

test("manifest: checksum tidak sah ditolak", () => {
  const bad = manifestFixture()
  bad.files[0].sha256 = "bukan-hash"
  assert.throws(() => parseManifest(bad), MediaBackupError)
})

test("manifest: kunci dengan traversal ditolak", () => {
  const bad = manifestFixture()
  bad.files[0].key = "../../escape.jpg"
  assert.throws(() => parseManifest(bad), MediaBackupError)
})

// ── Backup end-to-end terhadap filesystem sementara ──────────────────────────

const hasTar = spawnSync("tar", ["--version"], { encoding: "utf8" }).status === 0

/**
 * Sumber `media-backup.ts` tanpa komentar, mulai dari definisi runTar.
 *
 * Komentar dibuang karena memang menyebut nama opsi non-portable dan nama
 * fungsi untuk menjelaskan alasannya; yang diperiksa adalah kode nyata.
 */
async function tarInvocationSource(): Promise<string> {
  const source = await readFile(path.join(PROJECT, "scripts", "media-backup.ts"), "utf8")
  return source
    .slice(source.indexOf("function runTar"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

test("backup: invocation tar tidak memakai opsi khusus GNU", async () => {
  // BUG YANG DICEGAH: implementasi memakai `--force-local`, `--transform`, dan
  // `--files-from`. Ketiganya opsi GNU tar; bsdtar bawaan Windows 11 menolaknya
  // dengan "Option --force-local is not supported" dan seluruh jalur backup
  // gagal di mesin pengembangan.
  //
  // Dicek pada sumber, bukan hanya lewat hasil run: mesin CI/dev yang kebetulan
  // memakai GNU tar akan tetap hijau walau implementasinya tidak portable,
  // sehingga regresi ini lolos tanpa assertion eksplisit.
  const invocation = await tarInvocationSource()

  // Komentar boleh menyebut nama opsi (menjelaskan kenapa dihindari); yang
  // dilarang adalah opsi yang benar-benar dikirim sebagai argumen tar.
  const tarArguments = [...invocation.matchAll(/runTar\(\s*\[([^\]]*)\]/g)]
    .map((match) => match[1])
    .concat([...invocation.matchAll(/spawnSync\(\s*"tar"\s*,\s*([^)]*)\)/g)].map((m) => m[1]))
    .join("\n")

  for (const option of ["--force-local", "--transform", "--files-from", "--no-recursion", "--hard-dereference"]) {
    assert.ok(
      !tarArguments.includes(option),
      `opsi tar non-portable dipakai kembali: ${option}`,
    )
  }

  // Arsip tidak boleh diserahkan ke tar sebagai jalur absolut: `D:\...` dibaca
  // sebagian implementasi sebagai arsip remote "host D". Selalu basename + cwd.
  for (const call of invocation.matchAll(/runTar\(\[([^\]]*)\]/g)) {
    assert.match(
      call[1],
      /path\.basename\(|archiveName/,
      `arsip harus diberikan sebagai basename, bukan jalur absolut: runTar([${call[1]}])`,
    )
  }

  // Setiap pemanggilan wajib menyertakan cwd eksplisit, karena basename tanpa
  // cwd akan menulis atau mencari arsip di direktori kerja yang salah.
  const callSites = [...invocation.matchAll(/runTar\(\s*\[([\s\S]*?)\]\s*,\s*([A-Za-z]\w*)/g)]
  const callCount = [...invocation.matchAll(/\brunTar\(/g)].length - 1 // minus definisi
  assert.equal(
    callSites.length,
    callCount,
    "setiap runTar harus dipanggil dengan cwd eksplisit",
  )
  assert.ok(callCount >= 3, "create, verify, dan restore semuanya harus memakai runTar")

  // Argumen tetap berupa array tanpa shell: nama berkas tidak boleh melewati
  // parser shell (quoting + command injection).
  assert.match(invocation, /shell:\s*false/)
})

test("backup: hanya memakai flag tar yang dipahami GNU tar maupun bsdtar", async () => {
  const invocation = await tarInvocationSource()

  // Irisan yang disepakati kedua implementasi. Flag panjang apa pun di luar ini
  // berisiko hanya berjalan di satu platform.
  const portable = new Set(["-czf", "-tzf", "-xzf", "-C"])
  for (const call of invocation.matchAll(/runTar\(\[([^\]]*)\]/g)) {
    for (const literal of call[1].matchAll(/"(-{1,2}[^"]*)"/g)) {
      assert.ok(portable.has(literal[1]), `flag tar tidak portable: ${literal[1]}`)
    }
  }
})

test("backup: buat → verifikasi → restore terhadap media nyata", { skip: !hasTar }, async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "sismepda-backup-test-"))
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const source = path.join(workspace, "media")
  const backups = path.join(workspace, "backups")
  await mkdir(path.join(source, "users", "avatar"), { recursive: true })
  await mkdir(path.join(source, "euks", "facility"), { recursive: true })

  const payloads = new Map<string, Buffer>([
    ["users/avatar/a.jpg", Buffer.from("avatar-bytes-a")],
    ["euks/facility/b.png", Buffer.from("facility-bytes-b-longer")],
  ])
  for (const [key, bytes] of payloads) {
    await writeFile(path.join(source, ...key.split("/")), bytes)
  }

  const env = {
    ...process.env,
    MEDIA_STORAGE_ROOT: source,
    MEDIA_BACKUP_DIR: backups,
  }
  const run = (args: string[]) =>
    spawnSync("npx", ["tsx", path.join(PROJECT, "scripts", "media-backup.ts"), ...args], {
      cwd: PROJECT,
      encoding: "utf8",
      env,
      shell: true,
    })

  const created = run(["create"])
  assert.equal(created.status, 0, created.stderr)

  const archives = (await readdir(backups)).filter((name) => name.endsWith(".tar.gz"))
  assert.equal(archives.length, 1)
  const archive = path.join(backups, archives[0])

  // Sumber tidak boleh berubah sedikit pun oleh proses backup.
  const sourceFilesAfter = await readdir(path.join(source, "users", "avatar"))
  assert.deepEqual(sourceFilesAfter, ["a.jpg"])
  for (const [key, bytes] of payloads) {
    const current = await readFile(path.join(source, ...key.split("/")))
    assert.deepEqual(current, bytes, `backup mengubah berkas sumber: ${key}`)
  }

  const verified = run(["verify", archive])
  assert.equal(verified.status, 0, verified.stderr)
  assert.match(verified.stdout, /2\/2 berkas/)

  const restored = run(["restore-test", archive])
  assert.equal(restored.status, 0, restored.stderr)
  assert.match(restored.stdout, /Restore uji selesai: 2 berkas/)

  // Arsip harus memuat setiap berkas dengan checksum yang benar.
  // Arsip dibaca dengan pola portable yang sama seperti implementasi: basename
  // + cwd, tanpa opsi khusus GNU. Test ini akan gagal pada bsdtar bila
  // implementasi kembali memakai jalur absolut atau flag non-portable.
  const listing = spawnSync("tar", ["-tzf", path.basename(archive)], {
    cwd: path.dirname(archive),
    encoding: "utf8",
  }).stdout
  for (const key of payloads.keys()) {
    assert.ok(listing.includes(`${MEDIA_ARCHIVE_PREFIX}/${key}`), `hilang dari arsip: ${key}`)
  }

  const extracted = path.join(workspace, "extracted")
  await mkdir(extracted, { recursive: true })
  spawnSync("tar", ["-xzf", path.basename(archive), "-C", extracted], {
    cwd: path.dirname(archive),
    encoding: "utf8",
  })
  for (const [key, bytes] of payloads) {
    const restoredBytes = await readFile(path.join(extracted, MEDIA_ARCHIVE_PREFIX, ...key.split("/")))
    assert.equal(
      createHash("sha256").update(restoredBytes).digest("hex"),
      createHash("sha256").update(bytes).digest("hex"),
      `checksum berbeda setelah restore: ${key}`,
    )
  }

  const manifest = parseManifest(
    JSON.parse(await readFile(path.join(extracted, MEDIA_MANIFEST_ENTRY), "utf8")),
  )
  assert.equal(manifest.fileCount, 2)
  assert.equal(manifest.totalBytes, [...payloads.values()].reduce((sum, b) => sum + b.length, 0))
  // Metadata tidak boleh memuat jalur absolut sumber.
  assert.ok(!manifest.sourceId.includes(path.sep))
  assert.ok(!JSON.stringify(manifest).includes(workspace))
})

test("backup: arsip rusak ditolak, bukan dilaporkan sehat", { skip: !hasTar }, async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "sismepda-corrupt-test-"))
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const archive = path.join(workspace, `media_2026-01-01_00-00-00.tar.gz`)
  await writeFile(archive, Buffer.from(`bukan arsip gzip ${randomUUID()}`))

  const result = spawnSync(
    "npx",
    ["tsx", path.join(PROJECT, "scripts", "media-backup.ts"), "verify", archive],
    { cwd: PROJECT, encoding: "utf8", shell: true },
  )
  assert.notEqual(result.status, 0, "arsip rusak seharusnya gagal diverifikasi")
})

test("backup: arsip tanpa manifest ditolak", { skip: !hasTar }, async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "sismepda-nomanifest-"))
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const tree = path.join(workspace, "tree", MEDIA_ARCHIVE_PREFIX)
  await mkdir(tree, { recursive: true })
  await writeFile(path.join(tree, "x.jpg"), Buffer.from("x"))

  const archive = path.join(workspace, "media_2026-01-01_00-00-00.tar.gz")
  spawnSync("tar", ["-czf", path.basename(archive), "-C", path.join(workspace, "tree"), MEDIA_ARCHIVE_PREFIX], {
    cwd: path.dirname(archive),
    encoding: "utf8",
  })

  const result = spawnSync(
    "npx",
    ["tsx", path.join(PROJECT, "scripts", "media-backup.ts"), "verify", archive],
    { cwd: PROJECT, encoding: "utf8", shell: true },
  )
  assert.notEqual(result.status, 0, "arsip tanpa manifest seharusnya gagal")
})

// ── Perintah prodclone ───────────────────────────────────────────────────────

test("package.json: perintah prodclone kanonik tersedia", async () => {
  const pkg = JSON.parse(await readFile(path.join(PROJECT, "package.json"), "utf8"))
  const scripts = pkg.scripts as Record<string, string>

  for (const name of [
    "dev:local",
    "dev:prodclone",
    "db:prodclone:refresh",
    "media:prodclone:sync",
    "prodclone:refresh",
    "media:backup:create",
    "media:backup:verify",
  ]) {
    assert.ok(scripts[name], `perintah kanonik hilang: ${name}`)
  }

  // Alias lama dihapus: satu fungsi, satu nama. Kontrak penuh permukaan CLI
  // ada di tests/cli-surface.test.ts.
  assert.equal(scripts["db:refresh-prodclone"], undefined)
})

test("package.json: tidak ada perintah yang menjalankan migrasi media otomatis", async () => {
  const pkg = JSON.parse(await readFile(path.join(PROJECT, "package.json"), "utf8"))
  const scripts = pkg.scripts as Record<string, string>

  assert.ok(!scripts["prodclone:refresh"].includes("migrate-media"))
  assert.ok(!scripts["db:prodclone:refresh"].includes("migrate-media"))
  // Wrapper prodclone hanya boleh mengurus database + media sync.
  assert.ok(!scripts["prodclone:refresh"].includes("deploy"))
})

test("db:prodclone:refresh tidak mengurus media", async () => {
  const source = await readFile(path.join(PROJECT, "scripts", "refresh-prodclone.ts"), "utf8")
  assert.ok(!source.includes("rsync"), "refresh database tidak boleh menyentuh media")
  assert.ok(!source.includes("mediaStorage"))
})

test("backup: direktori arsip default berada di luar pohon media", async () => {
  const gitignore = await readFile(path.join(PROJECT, ".gitignore"), "utf8")
  assert.ok(gitignore.includes(".media-backups"), "arsip backup harus di-gitignore")
  assert.doesNotThrow(() =>
    assertArchiveOutsideSource(
      path.resolve(PROJECT, ".media-backups/media_2026-01-01_00-00-00.tar.gz"),
      path.resolve(PROJECT, ".media/local"),
    ),
  )
})
