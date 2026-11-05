"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Printer, RefreshCw, IdCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ScanStudent } from "@/lib/scan"
import { cardPageLayout, defaultCardPrintOptions, studentCardsPrintHtml, type CardPaper, type CardPrintOptions } from "@/lib/student-card-print"

type Card = { student: ScanStudent; code: string; credentialId: string; image: string }
export function ScanCards({ schoolName, schoolLogoUrl }: { schoolName: string; schoolLogoUrl: string }) {
  const [printOptions, setPrintOptions] = useState<CardPrintOptions>(defaultCardPrintOptions)
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]),
    [classId, setClassId] = useState("")
  const [students, setStudents] = useState<ScanStudent[]>([]),
    [selected, setSelected] = useState<string[]>([])
  const [cards, setCards] = useState<Card[]>([]),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/scan/students?mode=cards&classId=${encodeURIComponent(classId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error)
        setClasses(d.classes)
        setStudents(d.students)
        setSelected([])
      })
      .catch((e) => {
        if (e.name !== "AbortError") toast.error(e.message ?? "Daftar siswa gagal dimuat")
      })
    return () => controller.abort()
  }, [classId])
  async function issue(replace: boolean, printSelected = false) {
    const entries = students
      .filter((s) => selected.includes(s.id))
      .map((s) => ({ studentId: s.id, expectedCredentialId: s.credentialId ?? null }))
    if (!entries.length) return
    if (
      replace &&
      !window.confirm(
        "Ganti QR untuk siswa terpilih? Kartu lama mereka langsung tidak berlaku. Simpan/cetak kartu baru setelah penerbitan.",
      )
    )
      return
    let popup: Window | null = null
    if (printSelected) {
      try { cardPageLayout(printOptions) } catch (e) { toast.error((e as Error).message); return }
      popup = window.open("", "_blank")
      if (!popup) { toast.error("Izinkan pop-up untuk membuka kartu cetak."); return }
      popup.opener = null
      popup.document.body.textContent = "Menyiapkan kartu pelajar…"
    }
    setBusy(true)
    try {
      const response = await fetch("/api/scan/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, replace, includeExisting: printSelected }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      const { toDataURL } = await import("qrcode")
      const issued = await Promise.all(
        data.cards.map(async (card: Omit<Card, "image">) => ({
          ...card,
          image: await toDataURL(card.code, { width: 360, margin: 4, errorCorrectionLevel: "M" }),
        })),
      )
      setCards((prev) => [...prev.filter((c) => !issued.some((i) => i.student.id === c.student.id)), ...issued])
      setStudents((prev) =>
        prev.map((s) => ({
          ...s,
          credentialId: issued.find((c) => c.student.id === s.id)?.credentialId ?? s.credentialId,
        })),
      )
      if (popup) {
        const ordered = entries.flatMap((entry) => issued.filter((c: Card) => c.student.id === entry.studentId))
        await writePrintWindow(popup, ordered)
      }
      toast.success(
        printSelected ? `${issued.length} kartu siap dicetak. QR yang sudah aktif tetap berlaku.` : issued.length
          ? `${issued.length} kartu diterbitkan. Segera cetak atau simpan PDF.`
          : "Semua siswa terpilih sudah mempunyai QR aktif. Gunakan Cetak kartu pelajar untuk mencetak ulang.",
      )
    } catch (e) {
      if (popup && !popup.closed) popup.document.body.textContent = "Kartu gagal disiapkan. Tutup jendela ini dan coba lagi dari tab Kartu QR."
      toast.error(e instanceof Error ? e.message : "Kartu gagal diterbitkan. Muat ulang daftar sebelum mencoba lagi.")
    } finally {
      setBusy(false)
    }
  }
  async function writePrintWindow(popup: Window, entries: Card[]) {
    // Embed the logo so saving/printing this document does not depend on an active login.
    let logo = ""
    if (schoolLogoUrl) {
      const response = await fetch(schoolLogoUrl)
      if (!response.ok) throw new Error("Logo sekolah gagal dimuat. Coba cetak kembali.")
      const blob = await response.blob()
      logo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error("Logo sekolah gagal dibaca"))
        reader.readAsDataURL(blob)
      })
    }
    if (popup.closed) throw new Error("Jendela cetak ditutup. Kartu dapat dicetak kembali.")
    popup.document.open()
    popup.document.write(studentCardsPrintHtml(entries, schoolName, logo, printOptions))
    popup.document.close()
  }
  async function print() {
    if (!cards.length) return
    try { cardPageLayout(printOptions) } catch (e) { toast.error((e as Error).message); return }
    const popup = window.open("", "_blank")
    if (!popup) {
      toast.error("Izinkan pop-up untuk membuka kartu cetak.")
      return
    }
    popup.opener = null
    setBusy(true)
    try { await writePrintWindow(popup, cards) }
    catch (e) { popup.close(); toast.error(e instanceof Error ? e.message : "Cetak gagal disiapkan") }
    finally { setBusy(false) }
  }
  const visible = students.filter((s) =>
    `${s.name} ${s.nis ?? ""} ${s.nisn ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5 text-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <IdCard className="size-4 text-primary" />
          Kartu QR siswa
        </h2>
        <p className="mt-2 text-muted-foreground">
          Pilih siswa lalu cetak kartu pelajar. QR yang belum ada otomatis diterbitkan; kartu yang sudah aktif tetap
          berlaku dan bisa dicetak ulang. Mengganti QR menonaktifkan kartu lama.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="qr-class">Kelas</Label>
          <select
            id="qr-class"
            className="h-10 rounded-md border bg-card px-3 text-sm"
            value={classId}
            disabled={busy}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Pilih kelas</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="qr-search">Cari siswa dalam kelas</Label>
          <Input id="qr-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nama, NIS, atau NISN" />
        </div>
      </div>
      {students.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              disabled={busy}
              checked={visible.length > 0 && visible.every((s) => selected.includes(s.id))}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked
                    ? [...new Set([...prev, ...visible.map((s) => s.id)])]
                    : prev.filter((id) => !visible.some((s) => s.id === id)),
                )
              }
            />
            Pilih semua yang ditampilkan ({visible.length})
          </label>
          <div className="divide-y">
            {visible.map((s) => (
              <label key={s.id} className="flex min-h-14 items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.nis ? `NIS ${s.nis}` : `NISN ${s.nisn ?? "—"}`}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{s.credentialId ? "QR aktif" : "Belum ada QR"}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Pengaturan cetak kartu pelajar</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="card-paper">Ukuran kertas</Label>
            <select id="card-paper" className="h-10 rounded-md border bg-card px-3 text-sm" value={printOptions.paper} disabled={busy}
              onChange={(e) => setPrintOptions((p) => ({ ...p, paper: e.target.value as CardPaper }))}>
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="A3">A3 (297 × 420 mm)</option>
              <option value="F4">F4 (210 × 330 mm)</option>
              <option value="Custom">Custom</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="card-orientation">Orientasi</Label>
            <select id="card-orientation" className="h-10 rounded-md border bg-card px-3 text-sm" value={printOptions.orientation} disabled={busy}
              onChange={(e) => setPrintOptions((p) => ({ ...p, orientation: e.target.value as CardPrintOptions["orientation"] }))}>
              <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
          </div>
          {printOptions.paper === "Custom" && <>
            <div className="grid gap-2"><Label htmlFor="card-width">Lebar kertas (mm)</Label>
              <Input id="card-width" className="w-36" type="number" min={75} max={1200} disabled={busy} value={printOptions.customWidth}
                onChange={(e) => setPrintOptions((p) => ({ ...p, customWidth: Number(e.target.value) }))} /></div>
            <div className="grid gap-2"><Label htmlFor="card-height">Tinggi kertas (mm)</Label>
              <Input id="card-height" className="w-36" type="number" min={75} max={1200} disabled={busy} value={printOptions.customHeight}
                onChange={(e) => setPrintOptions((p) => ({ ...p, customHeight: Number(e.target.value) }))} /></div>
          </>}
        </div>
        <p className="text-sm text-muted-foreground">Ukuran kartu 9 × 5,5 cm · Jarak antarkartu 5 mm · Margin kertas 8 mm. Cetak dengan skala 100% / ukuran sebenarnya.</p>
        <p className="text-sm text-muted-foreground">Kartu memuat QR untuk kehadiran dan UKS, serta barcode NIPD / NIS untuk layanan yang mendukungnya. NIPD / NIS mengikuti data siswa, termasuk angka nol di depan.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !selected.length} onClick={() => void issue(false, true)}>
          <Printer />
          {busy ? "Memproses…" : `Cetak kartu pelajar${selected.length ? ` (${selected.length})` : ""}`}
        </Button>
        <Button variant="outline" disabled={busy || !selected.length} onClick={() => void issue(false)}>
          <IdCard />
          {busy ? "Memproses…" : "Terbitkan QR yang belum ada"}
        </Button>
        <Button variant="outline" disabled={busy || !selected.length} onClick={() => void issue(true)}>
          <RefreshCw />
          Ganti QR terpilih
        </Button>
        {cards.length > 0 && (
          <Button variant="outline" disabled={busy} onClick={() => void print()}>
            <Printer />
            Cetak / simpan {cards.length} kartu
          </Button>
        )}
      </div>
      {cards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div key={c.credentialId} className="rounded-xl border bg-card p-5 text-center">
              <h3 className="font-semibold">{c.student.name}</h3>
              <p className="text-sm text-muted-foreground">
                {c.student.className} · {c.student.nis ?? c.student.nisn}
              </p>
              <Image
                unoptimized
                src={c.image}
                width={180}
                height={180}
                className="mx-auto my-3"
                alt={`QR ${c.student.name}`}
              />
              <p className="text-xs text-muted-foreground">Kehadiran & layanan UKS</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
