/**
 * Preparasi rollout produksi: preflight, backup set, sekuensing, retensi.
 *
 * Seluruh test di sini MURNI. Tidak ada SSH, tidak ada Docker, tidak ada
 * database, tidak ada produksi. Itu justru syaratnya: keputusan "boleh rollout"
 * dan "backup ini lengkap" harus dapat diuji tanpa membahayakan apa pun.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  DISK_SAFETY_FACTOR,
  blockersOf,
  estimateDiskRequirement,
  evaluateRollout,
  isPersistentMount,
  mountCovering,
  parseConfiguredMount,
  rolloutReady,
  type ContainerMount,
  type RolloutCheck,
  type RolloutFacts,
} from "@/lib/rollout-preflight"
import {
  BackupSetError,
  DATABASE_ARCHIVE,
  MEDIA_ARCHIVE,
  assertNoSecrets,
  backupSetId,
  buildManifest,
  isBackupSetId,
  parseBackupSetManifest,
  selectExpiredSets,
  verifyBackupSet,
} from "@/lib/backup-set"
import {
  parseAppliedMigrations,
  parseConfiguredVolumes,
  parseMounts,
  pendingMigrations,
  runRolloutPreflight,
} from "@/lib/rollout-preflight-flow"
import {
  assertRemoteCommandSafe,
  production,
  productionComposeFiles,
  remoteActivateScript,
  remoteBuildScript,
  remoteLegacyMediaBytesScript,
  remoteMigrateDeployScript,
  remotePreflightScript,
  remoteRolloutFactsScript,
} from "@/lib/deployment"
import { backupSetScript } from "@/lib/backup-production-script"
import { readFileSync } from "node:fs"
import { tally } from "@/lib/media-verification"
import { decideMediaRoot } from "@/lib/media-roots"
import type { CommandResult, DeploymentRunner } from "@/lib/deployment-flow"

// ---------------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------------

const persistentVolume: ContainerMount = {
  type: "volume",
  name: "sismepda_media",
  destination: "/app/media",
  source: "/var/lib/docker/volumes/sismepda_media/_data",
  readWrite: true,
}

const GIGABYTE = 1024 ** 3

function facts(overrides: Partial<RolloutFacts> = {}): RolloutFacts {
  return {
    mediaStorageRoot: "/app/media",
    appMounts: [persistentVolume],
    freeDiskBytes: 60 * GIGABYTE,
    legacyMediaBytes: 8 * 1024 * 1024,
    databaseBytes: 90 * 1024 * 1024,
    backupDirWritable: true,
    pendingMigrations: ["20260914160000_add_media_storage_keys"],
    configuredMediaMount: "media:/app/media",
    configuredVolumes: ["media", "database"],
    resolvedMediaVolumeName: "sismepda_media_data",
    ...overrides,
  }
}

function checkFor(list: readonly RolloutCheck[], id: string): RolloutCheck {
  const found = list.find((check) => check.id === id)
  assert.ok(found, `check "${id}" tidak ada`)
  return found
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

describe("preflight rollout — konfigurasi media", () => {
  it("menerima produksi dengan akar media absolut di atas volume persisten", () => {
    const checks = evaluateRollout(facts())
    assert.equal(checkFor(checks, "media-root").status, "ok")
    assert.equal(checkFor(checks, "media-mount").status, "ok")
    assert.equal(rolloutReady(checks), true)
  })

  it("memblokir rollout bila MEDIA_STORAGE_ROOT tidak diset", () => {
    const checks = evaluateRollout(facts({ mediaStorageRoot: null }))
    assert.equal(checkFor(checks, "media-root").status, "blocker")
    assert.equal(rolloutReady(checks), false)
    assert.match(checkFor(checks, "media-root").detail, /writable layer/)
  })

  it("memblokir akar media yang bukan jalur absolut", () => {
    const checks = evaluateRollout(facts({ mediaStorageRoot: ".media" }))
    assert.equal(checkFor(checks, "media-root").status, "blocker")
  })

  it("memblokir bila konfigurasi tidak mendeklarasikan mount media", () => {
    const checks = evaluateRollout(facts({ configuredMediaMount: null }))
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
    assert.match(checkFor(checks, "media-mount").detail, /ephemeral/)
    assert.equal(rolloutReady(checks), false)
  })

  it("memblokir bila mount konfigurasi tidak cocok dengan MEDIA_STORAGE_ROOT", () => {
    const checks = evaluateRollout(
      facts({ configuredMediaMount: "media:/app/uploads" }),
    )
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
    assert.match(checkFor(checks, "media-mount").detail, /tidak cocok/)
  })

  it("memblokir volume yang dipasang tetapi tidak dideklarasikan", () => {
    const checks = evaluateRollout(facts({ configuredVolumes: ["database"] }))
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
  })

  it("memblokir bind mount rapuh sebagai sumber media produksi", () => {
    const checks = evaluateRollout(
      facts({ configuredMediaMount: "/var/lib/sismepda/media:/app/media" }),
    )
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
  })

  it("memblokir mount tmpfs walaupun jalurnya cocok", () => {
    const checks = evaluateRollout(
      facts({ appMounts: [{ ...persistentVolume, type: "tmpfs", name: "" }] }),
    )
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
  })

  it("memblokir mount read-only", () => {
    const checks = evaluateRollout(
      facts({ appMounts: [{ ...persistentVolume, readWrite: false }] }),
    )
    assert.equal(checkFor(checks, "media-mount").status, "blocker")
  })

  it("menerima konfigurasi benar walau container berjalan belum punya volume", () => {
    // Keadaan normal SEBELUM deploy pertama yang membawa volume media.
    const checks = evaluateRollout(facts({ appMounts: [] }))
    assert.equal(checkFor(checks, "media-mount").status, "ok")
    assert.match(checkFor(checks, "media-mount").detail, /setelah deploy/)
  })

  it("memblokir volume media tanpa nama eksplisit", () => {
    const checks = evaluateRollout(facts({ resolvedMediaVolumeName: null }))
    assert.equal(checkFor(checks, "media-volume-identity").status, "blocker")
    assert.match(checkFor(checks, "media-volume-identity").detail, /nama project/)
    assert.equal(rolloutReady(checks), false)
  })

  it("menerima volume media dengan nama Docker eksplisit", () => {
    const checks = evaluateRollout(facts())
    assert.equal(checkFor(checks, "media-volume-identity").status, "ok")
    assert.match(checkFor(checks, "media-volume-identity").detail, /sismepda_media_data/)
  })

  it("menerima bind mount host yang aktif selama konfigurasi memakai named volume", () => {
    const checks = evaluateRollout(
      facts({
        mediaStorageRoot: "/app/media",
        appMounts: [
          {
            type: "bind",
            name: "",
            destination: "/app/media",
            source: "/var/lib/sismepda/media",
            readWrite: true,
          },
        ],
      }),
    )
    assert.equal(checkFor(checks, "media-mount").status, "ok")
  })

  it("memilih mount terdalam ketika beberapa jalur bertumpuk", () => {
    const mounts: ContainerMount[] = [
      { ...persistentVolume, destination: "/app", name: "app-vol" },
      { ...persistentVolume, destination: "/app/media", name: "media-vol" },
    ]
    assert.equal(mountCovering(mounts, "/app/media")?.name, "media-vol")
  })

  it("mengabaikan trailing slash saat mencocokkan mount", () => {
    assert.ok(mountCovering([persistentVolume], "/app/media/"))
  })

  it("tidak menganggap /app/mediafiles tercakup oleh /app/media", () => {
    assert.equal(mountCovering([persistentVolume], "/app/mediafiles"), null)
  })

  it("mengenali volume dan bind sebagai persisten, tmpfs tidak", () => {
    assert.equal(isPersistentMount(persistentVolume), true)
    assert.equal(isPersistentMount({ ...persistentVolume, type: "bind" }), true)
    assert.equal(isPersistentMount({ ...persistentVolume, type: "tmpfs" }), false)
  })
})

describe("overlay compose media produksi", () => {
  const overlay = readFileSync(production.mediaComposeFile, "utf8")

  it("menetapkan MEDIA_STORAGE_ROOT kanonik", () => {
    assert.match(overlay, /MEDIA_STORAGE_ROOT:\s*\/app\/media/)
  })

  it("memasang volume media ke akar yang sama", () => {
    assert.match(overlay, /-\s*media:\/app\/media/)
  })

  it("memberi volume nama Docker eksplisit agar identitasnya stabil", () => {
    assert.match(overlay, /name:\s*sismepda_media_data/)
  })

  it("tidak menyentuh topologi database", () => {
    // Overlay hanya boleh aditif untuk media. Yang dinilai adalah konfigurasi
    // efektifnya, bukan prosa komentar — komentar memang menyebut PostgreSQL
    // untuk menjelaskan apa yang sengaja dibiarkan utuh.
    const effective = overlay
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n")
    assert.doesNotMatch(effective, /postgres|POSTGRES_|db:/i)
  })

  it("tidak memakai bind mount host untuk media", () => {
    assert.doesNotMatch(overlay, /-\s*\/[^\s:]*:\/app\/media/)
  })

  it("dipakai oleh setiap perintah compose produksi", () => {
    // Satu jalur yang lupa overlay = container tanpa volume media.
    assert.equal(productionComposeFiles.includes(production.mediaComposeFile), true)
    assert.equal(productionComposeFiles[0], production.composeFile)
  })
})

describe("urutan kedatangan overlay media", () => {
  it("preflight tidak mewajibkan overlay yang belum di-merge", () => {
    // Preflight berjalan SEBELUM `git merge --ff-only`. Mewajibkan overlay di
    // sini membuat deploy pertama yang justru membawanya mustahil dijalankan.
    const preflight = remotePreflightScript()
    assert.doesNotMatch(preflight, /ABORT: compose\.media\.yaml tidak ada/)
    assert.match(preflight, /MEDIA_OVERLAY=/)
  })

  it("setiap skrip menyusun daftar compose file secara kondisional", () => {
    assert.match(remotePreflightScript(), /COMPOSE_FILES="-f deploy\.yaml"/)
    assert.match(remotePreflightScript(), /if test -f compose\.media\.yaml/)
  })

  it("aktivasi menolak berjalan tanpa overlay media", () => {
    // `up -d` membuat ulang container app; tanpa volume, unggahan sejak deploy
    // terakhir lenyap.
    assert.match(remoteActivateScript(), /ABORT: compose\.media\.yaml tidak ada/)
  })

  it("build dan migrasi juga menolak berjalan tanpa overlay", () => {
    assert.match(remoteBuildScript(), /ABORT: compose\.media\.yaml tidak ada/)
    assert.match(remoteMigrateDeployScript(), /ABORT: compose\.media\.yaml tidak ada/)
  })

})

describe("keamanan volume saat deployment", () => {
  const sources = [
    readFileSync("lib/deployment.ts", "utf8"),
    readFileSync("lib/deployment-flow.ts", "utf8"),
    readFileSync("lib/rollout-preflight-flow.ts", "utf8"),
    readFileSync("scripts/deploy.ts", "utf8"),
  ].join("\n")

  it("tidak pernah menjalankan compose down dengan penghapusan volume", () => {
    assert.doesNotMatch(sources, /down\s+(-v|--volumes)/)
  })

  it("tidak menghapus atau memangkas volume Docker", () => {
    assert.doesNotMatch(sources, /volume\s+(rm|prune)/)
  })

  it("tidak memperbarui anonymous volume saat container dibuat ulang", () => {
    assert.doesNotMatch(sources, /--renew-anon-volumes/)
  })

  it("membuat ulang container app tanpa menyentuh volume", () => {
    const deploy = readFileSync("lib/deployment.ts", "utf8")
    assert.match(deploy, /up\s+-d/)
  })
})

describe("kompatibilitas backup dan isolasi prodclone", () => {
  it("backup produksi membaca akar media dari container, bukan jalur hardcode", () => {
    // Satu sumber kebenaran: overlay menetapkan MEDIA_STORAGE_ROOT, backup
    // membacanya kembali dari container. Jalur yang ditulis ulang di skrip
    // backup akan menjadi sumber kebenaran kedua yang diam-diam menyimpang.
    const script = backupSetScript("backup-2026-09-14T213000Z")
    assert.match(script, /printenv MEDIA_STORAGE_ROOT/)
    assert.doesNotMatch(script, /tar[^\n]*\s\/app\/media/)
  })

  it("backup berhenti bila akar media tidak diset, bukan mengarang default", () => {
    const script = backupSetScript("backup-2026-09-14T213000Z")
    assert.match(script, /ABORT: MEDIA_STORAGE_ROOT tidak diset/)
  })

  it("pengembangan tetap terpisah per peran tanpa menyentuh jalur produksi", () => {
    // Overlay hanya berlaku di produksi. Lingkungan lokal tidak boleh tiba-tiba
    // menulis ke /app/media milik container.
    assert.deepEqual(decideMediaRoot({ SISMEPDA_DB_ROLE: "local" }), {
      path: ".media/local",
      source: "role-default",
      role: "local",
    })
    assert.deepEqual(decideMediaRoot({ SISMEPDA_DB_ROLE: "prodclone" }), {
      path: ".media/prodclone",
      source: "role-default",
      role: "prodclone",
    })
  })

  it("akar media produksi berasal dari konfigurasi eksplisit", () => {
    assert.deepEqual(decideMediaRoot({ MEDIA_STORAGE_ROOT: production.mediaRoot }), {
      path: "/app/media",
      source: "configured",
      role: null,
    })
  })
})

describe("parser mount konfigurasi", () => {
  it("membaca named volume beserta tujuannya", () => {
    assert.deepEqual(parseConfiguredMount("media:/app/media"), {
      volume: "media",
      destination: "/app/media",
      readOnly: false,
    })
  })

  it("menandai mount read-only", () => {
    assert.equal(parseConfiguredMount("media:/app/media:ro")?.readOnly, true)
  })

  it("menolak bind mount host", () => {
    assert.equal(parseConfiguredMount("/var/lib/media:/app/media"), null)
    assert.equal(parseConfiguredMount("./media:/app/media"), null)
  })

  it("menolak bentuk yang tidak dapat dibaca daripada menebaknya", () => {
    assert.equal(parseConfiguredMount(null), null)
    assert.equal(parseConfiguredMount(""), null)
    assert.equal(parseConfiguredMount("media"), null)
    assert.equal(parseConfiguredMount("media:relatif"), null)
  })

  it("membaca nama volume dari keluaran bertanda", () => {
    assert.deepEqual(
      parseConfiguredVolumes("CONFIG_VOLUME=media\nlain\nCONFIG_VOLUME=database\n"),
      ["media", "database"],
    )
  })
})

describe("preflight rollout — disk", () => {
  it("menghitung duplikasi media dua kali: salinan filesystem dan arsip backup", () => {
    const estimate = estimateDiskRequirement({
      legacyMediaBytes: 10 * 1024 * 1024,
      databaseBytes: 100 * 1024 * 1024,
    })
    assert.equal(estimate.mediaDuplicationBytes, 10 * 1024 * 1024)
    assert.equal(estimate.mediaBackupBytes, 10 * 1024 * 1024)
    assert.equal(estimate.databaseBackupBytes, 100 * 1024 * 1024)
    assert.equal(
      estimate.requiredBytes,
      Math.ceil(estimate.subtotalBytes * DISK_SAFETY_FACTOR),
    )
  })

  it("memblokir rollout bila disk bebas di bawah kebutuhan terhitung", () => {
    const checks = evaluateRollout(facts({ freeDiskBytes: 1 * GIGABYTE }))
    assert.equal(checkFor(checks, "disk").status, "blocker")
    assert.equal(rolloutReady(checks), false)
  })

  it("menjelaskan komponen kebutuhan disk, bukan sekadar persentase", () => {
    const checks = evaluateRollout(facts({ freeDiskBytes: 0 }))
    const detail = checkFor(checks, "disk").detail
    assert.match(detail, /dump/)
    assert.match(detail, /duplikasi media/)
    assert.match(detail, /arsip media/)
    assert.match(detail, /build/)
  })
})

describe("preflight rollout — backup dan migrasi", () => {
  it("memblokir bila direktori backup tidak dapat ditulis", () => {
    const checks = evaluateRollout(facts({ backupDirWritable: false }))
    assert.equal(checkFor(checks, "backup-dir").status, "blocker")
  })

  it("melaporkan migrasi yang belum diterapkan tanpa menjadikannya blocker", () => {
    const checks = evaluateRollout(facts({ pendingMigrations: ["a", "b"] }))
    assert.equal(checkFor(checks, "migrations").status, "ok")
    assert.match(checkFor(checks, "migrations").detail, /2: a, b/)
  })

  it("menyatakan byte legacy tetap dipertahankan", () => {
    const checks = evaluateRollout(facts())
    assert.match(checkFor(checks, "legacy-media").detail, /fallback/)
  })

  it("mengumpulkan seluruh blocker sekaligus, bukan berhenti di yang pertama", () => {
    const checks = evaluateRollout(
      facts({ mediaStorageRoot: null, freeDiskBytes: 0, backupDirWritable: false }),
    )
    const ids = blockersOf(checks).map((check) => check.id).sort()
    assert.deepEqual(ids, ["backup-dir", "disk", "media-root"])
  })
})

// ---------------------------------------------------------------------------
// Skrip remote preflight — harus read-only
// ---------------------------------------------------------------------------

describe("skrip preflight remote", () => {
  const scripts = [remoteRolloutFactsScript(), remoteLegacyMediaBytesScript()]

  it("lolos guard perintah terlarang", () => {
    for (const script of scripts) assert.doesNotThrow(() => assertRemoteCommandSafe(script))
  })

  it("tidak memuat perintah yang menulis ke produksi", () => {
    for (const script of scripts) {
      for (const forbidden of [
        /\bmkdir\b/,
        /\btouch\b/,
        /\brm\b/,
        /\bmv\b/,
        /\bcp\b/,
        /\bchmod\b/,
        /\bchown\b/,
        /docker\s+restart/,
        /docker\s+compose[^\n]*\bup\b/,
      ]) {
        assert.doesNotMatch(script, forbidden, `skrip preflight memuat ${forbidden}`)
      }
    }
  })

  it("hanya memakai SELECT pada database", () => {
    const sql = remoteLegacyMediaBytesScript()
    for (const forbidden of [/INSERT/i, /UPDATE/i, /DELETE/i, /DROP/i, /ALTER/i, /TRUNCATE/i]) {
      assert.doesNotMatch(sql, forbidden)
    }
    assert.match(sql, /SELECT/)
  })

  it("memeriksa izin tulis backup dengan test -w, bukan dengan membuat berkas", () => {
    assert.match(remoteRolloutFactsScript(), /test -w/)
  })

  it("tidak pernah mencetak keluaran compose config secara utuh", () => {
    const script = remoteRolloutFactsScript()
    assert.match(script, /compose[^\n]*config[^\n]*\|\s*grep/)
  })
})

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parser fakta produksi", () => {
  it("membaca baris mount docker inspect", () => {
    const mounts = parseMounts(
      [
        "MOUNT=volume|sismepda_media|/app/media|/var/lib/docker/volumes/x/_data|true",
        "MOUNT=bind||/etc/localtime|/etc/localtime|false",
        "noise",
      ].join("\n"),
    )
    assert.equal(mounts.length, 2)
    assert.equal(mounts[0].name, "sismepda_media")
    assert.equal(mounts[0].readWrite, true)
    assert.equal(mounts[1].readWrite, false)
  })

  it("mengabaikan baris mount yang tidak lengkap alih-alih menebaknya", () => {
    assert.deepEqual(parseMounts("MOUNT=volume|x|/app/media"), [])
  })

  it("membaca daftar migrasi dari blok bertanda", () => {
    const output = [
      "FREE_BYTES=100",
      "APPLIED_MIGRATIONS_BEGIN",
      "20260101_a",
      "20260102_b",
      "APPLIED_MIGRATIONS_END",
    ].join("\n")
    assert.deepEqual(parseAppliedMigrations(output), ["20260101_a", "20260102_b"])
  })

  it("mengembalikan daftar kosong bila blok migrasi tidak ada", () => {
    assert.deepEqual(parseAppliedMigrations("FREE_BYTES=1"), [])
  })

  it("menghitung migrasi pending menurut urutan repo", () => {
    assert.deepEqual(pendingMigrations(["a", "b", "c"], ["a"]), ["b", "c"])
    assert.deepEqual(pendingMigrations(["a"], ["a", "b"]), [])
  })
})

// ---------------------------------------------------------------------------
// Orkestrasi preflight dengan runner palsu
// ---------------------------------------------------------------------------

function fakeRunner(responses: Record<string, CommandResult>) {
  const logs: string[] = []
  const sent: string[] = []
  const runner: DeploymentRunner = {
    local: (command, args) =>
      command === "git" && args[0] === "rev-parse"
        ? { ok: true, stdout: "a".repeat(40), stderr: "", code: 0 }
        : { ok: true, stdout: "", stderr: "", code: 0 },
    remote: (script) => {
      sent.push(script)
      const key = script.includes("LEGACY_MEDIA_BYTES") ? "legacy" : "facts"
      return responses[key] ?? { ok: false, stdout: "", stderr: "tidak dikonfigurasi", code: 1 }
    },
    log: (message) => logs.push(message),
    now: () => new Date("2026-09-14T21:30:00Z"),
  }
  return { runner, logs, sent }
}

const healthyFacts: CommandResult = {
  ok: true,
  stdout: [
    "MEDIA_ROOT=/app/media",
    "MOUNT=volume|sismepda_media_data|/app/media|/var/lib/docker/volumes/x/_data|true",
    "CONFIG_MEDIA_MOUNT=media:/app/media",
    "CONFIG_VOLUME=media",
    "CONFIG_VOLUME=database",
    "CONFIG_VOLUME_NAME=sismepda_media_data",
    `FREE_BYTES=${60 * GIGABYTE}`,
    `DB_BYTES=${90 * 1024 * 1024}`,
    "BACKUP_WRITABLE=yes",
    "APPLIED_MIGRATIONS_BEGIN",
    "20260101_a",
    "APPLIED_MIGRATIONS_END",
  ].join("\n"),
  stderr: "",
  code: 0,
}

const legacyBytes: CommandResult = {
  ok: true,
  stdout: "LEGACY_MEDIA_BYTES=8388608",
  stderr: "",
  code: 0,
}

describe("deploy:preflight", () => {
  it("preflight melaporkan ketiadaan overlay dengan langkah yang jelas", () => {
    const { runner, logs } = fakeRunner({
      facts: {
        ok: false,
        stdout: "",
        stderr: 'compose file "/srv/apps/sismepda/compose.media.yaml" is invalid: no such file',
        code: 1,
      },
      legacy: legacyBytes,
    })
    const code = runRolloutPreflight(runner, { repoMigrations: [] })
    assert.equal(code, 1)
    assert.match(logs.join("\n"), /belum ada di produksi/)
    assert.match(logs.join("\n"), /git merge --ff-only/)
    })

  it("melaporkan READY dan keluar 0 ketika produksi siap", () => {
    const { runner, logs } = fakeRunner({ facts: healthyFacts, legacy: legacyBytes })
    const code = runRolloutPreflight(runner, { repoMigrations: ["20260101_a"] })
    assert.equal(code, 0)
    assert.match(logs.join("\n"), /Result \.+ READY/)
  })

  it("melaporkan NOT READY dan keluar non-nol ketika akar media tidak diset", () => {
    const { runner, logs } = fakeRunner({
      facts: { ...healthyFacts, stdout: healthyFacts.stdout.replace("/app/media", "") },
      legacy: legacyBytes,
    })
    const code = runRolloutPreflight(runner, { repoMigrations: [] })
    assert.equal(code, 1)
    assert.match(logs.join("\n"), /NOT READY/)
    assert.match(logs.join("\n"), /BLOCKER MEDIA_STORAGE_ROOT/)
  })

  it("keluar non-nol bila produksi tidak dapat dihubungi", () => {
    const { runner, logs } = fakeRunner({
      facts: { ok: false, stdout: "", stderr: "ssh: connect timeout", code: 255 },
    })
    assert.equal(runRolloutPreflight(runner, { repoMigrations: [] }), 1)
    assert.match(logs.join("\n"), /NOT READY/)
  })

  it("tidak pernah mencetak DATABASE_URL atau password", () => {
    const { runner, logs } = fakeRunner({
      facts: {
        ok: false,
        stdout: "",
        stderr: "error DATABASE_URL=postgresql://user:rahasia@db:5432/sismepda",
        code: 1,
      },
    })
    runRolloutPreflight(runner, { repoMigrations: [] })
    const output = logs.join("\n")
    assert.doesNotMatch(output, /rahasia/)
    assert.match(output, /REDACTED/)
  })

  it("melaporkan migrasi pending berdasarkan selisih repo dan produksi", () => {
    const { runner, logs } = fakeRunner({ facts: healthyFacts, legacy: legacyBytes })
    runRolloutPreflight(runner, { repoMigrations: ["20260101_a", "20260914180000_relax"] })
    assert.match(logs.join("\n"), /20260914180000_relax/)
  })

  it("tidak mengirim satu pun perintah tulis ke produksi", () => {
    const { runner, sent } = fakeRunner({ facts: healthyFacts, legacy: legacyBytes })
    runRolloutPreflight(runner, { repoMigrations: [] })
    assert.ok(sent.length > 0)
    for (const script of sent) {
      assert.doesNotMatch(script, /\bmkdir\b|\btouch\b|\brm\b|docker\s+restart/)
    }
  })
})

// ---------------------------------------------------------------------------
// Backup set
// ---------------------------------------------------------------------------

function component(overrides: Partial<{ file: string; bytes: number; verified: boolean }> = {}) {
  return { file: DATABASE_ARCHIVE, bytes: 1024, verified: true, ...overrides }
}

describe("backup set — identitas bersama", () => {
  it("membentuk set id UTC yang terurut leksikografis", () => {
    const early = backupSetId(new Date("2026-09-14T21:30:00Z"))
    const late = backupSetId(new Date("2026-09-14T22:30:00Z"))
    assert.equal(early, "backup-2026-09-14T213000Z")
    assert.ok(early < late)
    assert.ok(isBackupSetId(early))
  })

  it("menolak set id yang tidak berpola", () => {
    assert.equal(isBackupSetId("backup-kemarin"), false)
    assert.throws(() => buildManifest({
      setId: "sembarang",
      createdAt: new Date(),
      database: component(),
      media: { ...component({ file: MEDIA_ARCHIVE }), fileCount: 1 },
    }), BackupSetError)
  })

  it("mengikat database dan media dengan satu set id", () => {
    const manifest = buildManifest({
      setId: "backup-2026-09-14T213000Z",
      createdAt: new Date("2026-09-14T21:30:00Z"),
      commit: "0d783d6",
      database: component({ bytes: 9_000_000 }),
      media: { ...component({ file: MEDIA_ARCHIVE, bytes: 7_000_000 }), fileCount: 22 },
    })
    assert.equal(manifest.setId, "backup-2026-09-14T213000Z")
    assert.equal(manifest.database.file, DATABASE_ARCHIVE)
    assert.equal(manifest.media.file, MEDIA_ARCHIVE)
    assert.equal(manifest.media.fileCount, 22)
    assert.equal(manifest.complete, true)
  })

  it("menandai set tidak lengkap bila salah satu komponen gagal verifikasi", () => {
    const manifest = buildManifest({
      setId: "backup-2026-09-14T213000Z",
      createdAt: new Date(),
      database: component(),
      media: { ...component({ file: MEDIA_ARCHIVE, verified: false }), fileCount: 3 },
    })
    assert.equal(manifest.complete, false)
    const problems = verifyBackupSet(manifest)
    assert.ok(problems.some((problem) => problem.code === "media-unverified"))
  })

  it("menolak dump database yang lolos sendirian sebagai backup lengkap", () => {
    const manifest = buildManifest({
      setId: "backup-2026-09-14T213000Z",
      createdAt: new Date(),
      database: component({ bytes: 9_000_000 }),
      media: { ...component({ file: MEDIA_ARCHIVE, bytes: 20, verified: false }), fileCount: 0 },
    })
    const codes = verifyBackupSet(manifest).map((problem) => problem.code).sort()
    assert.deepEqual(codes, ["media-empty", "media-unverified"])
  })
})

describe("backup set — manifest", () => {
  it("menolak manifest tanpa komponen media", () => {
    assert.throws(
      () =>
        parseBackupSetManifest({
          version: 1,
          setId: "backup-2026-09-14T213000Z",
          database: component(),
        }),
      BackupSetError,
    )
  })

  it("menolak arsip berukuran nol", () => {
    assert.throws(
      () =>
        parseBackupSetManifest({
          version: 1,
          setId: "backup-2026-09-14T213000Z",
          database: component({ bytes: 0 }),
          media: { ...component({ file: MEDIA_ARCHIVE }), fileCount: 1 },
        }),
      BackupSetError,
    )
  })

  it("menolak versi manifest yang tidak dikenal", () => {
    assert.throws(() => parseBackupSetManifest({ version: 99 }), BackupSetError)
  })

  it("melakukan round-trip manifest yang sah", () => {
    const manifest = buildManifest({
      setId: "backup-2026-09-14T213000Z",
      createdAt: new Date("2026-09-14T21:30:00Z"),
      commit: "abc1234",
      database: component({ bytes: 5 }),
      media: { ...component({ file: MEDIA_ARCHIVE, bytes: 7 }), fileCount: 2 },
    })
    const parsed = parseBackupSetManifest(JSON.parse(JSON.stringify(manifest)))
    assert.deepEqual(parsed, manifest)
  })

  it("menolak manifest yang memuat rahasia", () => {
    assert.throws(() => assertNoSecrets({ databaseUrl: "postgres://x" }), BackupSetError)
    assert.throws(() => assertNoSecrets({ nested: { POSTGRES_PASSWORD: "x" } }), BackupSetError)
    assert.throws(() => assertNoSecrets({ list: [{ authSecret: "x" }] }), BackupSetError)
  })

  it("membiarkan manifest tanpa rahasia lewat", () => {
    assert.doesNotThrow(() =>
      assertNoSecrets({ setId: "backup-2026-09-14T213000Z", bytes: 10, verified: true }),
    )
  })
})

describe("skrip backup produksi", () => {
  const script = backupSetScript("backup-2026-09-14T213000Z")

  it("membackup database SEBELUM media", () => {
    assert.ok(
      script.indexOf("pg_dump") < script.indexOf("tar -czf"),
      "urutan backup harus database dulu agar restore tidak menghasilkan referensi tanpa berkas",
    )
  })

  it("memverifikasi dump dengan pg_restore membaca stdin, bukan argumen '-'", () => {
    assert.match(script, /pg_restore --list < /)
    assert.doesNotMatch(script, /pg_restore --list -\s/)
  })

  it("memverifikasi arsip media dengan menghitung ulang isinya", () => {
    assert.match(script, /tar -tzf/)
    assert.match(script, /ARCHIVE_COUNT/)
  })

  it("gagal bila MEDIA_STORAGE_ROOT tidak diset di container", () => {
    assert.match(script, /MEDIA_STORAGE_ROOT tidak diset/)
  })

  it("tidak menghapus backup lama", () => {
    assert.doesNotMatch(script, /\brm\s+-[rf]/)
  })

  it("lolos guard perintah terlarang", () => {
    assert.doesNotThrow(() => assertRemoteCommandSafe(script))
  })

  it("tidak memuat migrasi media legacy", () => {
    assert.doesNotMatch(script, /migrate-media|media:migrate/)
  })
})

// ---------------------------------------------------------------------------
// Retensi
// ---------------------------------------------------------------------------

describe("retensi backup set", () => {
  const ids = Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0")
    return `backup-2026-06-${day}T020000Z`
  })

  it("tidak pernah memilih set terbaru untuk dihapus", () => {
    const expired = selectExpiredSets(ids)
    assert.ok(!expired.includes(ids[ids.length - 1]))
  })

  it("mempertahankan tujuh set harian terbaru", () => {
    const expired = new Set(selectExpiredSets(ids))
    for (const id of ids.slice(-7)) assert.ok(!expired.has(id), `${id} seharusnya dipertahankan`)
  })

  it("mempertahankan set mingguan yang lebih tua dari tujuh set harian", () => {
    const expired = new Set(selectExpiredSets(ids))
    const kept = ids.filter((id) => !expired.has(id))
    // 7 harian terbaru + hingga 4 mingguan; yang mingguan pasti ada di luar
    // tujuh terbaru, jadi total yang dipertahankan harus melebihi tujuh.
    assert.ok(kept.length > 7, `hanya ${kept.length} set dipertahankan`)
    const older = kept.filter((id) => !ids.slice(-7).includes(id))
    assert.ok(older.length >= 1, "tidak ada set mingguan yang lebih tua dipertahankan")
  })

  it("tidak pernah memilih nama yang tidak dikenali polanya", () => {
    const expired = selectExpiredSets([...ids, "catatan.txt", "backup-manual"])
    assert.ok(!expired.includes("catatan.txt"))
    assert.ok(!expired.includes("backup-manual"))
  })

  it("tidak memilih apa pun bila set masih sedikit", () => {
    assert.deepEqual(selectExpiredSets(ids.slice(0, 3)), [])
  })

  it("tetap mempertahankan set terbaru walau kuota diberi nol", () => {
    const expired = selectExpiredSets(ids, { daily: 0, weekly: 0 })
    assert.ok(!expired.includes(ids[ids.length - 1]))
  })
})

// ---------------------------------------------------------------------------
// Sekuensing deployment
// ---------------------------------------------------------------------------

describe("sekuensing deployment", () => {
  it("tidak menjalankan migrasi media legacy sebagai bagian deploy", async () => {
    const flow = await import("@/lib/deployment-flow")
    const source = (await import("node:fs/promises")).readFile
    const text = await source("lib/deployment-flow.ts", "utf8")
    assert.doesNotMatch(text, /migrate-media|media:migrate/)
    assert.ok(typeof flow.runDeploy === "function")
  })

  it("guard deployment menolak perintah destruktif", () => {
    for (const script of [
      "prisma migrate reset",
      "docker volume rm sismepda_media",
      "docker compose -f deploy.yaml down",
      "TRUNCATE TABLE \"User\"",
    ]) {
      assert.throws(() => assertRemoteCommandSafe(script))
    }
  })

  it("topologi produksi tetap menunjuk deploy.yaml host, bukan compose repo", () => {
    assert.equal(production.composeFile, "deploy.yaml")
    assert.equal(production.sshAlias, "smpn2")
    assert.equal(production.appDir, "/srv/apps/sismepda")
  })
})

// ---------------------------------------------------------------------------
// Verifikasi migrasi media
// ---------------------------------------------------------------------------

describe("verifikasi migrasi media", () => {
  it("menghitung record valid, hilang, dan tidak cocok", () => {
    const result = tally([
      { key: "users/avatar/a.png", hasLegacy: true, fileExists: true, sizeMatches: true },
      { key: "users/avatar/b.png", hasLegacy: true, fileExists: false, sizeMatches: false },
      { key: "users/avatar/c.png", hasLegacy: true, fileExists: true, sizeMatches: false },
      { key: null, hasLegacy: true, fileExists: false, sizeMatches: false },
    ])
    assert.equal(result.total, 4)
    assert.equal(result.migrated, 3)
    assert.equal(result.valid, 1)
    assert.equal(result.missing, 1)
    assert.equal(result.mismatch, 1)
    assert.equal(result.legacyRetained, 4)
    assert.equal(result.orphaned, 0)
  })

  it("menandai record tanpa kunci dan tanpa byte legacy sebagai yatim", () => {
    const result = tally([{ key: null, hasLegacy: false, fileExists: false, sizeMatches: false }])
    assert.equal(result.orphaned, 1)
    assert.equal(result.legacyRetained, 0)
  })

  it("menghitung byte legacy yang masih ada sebagai bukti rollback tersedia", () => {
    const result = tally([
      { key: "a", hasLegacy: true, fileExists: true, sizeMatches: true },
      { key: "b", hasLegacy: false, fileExists: true, sizeMatches: true },
    ])
    assert.equal(result.legacyRetained, 1)
    assert.equal(result.valid, 2)
  })
})
