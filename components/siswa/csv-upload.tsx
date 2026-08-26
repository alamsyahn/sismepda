"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Download,
  UploadCloud,
  FileText,
  RefreshCw,
  Trash2,
  Loader2,
  CircleCheckBig,
  CircleAlert,
  Info,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CsvDelimiterField } from "@/components/csv-delimiter-field"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { changeCsvDelimiter } from "@/lib/csv"
import {
  CSV_TEMPLATE,
  buildRegisteredStudentIdentifiers,
  csvStatusMeta,
  parseCsv,
  type CsvParseResult,
  type CsvImportBehavior,
  type CsvRow,
  type RegisteredStudentIdentifiers,
} from "@/lib/student-input"

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

type FileInfo = {
  name: string
  size: number
  pickedAt: string
}

type ImportResult = {
  added: number
  updated: number
  skipped: number
  failed: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function toneBadge(tone: "valid" | "update" | "skip" | "error") {
  switch (tone) {
    case "valid":
      return "bg-[var(--chart-1)]/12 text-[var(--chart-1)]"
    case "update":
      return "bg-[var(--chart-2)]/12 text-[var(--chart-2)]"
    case "skip":
      return "bg-[var(--chart-4)]/15 text-[var(--chart-4)]"
    case "error":
      return "bg-[var(--chart-5)]/12 text-[var(--chart-5)]"
  }
}

export function CsvUpload() {
  const [delimiter, setDelimiter] = useState(",")
  const [behavior, setBehavior] = useState<CsvImportBehavior>("skip")
  const [fileText, setFileText] = useState<string | null>(null)
  const [classOptions, setClassOptions] = useState<string[]>([])
  const [registered, setRegistered] = useState<RegisteredStudentIdentifiers>({ nis: {}, nisn: {} })
  const loadStudentOptions = useCallback(async () => {
    const response = await fetch("/api/admin/students")
    if (!response.ok) return
    const data = await response.json()
    setClassOptions(data.classes)
    setRegistered(buildRegisteredStudentIdentifiers(data.students))
  }, [])
  useEffect(() => { void loadStudentOptions() }, [loadStudentOptions])
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const resetAll = useCallback(() => {
    setFileText(null)
    setFileInfo(null)
    setParseResult(null)
    setFileError(null)
    setReading(false)
    setImportResult(null)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const handleDownloadTemplate = useCallback(() => {
    const blob = new Blob([changeCsvDelimiter(CSV_TEMPLATE, delimiter)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "template-data-siswa.csv"
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success("Template CSV diunduh")
  }, [delimiter])

  const handleDelimiterChange = useCallback((nextDelimiter: string) => {
    setDelimiter(nextDelimiter)
    if (fileText !== null) {
      setParseResult(parseCsv(fileText, classOptions, registered, nextDelimiter, behavior))
    }
  }, [behavior, classOptions, fileText, registered])

  const handleBehaviorChange = useCallback((nextBehavior: CsvImportBehavior) => {
    setBehavior(nextBehavior)
    if (fileText !== null) {
      setParseResult(parseCsv(fileText, classOptions, registered, delimiter, nextBehavior))
    }
  }, [classOptions, delimiter, fileText, registered])

  const processFile = useCallback((file: File) => {
    setFileError(null)
    setParseResult(null)
    setImportResult(null)

    const isCsv =
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel" ||
      file.name.toLowerCase().endsWith(".csv")
    if (!isCsv) {
      setFileError("File harus berformat CSV")
      return
    }
    if (file.size > MAX_SIZE) {
      setFileError("Ukuran file maksimal 5 MB")
      return
    }

    setReading(true)
    const reader = new FileReader()
    reader.onerror = () => {
      setReading(false)
      setFileError("File tidak dapat dibaca")
    }
    reader.onload = () => {
      const text = String(reader.result ?? "")
      const result = parseCsv(text, classOptions, registered, delimiter, behavior)
      const rowCount = result.ok ? result.total : 0
      setFileInfo({
        name: file.name,
        size: file.size,
        pickedAt: new Intl.DateTimeFormat("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      })
      setParseResult(result)
      setFileText(text)
      setReading(false)
      void rowCount
    }
    reader.readAsText(file)
  }, [behavior, classOptions, delimiter, registered])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  const readyCount = parseResult?.ok ? parseResult.ready : 0
  const processCount = parseResult?.ok ? parseResult.ready + parseResult.duplicateDb : 0
  const canImport = Boolean(parseResult?.ok) && !reading && (readyCount > 0 || (behavior === "skip" && (parseResult?.ok ? parseResult.duplicateDb : 0) > 0))

  const doImport = useCallback(async () => {
    if (!parseResult?.ok) return
    setImporting(true)
    try {
      const importRows = parseResult.rows.filter((row) => csvStatusMeta[row.status].tone !== "error")
      const response = await fetch("/api/admin/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ behavior, rows: importRows.map((r) => ({ nis: r.nis, nisn: r.nisn, name: r.nama, className: r.kelas })) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Import siswa gagal")
      await loadStudentOptions()
      setImporting(false)
      setConfirmOpen(false)
      setImportResult({
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        failed: parseResult.problem,
      })
    } catch (error) { setImporting(false); toast.error(error instanceof Error ? error.message : "Import siswa gagal") }
  }, [behavior, loadStudentOptions, parseResult])

  const headerError = parseResult && !parseResult.ok && parseResult.error === "header"
  const emptyError = parseResult && !parseResult.ok && parseResult.error === "empty"

  return (
    <div className="space-y-4">
      {/* Panduan format CSV */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-primary" />
            Format file CSV
          </CardTitle>
          <CardDescription>
            Gunakan file CSV dengan nama kolom yang sesuai agar data dapat dibaca dengan benar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CsvDelimiterField
            value={delimiter}
            onChange={handleDelimiterChange}
            disabled={reading || importing}
          />
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Jika NISN atau NIS sudah ditemukan</p>
                <p className="text-xs text-muted-foreground">Pencocokan selalu memprioritaskan NISN, kemudian NIS.</p>
              </div>
              <Select value={behavior} onValueChange={(value) => value && handleBehaviorChange(value as CsvImportBehavior)} disabled={reading || importing}>
                <SelectTrigger className="w-full bg-card sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Lewati data lama</SelectItem>
                  <SelectItem value="update">Perbarui data lama</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {behavior === "update"
                ? "Nama dan kelas akan diperbarui. NIS/NISN lama hanya berubah jika nilai baru diisi di CSV."
                : "Data siswa yang sudah ditemukan tidak akan diubah."}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>nis</TableHead>
                  <TableHead>nisn</TableHead>
                  <TableHead>nama_lengkap</TableHead>
                  <TableHead>kelas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">1001</TableCell>
                  <TableCell className="font-mono text-xs">0090001111</TableCell>
                  <TableCell>Ahmad Fauzan</TableCell>
                  <TableCell>VII A</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">1002</TableCell>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell>Aisyah Putri Ramadhani</TableCell>
                  <TableCell>VII A</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell className="font-mono text-xs">0090003333</TableCell>
                  <TableCell>Bagas Aditya Pratama</TableCell>
                  <TableCell>VII B</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• Jangan mengubah nama header kolom.</li>
              <li>• Minimal salah satu NIS atau NISN wajib diisi dan harus unik.</li>
              <li>• Atur kolom NIS/NISN sebagai teks di Excel agar nol depan tidak hilang.</li>
              <li>• Nama lengkap wajib diisi dan kelas harus tersedia di sistem.</li>
              <li>• Data lama akan dilewati atau diperbarui sesuai pilihan perilaku impor.</li>
            </ul>
            <Button variant="outline" className="shrink-0" onClick={handleDownloadTemplate}>
              <Download className="size-4" />
              Unduh Template CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Area upload / info file */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) processFile(file)
        }}
      />

      {!fileInfo ? (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="py-5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UploadCloud className="size-6" />
              </span>
              <span className="text-sm font-semibold text-foreground">Tarik file CSV ke sini</span>
              <span className="text-sm text-muted-foreground">atau klik untuk memilih file</span>
              <span className="mt-1 text-xs text-muted-foreground">Format CSV · Maksimal 5 MB</span>
            </button>

            {fileError ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="size-4 shrink-0" />
                <span>{fileError}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="size-5" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-medium text-foreground">{fileInfo.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(fileInfo.size)}
                  {parseResult?.ok ? ` · ${parseResult.total} baris data` : ""} · dipilih pukul{" "}
                  {fileInfo.pickedAt}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <RefreshCw className="size-4" />
                Ganti File
              </Button>
              <Button variant="outline" size="sm" onClick={resetAll}>
                <Trash2 className="size-4" />
                Hapus File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State membaca file */}
      {reading ? (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Membaca file...
          </CardContent>
        </Card>
      ) : null}

      {/* Error header / kosong */}
      {headerError ? (
        <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="flex items-start gap-2.5 py-4 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Header CSV tidak sesuai</p>
              <p className="text-destructive/80">
                Pastikan baris pertama berisi kolom: nis, nisn, nama_lengkap, kelas.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {emptyError ? (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Info className="size-5" />
            File CSV kosong atau tidak memiliki baris data.
          </CardContent>
        </Card>
      ) : null}

      {/* Ringkasan + preview */}
      {parseResult?.ok ? (
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Preview & Validasi Data</CardTitle>
            <CardDescription>
              Preview mengikuti pilihan perilaku impor. Konflik identitas dan data bermasalah tidak akan diproses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <SummaryStat label="Siswa baru" value={parseResult.valid} tone="valid" />
              <SummaryStat label="Akan diperbarui" value={parseResult.update} tone="update" />
              <SummaryStat label="Akan dilewati" value={parseResult.duplicateDb} tone="skip" />
              <SummaryStat label="Data bermasalah" value={parseResult.problem} tone="error" />
              <SummaryStat label="Total baris" value={parseResult.total} tone="total" />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Baris</TableHead>
                    <TableHead>NIS</TableHead>
                    <TableHead>NISN</TableHead>
                    <TableHead>Nama Lengkap</TableHead>
                    <TableHead className="w-24">Kelas</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parseResult.rows.map((row) => (
                    <PreviewRow key={row.baris} row={row} />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {processCount > 0
                  ? `${processCount} data siap diproses sesuai perilaku impor.`
                  : "Tidak ada data yang dapat diproses."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={resetAll}>
                  Batalkan Upload
                </Button>
                <Button disabled={!canImport} onClick={() => setConfirmOpen(true)}>
                  <UploadCloud className="size-4" />
                  Proses {processCount} Data Siswa
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Dialog konfirmasi impor */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!importing) setConfirmOpen(o)
        }}
      >
        <DialogContent showCloseButton={!importing}>
          <DialogHeader>
            <DialogTitle>Impor data siswa?</DialogTitle>
            <DialogDescription>
              Sistem akan mencocokkan ulang NISN terlebih dahulu, kemudian NIS, sebelum melakukan perubahan.
            </DialogDescription>
          </DialogHeader>
          {parseResult?.ok ? (
            <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Siswa baru akan ditambahkan</span>
                <span className="font-semibold text-[var(--chart-1)]">{parseResult.valid}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Data siswa akan diperbarui</span>
                <span className="font-semibold text-[var(--chart-2)]">{parseResult.update}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Data lama akan dilewati</span>
                <span className="font-semibold text-[var(--chart-4)]">{parseResult.duplicateDb}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Data bermasalah tidak diimpor</span>
                <span className="font-semibold text-[var(--chart-5)]">{parseResult.problem}</span>
              </li>
            </ul>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={importing} />}>Batal</DialogClose>
            <Button onClick={doImport} disabled={importing}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : null}
              {importing ? "Mengimpor..." : "Ya, Impor Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal hasil impor */}
      <Dialog open={Boolean(importResult)} onOpenChange={(o) => !o && setImportResult(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <CircleCheckBig className="size-7" />
            </span>
            <DialogTitle className="text-lg">Impor data selesai</DialogTitle>
            <DialogDescription>Berikut ringkasan hasil impor data siswa.</DialogDescription>
          </DialogHeader>
          {importResult ? (
            <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Siswa berhasil ditambahkan</span>
                <span className="font-semibold text-[var(--chart-1)]">{importResult.added}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Siswa berhasil diperbarui</span>
                <span className="font-semibold text-[var(--chart-2)]">{importResult.updated}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Dilewati (NIS/NISN sudah terdaftar)</span>
                <span className="font-semibold text-[var(--chart-4)]">{importResult.skipped}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Gagal (data tidak valid)</span>
                <span className="font-semibold text-[var(--chart-5)]">{importResult.failed}</span>
              </li>
            </ul>
          ) : null}
          <DialogFooter className="sm:justify-center">
            <Button variant="outline" onClick={() => setImportResult(null)}>
              Selesai
            </Button>
            <Button
              onClick={() => {
                setImportResult(null)
                resetAll()
              }}
            >
              Upload File Lain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "valid" | "update" | "skip" | "error" | "total"
}) {
  const toneClass =
    tone === "valid"
      ? "border-[var(--chart-1)]/25 bg-[var(--chart-1)]/8"
      : tone === "update"
        ? "border-[var(--chart-2)]/25 bg-[var(--chart-2)]/8"
      : tone === "skip"
        ? "border-[var(--chart-4)]/25 bg-[var(--chart-4)]/8"
        : tone === "error"
          ? "border-[var(--chart-5)]/25 bg-[var(--chart-5)]/8"
          : "border-border bg-muted/40"
  const valueClass =
    tone === "valid"
      ? "text-[var(--chart-1)]"
      : tone === "update"
        ? "text-[var(--chart-2)]"
      : tone === "skip"
        ? "text-[var(--chart-4)]"
        : tone === "error"
          ? "text-[var(--chart-5)]"
          : "text-foreground"
  return (
    <div className={cn("rounded-xl border p-3", toneClass)}>
      <p className={cn("text-2xl font-bold tabular-nums", valueClass)}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{label}</p>
    </div>
  )
}

function PreviewRow({ row }: { row: CsvRow }) {
  const meta = csvStatusMeta[row.status]
  return (
    <TableRow>
      <TableCell className="text-muted-foreground tabular-nums">{row.baris}</TableCell>
      <TableCell className="font-mono text-xs">
        {row.nis || <span className="text-muted-foreground italic">kosong</span>}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {row.nisn || <span className="text-muted-foreground italic">kosong</span>}
      </TableCell>
      <TableCell>
        {row.nama || <span className="text-muted-foreground italic">kosong</span>}
      </TableCell>
      <TableCell>
        {row.kelas || <span className="text-muted-foreground italic">kosong</span>}
      </TableCell>
      <TableCell>
        <Badge className={cn("border-transparent", toneBadge(meta.tone))}>{meta.label}</Badge>
      </TableCell>
    </TableRow>
  )
}
