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
  GURU_CSV_TEMPLATE,
  guruCsvStatusMeta,
  parseGuruCsv,
  previewName,
  type GuruCsvParseResult,
  type GuruCsvRow,
  type RegisteredGuruIdentifiers,
} from "@/lib/guru-input"

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

type FileInfo = {
  name: string
  size: number
  pickedAt: string
}

type ImportResult = {
  added: number
  skipped: number
  failed: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function toneBadge(tone: "valid" | "skip" | "error") {
  switch (tone) {
    case "valid":
      return "bg-[var(--chart-1)]/12 text-[var(--chart-1)]"
    case "skip":
      return "bg-[var(--chart-4)]/15 text-[var(--chart-4)]"
    case "error":
      return "bg-[var(--chart-5)]/12 text-[var(--chart-5)]"
  }
}

export function GuruCsvUpload() {
  const [delimiter, setDelimiter] = useState(",")
  const [fileText, setFileText] = useState<string | null>(null)
  const [registered, setRegistered] = useState<RegisteredGuruIdentifiers>({ nip: {}, email: {} })
  useEffect(() => {
    fetch("/api/admin/teachers").then((response) => response.json()).then((teachers) => setRegistered({
      nip: Object.fromEntries(teachers.filter((teacher: { nip: string | null }) => teacher.nip).map((teacher: { nip: string; name: string }) => [teacher.nip, teacher.name])),
      email: Object.fromEntries(teachers.filter((teacher: { email: string | null }) => teacher.email).map((teacher: { email: string; name: string }) => [teacher.email.toLowerCase(), teacher.name])),
    }))
  }, [])
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [parseResult, setParseResult] = useState<GuruCsvParseResult | null>(null)

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
    const blob = new Blob([changeCsvDelimiter(GURU_CSV_TEMPLATE, delimiter)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "template-data-guru.csv"
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success("Template CSV diunduh")
  }, [delimiter])

  const handleDelimiterChange = useCallback((nextDelimiter: string) => {
    setDelimiter(nextDelimiter)
    if (fileText !== null) {
      setParseResult(parseGuruCsv(fileText, registered, nextDelimiter))
    }
  }, [fileText, registered])

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
      const result = parseGuruCsv(text, registered, delimiter)
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
    }
    reader.readAsText(file)
  }, [delimiter, registered])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  const validCount = parseResult?.ok ? parseResult.valid : 0
  const canImport = Boolean(parseResult?.ok) && !reading && validCount > 0

  const doImport = useCallback(async () => {
    if (!parseResult?.ok) return
    setImporting(true)
    try {
      const validRows = parseResult.rows.filter((r) => r.status === "valid")
      const response = await fetch("/api/admin/teachers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validRows.map((r) => ({ nip: r.nip, email: r.email, name: previewName(r.sapaan, r.nama), phone: r.telepon, password: r.password }))) })
      if (!response.ok) throw new Error()
      setImporting(false)
      setConfirmOpen(false)
      setImportResult({
        added: parseResult.valid,
        skipped: parseResult.duplicateDb,
        failed: parseResult.problem,
      })
    } catch { setImporting(false); toast.error("Import guru gagal") }
  }, [parseResult])

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
            Gunakan file CSV dengan nama kolom yang sesuai agar data guru dapat dibaca dengan benar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CsvDelimiterField
            value={delimiter}
            onChange={handleDelimiterChange}
            disabled={reading || importing}
          />
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>nip</TableHead>
                  <TableHead>email</TableHead>
                  <TableHead>sapaan</TableHead>
                  <TableHead>nama_lengkap</TableHead>
                  <TableHead>nomor_telepon</TableHead>
                  <TableHead>password</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">199203112018012005</TableCell>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell>Ibu</TableCell>
                  <TableCell>Dewi Lestari</TableCell>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell className="font-mono text-xs">rahasia123</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">-</TableCell>
                  <TableCell className="text-xs">rudi.hartono@sekolah.sch.id</TableCell>
                  <TableCell>Bpk.</TableCell>
                  <TableCell>Rudi Hartono</TableCell>
                  <TableCell className="font-mono text-xs">081234567802</TableCell>
                  <TableCell className="font-mono text-xs">gurubaru88</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• Jangan mengubah nama header kolom.</li>
              <li>• Minimal salah satu NIP atau email wajib diisi dan harus unik.</li>
              <li>• Atur kolom NIP sebagai teks bila diedit di Excel agar nol depan tidak hilang.</li>
              <li>• Sapaan dan telepon boleh dikosongkan; nama lengkap dan password wajib diisi.</li>
              <li>• Password minimal 8 karakter.</li>
              <li>• NIP atau email yang sudah terdaftar akan dilewati, data lama tidak ditimpa.</li>
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
                Pastikan baris pertama berisi kolom: nip, email, sapaan, nama_lengkap, nomor_telepon,
                password.
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
              Hanya data valid yang akan diimpor. Data duplikat dan data bermasalah akan dilewati.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryStat label="Data valid" value={parseResult.valid} tone="valid" />
              <SummaryStat label="NIP/email sudah terdaftar" value={parseResult.duplicateDb} tone="skip" />
              <SummaryStat label="Data bermasalah" value={parseResult.problem} tone="error" />
              <SummaryStat label="Total baris" value={parseResult.total} tone="total" />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Baris</TableHead>
                    <TableHead>NIP</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Nama Guru</TableHead>
                    <TableHead>Telepon</TableHead>
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
                {validCount > 0
                  ? `${validCount} data siap diimpor ke sistem.`
                  : "Tidak ada data valid untuk diimpor."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={resetAll}>
                  Batalkan Upload
                </Button>
                <Button disabled={!canImport} onClick={() => setConfirmOpen(true)}>
                  <UploadCloud className="size-4" />
                  Impor {validCount} Guru Valid
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
            <DialogTitle>Impor data guru?</DialogTitle>
            <DialogDescription>
              Data yang valid akan ditambahkan ke sistem. Data duplikat dan data bermasalah akan
              dilewati.
            </DialogDescription>
          </DialogHeader>
          {parseResult?.ok ? (
            <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Guru baru akan ditambahkan</span>
                <span className="font-semibold text-[var(--chart-1)]">{parseResult.valid}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Data duplikat akan dilewati</span>
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
            <DialogDescription>Berikut ringkasan hasil impor data guru.</DialogDescription>
          </DialogHeader>
          {importResult ? (
            <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Guru berhasil ditambahkan</span>
                <span className="font-semibold text-[var(--chart-1)]">{importResult.added}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Dilewati (NIP/email sudah terdaftar)</span>
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
  tone: "valid" | "skip" | "error" | "total"
}) {
  const toneClass =
    tone === "valid"
      ? "border-[var(--chart-1)]/25 bg-[var(--chart-1)]/8"
      : tone === "skip"
        ? "border-[var(--chart-4)]/25 bg-[var(--chart-4)]/8"
        : tone === "error"
          ? "border-[var(--chart-5)]/25 bg-[var(--chart-5)]/8"
          : "border-border bg-muted/40"
  const valueClass =
    tone === "valid"
      ? "text-[var(--chart-1)]"
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

function PreviewRow({ row }: { row: GuruCsvRow }) {
  const meta = guruCsvStatusMeta[row.status]
  const displayName = previewName(row.sapaan, row.nama)
  return (
    <TableRow>
      <TableCell className="text-muted-foreground tabular-nums">{row.baris}</TableCell>
      <TableCell className="font-mono text-xs">
        {row.nip || <span className="italic text-muted-foreground">kosong</span>}
      </TableCell>
      <TableCell className="text-xs">
        {row.email || <span className="italic text-muted-foreground">kosong</span>}
      </TableCell>
      <TableCell>
        {displayName || <span className="italic text-muted-foreground">kosong</span>}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {row.telepon || <span className="italic text-muted-foreground">kosong</span>}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={cn("font-medium", toneBadge(meta.tone))}>
          {meta.label}
        </Badge>
      </TableCell>
    </TableRow>
  )
}
