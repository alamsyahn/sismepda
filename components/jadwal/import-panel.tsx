"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { scheduleFetch, useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import { SCHEDULE_DAY_LABELS, type ScheduleDay } from "@/lib/schedule-constants"
import type { MappingPlan, MappingPlanRow } from "@/lib/asc-mapping"
import type { SchedulePreview, PreviewRow } from "@/lib/server-schedule-import"
import type { ScheduleMasterData } from "@/lib/server-schedule"

type EntityType = "TEACHER" | "CLASS" | "SUBJECT"

function rowLabel(row: PreviewRow): string {
  const day = SCHEDULE_DAY_LABELS[row.day as ScheduleDay] ?? `Hari ${row.day}`
  return `${day} jam ke-${row.period} · ${row.className} · ${row.subjectName}${row.teacherName ? ` · ${row.teacherName}` : ""}`
}

/**
 * Satu tabel pemetaan entity aSc → entity SISMEPDA.
 *
 * Saran fuzzy TIDAK pernah tersimpan sendiri: `autoSelectId` hanya menjadi
 * nilai awal combobox, dan admin tetap harus menyimpannya. Nama resmi Data
 * Master tidak pernah ditimpa nama dari XML.
 */
function MappingTable({
  title,
  description,
  entityType,
  plan,
  options,
  emptyOptionsHint,
  onChanged,
}: {
  title: string
  description: string
  entityType: EntityType
  plan: MappingPlan
  options: readonly { id: string; name: string }[]
  emptyOptionsHint: string
  onChanged: () => void
}) {
  const [savingId, setSavingId] = useState<string | null>(null)

  async function save(row: MappingPlanRow, internalId: string | null) {
    setSavingId(row.externalId)
    try {
      await scheduleFetch("/api/jadwal/mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          externalId: row.externalId,
          externalName: row.externalName,
          internalId,
        }),
      })
      toast.success("Pemetaan disimpan")
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pemetaan gagal disimpan")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <Badge variant="secondary">
            <CheckCircle2 className="size-3" /> {plan.mappedCount} dikenali
          </Badge>
          {plan.unmappedCount > 0 ? (
            <Badge variant="destructive">
              <AlertTriangle className="size-3" /> {plan.unmappedCount} perlu dipetakan
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {plan.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Berkas ini tidak merujuk entitas apa pun pada kategori tersebut.
          </p>
        ) : (
          <>
            {options.length === 0 ? (
              <p className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{emptyOptionsHint}</span>
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama di berkas aSc</TableHead>
                  <TableHead className="w-80">Data Master SISMEPDA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((row) => {
                  const current = row.mappedId ?? row.suggestion?.autoSelectId ?? ""
                  return (
                    <TableRow key={row.externalId}>
                      <TableCell>
                        <p className="font-medium">{row.externalName}</p>
                        <p className="text-xs text-muted-foreground">ID aSc: {row.externalId}</p>
                        {!row.mappedId && row.suggestion && row.suggestion.candidates.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Kandidat: {row.suggestion.candidates.map((item) => item.name).join(", ")}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={current}
                            disabled={options.length === 0}
                            onValueChange={(value) => value && save(row, String(value))}
                          >
                            <SelectTrigger className="w-full" aria-label={`Pemetaan untuk ${row.externalName}`}>
                              <SelectValue placeholder="Belum dipetakan">
                                {(value: string) =>
                                  options.find((item) => item.id === value)?.name ?? "Belum dipetakan"
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              {options.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {row.mappedId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={savingId === row.externalId}
                              onClick={() => save(row, null)}
                            >
                              Lepas
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Panel impor aSc: unggah → pratinjau → petakan → Terapkan.
 *
 * Mengunggah TIDAK pernah menyentuh jadwal aktif. Jadwal baru hanya lahir dari
 * tombol "Terapkan Jadwal", dan tombol itu mati selama masih ada pemetaan
 * kritis yang belum selesai.
 */
export function ImportPanel({
  master,
  onApplied,
}: {
  master: ScheduleMasterData
  onApplied: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)

  const preview = useScheduleResource<SchedulePreview>(
    importId ? `/api/jadwal/impor/${importId}` : null,
  )

  async function upload() {
    if (!file) {
      toast.error("Pilih berkas XML terlebih dahulu")
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const result = await scheduleFetch<{ importId: string }>("/api/jadwal/impor", {
        method: "POST",
        body: form,
      })
      setImportId(result.importId)
      toast.success("Berkas terbaca. Periksa pratinjau sebelum menerapkan.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Berkas gagal dibaca")
    } finally {
      setUploading(false)
    }
  }

  async function act(action: "apply" | "cancel") {
    if (!importId) return
    setApplying(true)
    try {
      await scheduleFetch(`/api/jadwal/impor/${importId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      toast.success(action === "apply" ? "Jadwal baru diterapkan" : "Impor dibatalkan")
      setImportId(null)
      setFile(null)
      onApplied()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impor gagal diproses")
    } finally {
      setApplying(false)
    }
  }

  const data = preview.data

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Impor dari aSc TimeTables</CardTitle>
          <CardDescription>
            Berkas XML menentukan siapa mengajar apa, di kelas mana, hari apa, dan jam ke berapa. Jam
            mulai/selesai tetap mengikuti tab “Waktu &amp; Kegiatan”.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="asc-file">Berkas XML</Label>
              <Input
                id="asc-file"
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button onClick={upload} disabled={uploading || !file}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Baca &amp; Pratinjau
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview.loading ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Menyusun pratinjau…
        </p>
      ) : preview.error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          {preview.error}
        </p>
      ) : data ? (
        <div className="space-y-4">
          <MappingTable
            title="Guru"
            description="Pemetaan disimpan berdasarkan ID aSc, sehingga typo nama pada ekspor berikutnya tidak memindahkan jadwal."
            entityType="TEACHER"
            plan={data.mapping.teachers}
            options={master.teachers}
            emptyOptionsHint="Belum ada guru yang memenuhi syarat modul Jadwal, sehingga tidak ada pilihan yang dapat ditampilkan. Syaratnya: akun aktif, tertaut Data Master Guru, dan memegang role dengan key “guru”. Akun yang hanya memegang role lama “legacy_guru” belum terhitung."
            onChanged={preview.reload}
          />
          <MappingTable
            title="Kelas"
            description="Nama kelas di berkas aSc boleh berbeda format; nama resmi SISMEPDA tidak pernah ditimpa."
            entityType="CLASS"
            plan={data.mapping.classes}
            options={master.classes}
            emptyOptionsHint="Data Master Kelas masih kosong, sehingga tidak ada pilihan yang dapat ditampilkan. Tambahkan kelas terlebih dahulu di Data Master."
            onChanged={preview.reload}
          />
          <MappingTable
            title="Mata Pelajaran"
            description="Contoh: “Pendidikan Pancasila” di aSc dapat dipetakan ke “PPKn” di SISMEPDA."
            entityType="SUBJECT"
            plan={data.mapping.subjects}
            options={master.subjects}
            emptyOptionsHint="Data Master Mata Pelajaran masih kosong, sehingga tidak ada pilihan yang dapat ditampilkan. Tambahkan mata pelajaran terlebih dahulu di Kurikulum."
            onChanged={preview.reload}
          />

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Perubahan Jadwal</CardTitle>
              <CardDescription>
                Menerapkan impor menjadikan hasilnya sebagai baseline jadwal aktif baru. Suntingan manual
                yang berbeda dari berkas ini akan tertimpa — selisihnya terlihat di bawah.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">+ {data.diff.added} baru</Badge>
                <Badge variant="secondary">~ {data.diff.changed} berubah</Badge>
                <Badge variant="secondary">- {data.diff.removed} dihapus</Badge>
                <Badge variant="outline">{data.diff.unchanged} tetap</Badge>
              </div>

              {data.warnings.length > 0 ? (
                <details className="rounded-lg border border-border/60 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {data.warnings.length} peringatan pembacaan berkas
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {data.warnings.map((warning, index) => (
                      <li key={index}>{warning.message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <details className="rounded-lg border border-border/60 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Lihat detail perubahan</summary>
                <div className="mt-3 space-y-3 text-xs">
                  <div>
                    <p className="font-medium">Baru</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {data.details.added.map((row, index) => (
                        <li key={`a${index}`}>+ {rowLabel(row)}</li>
                      ))}
                      {data.details.added.length === 0 ? <li>—</li> : null}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">Berubah</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {data.details.changed.map((row, index) => (
                        <li key={`c${index}`}>
                          ~ {rowLabel(row.before)} → {rowLabel(row.after)}
                        </li>
                      ))}
                      {data.details.changed.length === 0 ? <li>—</li> : null}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">Dihapus</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {data.details.removed.map((row, index) => (
                        <li key={`r${index}`}>- {rowLabel(row)}</li>
                      ))}
                      {data.details.removed.length === 0 ? <li>—</li> : null}
                    </ul>
                  </div>
                </div>
              </details>

              {data.blockers.length > 0 ? (
                <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {data.blockers.map((blocker, index) => (
                    <li key={index}>{blocker}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => act("cancel")} disabled={applying}>
                  Batalkan
                </Button>
                <Button onClick={() => act("apply")} disabled={applying || data.blockers.length > 0}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : null}
                  Terapkan Jadwal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
