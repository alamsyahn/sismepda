"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Printer, RefreshCw, IdCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ScanStudent } from "@/lib/scan"

type Card = { student: ScanStudent; code: string; credentialId: string; image: string }
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
export function ScanCards({ schoolName }: { schoolName: string }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]),
    [classId, setClassId] = useState("")
  const [students, setStudents] = useState<ScanStudent[]>([]),
    [selected, setSelected] = useState<string[]>([])
  const [cards, setCards] = useState<Card[]>([]),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState("")
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (cards.length) { event.preventDefault(); event.returnValue = "" }
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [cards.length])
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
  async function issue(replace: boolean) {
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
    setBusy(true)
    try {
      const response = await fetch("/api/scan/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, replace }),
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
      toast.success(
        issued.length
          ? `${issued.length} kartu diterbitkan. Segera cetak atau simpan PDF.`
          : "Semua siswa terpilih sudah mempunyai QR aktif. Gunakan Ganti QR jika kartu perlu diterbitkan ulang.",
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kartu gagal diterbitkan. Muat ulang daftar sebelum mencoba lagi.")
    } finally {
      setBusy(false)
    }
  }
  function print() {
    if (!cards.length) return
    const popup = window.open("", "_blank")
    if (!popup) {
      toast.error("Izinkan pop-up untuk membuka kartu cetak.")
      return
    }
    popup.opener = null
    popup.document.write(
      `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Kartu QR Siswa</title><style>@page{size:A4;margin:12mm}body{font:12px system-ui;margin:0;color:#202030}.tools{padding:12px}main{display:grid;grid-template-columns:repeat(2,85mm);gap:8mm}.card{border:1px solid #ccc;border-radius:8px;padding:6mm;text-align:center;break-inside:avoid;box-sizing:border-box}h1{font-size:14px;margin:0 0 4px}h2{font-size:15px;margin:12px 0 4px}p{margin:4px 0}img{width:35mm;height:35mm}small{font-size:10px}@media print{.tools{display:none}}</style></head><body><div class="tools"><button onclick="window.print()">Cetak / Simpan PDF</button></div><main>${cards.map((c) => `<section class="card"><h1>${escapeHtml(schoolName)}</h1><small>KARTU SISWA · SISMEPDA</small><h2>${escapeHtml(c.student.name)}</h2><p>${escapeHtml(c.student.className)} · ${escapeHtml(c.student.nis ? `NIS ${c.student.nis}` : c.student.nisn ? `NISN ${c.student.nisn}` : "Identitas siswa")}</p><img src="${c.image}" alt="QR siswa"><p>Kehadiran & layanan UKS</p><small>Tunjukkan kartu kepada petugas. Simpan kartu ini dengan baik.</small></section>`).join("")}</main></body></html>`,
    )
    popup.document.close()
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
          Satu kartu untuk kehadiran dan UKS. QR hanya dapat dicetak pada sesi penerbitan ini; simpan hasil cetak/PDF
          sebelum menutup halaman. Mengganti QR menonaktifkan kartu lama.
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
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !selected.length} onClick={() => void issue(false)}>
          <IdCard />
          {busy ? "Memproses…" : "Terbitkan QR yang belum ada"}
        </Button>
        <Button variant="outline" disabled={busy || !selected.length} onClick={() => void issue(true)}>
          <RefreshCw />
          Ganti QR terpilih
        </Button>
        {cards.length > 0 && (
          <Button variant="outline" onClick={print}>
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
