/**
 * Kontrak dokumentasi CLI halaman Development.
 *
 * Tujuannya satu: membuat dokumentasi mustahil basi diam-diam. `package.json`
 * adalah sumber kebenaran atas perintah yang ada, jadi setiap penambahan,
 * penghapusan, atau penggantian nama script harus memaksa metadata halaman ikut
 * diperbarui — bukan menghasilkan baris tanpa keterangan atau entri hantu.
 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

import {
  CLI_CATEGORIES,
  CLI_METADATA,
  developmentCliCommands,
  npmScriptNames,
} from "@/lib/development-cli"

const PROJECT = process.cwd()

async function packageScripts(): Promise<Record<string, string>> {
  const raw = await readFile(path.join(PROJECT, "package.json"), "utf8")
  return JSON.parse(raw).scripts as Record<string, string>
}

test("setiap script package.json terdokumentasi", async () => {
  const scripts = Object.keys(await packageScripts())
  const undocumented = scripts.filter((name) => !CLI_METADATA[name])
  assert.deepEqual(
    undocumented,
    [],
    `script tanpa metadata halaman Development: ${undocumented.join(", ")}`,
  )
})

test("tidak ada metadata zombie untuk script yang sudah tidak ada", async () => {
  const scripts = new Set(Object.keys(await packageScripts()))
  const zombies = Object.keys(CLI_METADATA).filter((name) => !scripts.has(name))
  assert.deepEqual(zombies, [], `metadata menyebut script yang tidak ada: ${zombies.join(", ")}`)
})

test("kategori dan kegunaan tidak boleh kosong", () => {
  for (const [name, meta] of Object.entries(CLI_METADATA)) {
    assert.ok(meta.category.trim().length > 0, `${name}: kategori kosong`)
    assert.ok(meta.description.trim().length > 0, `${name}: kegunaan kosong`)
    assert.ok(
      (CLI_CATEGORIES as readonly string[]).includes(meta.category),
      `${name}: kategori "${meta.category}" di luar daftar kategori`,
    )
  }
})

test("daftar perintah dibaca dari package.json, bukan disalin ulang", async () => {
  const scripts = Object.keys(await packageScripts())
  assert.deepEqual(npmScriptNames(), scripts)

  const commands = developmentCliCommands()
  assert.equal(commands.length, scripts.length)
  // Urutan package.json dipertahankan supaya dekat dengan hasil `npm run`.
  assert.deepEqual(
    commands.map((entry) => entry.name),
    scripts,
  )
})

test("perintah dirender lengkap sebagai `npm run <script>`", () => {
  for (const entry of developmentCliCommands()) {
    assert.equal(entry.command, `npm run ${entry.name}`)
  }
})

test("penomoran berurutan mulai dari 1", () => {
  const commands = developmentCliCommands()
  assert.deepEqual(
    commands.map((entry) => entry.no),
    commands.map((_, index) => index + 1),
  )
})

test("perintah kanonik utama benar-benar terdokumentasi", () => {
  const byName = new Map(developmentCliCommands().map((entry) => [entry.name, entry]))
  const expected: Record<string, string> = {
    "dev:local": "Development",
    "dev:prodclone": "Development",
    "db:migrate:local": "Database Lokal",
    "db:prodclone:refresh": "Database Prodclone",
    "prodclone:refresh": "Prodclone",
    "euks:seed:local": "Data Uji E-UKS",
    "media:migrate:production": "Migrasi Media",
    "media:backup:create": "Backup Media",
    "backup:production": "Backup Production",
    "db:rbac-backfill": "Maintenance",
    "deploy:prod": "Deployment",
    "postinstall": "Aplikasi & Quality",
  }
  for (const [name, category] of Object.entries(expected)) {
    const entry = byName.get(name)
    assert.ok(entry, `${name} tidak muncul di halaman Development`)
    assert.equal(entry.category, category, `${name} berada di kategori yang tidak diharapkan`)
  }
})

/** Kode saja: komentar dibuang supaya larangan menilai perilaku, bukan prosa. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

test("modul dokumentasi CLI tidak pernah mengeksekusi perintah", async () => {
  const source = codeOnly(await readFile(path.join(PROJECT, "lib/development-cli.ts"), "utf8"))
  for (const forbidden of ["child_process", "execSync", "exec(", "spawn(", "spawnSync"]) {
    assert.ok(!source.includes(forbidden), `lib/development-cli.ts menyebut ${forbidden}`)
  }
})

test("halaman Development tidak menyediakan jalur eksekusi", async () => {
  const source = codeOnly(await readFile(path.join(PROJECT, "app/development/page.tsx"), "utf8"))
  for (const forbidden of ["child_process", "spawn", "exec(", "onClick", "<form", "fetch("]) {
    assert.ok(!source.includes(forbidden), `app/development/page.tsx menyebut ${forbidden}`)
  }
})

test("tidak ada route API yang dapat menjalankan perintah", async () => {
  const apiDir = path.join(PROJECT, "app/api/development")
  await assert.rejects(readFile(apiDir), /ENOENT|EISDIR/)
})

test("halaman memakai judul dan kolom tabel yang dijanjikan", async () => {
  const source = await readFile(path.join(PROJECT, "app/development/page.tsx"), "utf8")
  assert.ok(source.includes('title="Development"'))
  for (const column of ["No", "Kategori", "Command", "Kegunaan"]) {
    assert.ok(source.includes(`>${column}<`), `kolom ${column} tidak ditemukan`)
  }
})
