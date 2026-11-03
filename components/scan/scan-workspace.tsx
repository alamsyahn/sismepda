"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Camera,
  Usb,
  ScanLine,
  ShieldCheck,
  CheckCircle2,
  TriangleAlert,
  Search,
  Save,
  History,
  IdCard,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { CameraScanner } from "@/components/scan/camera-scanner"
import { ScanCards } from "@/components/scan/scan-cards"
import { attendanceFeedback, ScanFeedbackPopup, type ScanFeedback } from "@/components/scan/scan-feedback-popup"
import {
  SCAN_OUTCOMES,
  followUps,
  type ScanHistoryRow,
  type ScanMode,
  type ScanResult,
  type ScanStudent,
} from "@/lib/scan"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

type Capabilities = {
  attendance: boolean
  uks: boolean
  cards: boolean
  schoolName: string
  schoolLogoUrl: string
  historyAttendance: boolean
  historyUks: boolean
  notify: boolean
  complaints: string[]
}
type PendingScan = {
  requestId: string
  mode: ScanMode
  source: "CAMERA" | "USB" | "MANUAL"
  code?: string
  studentId?: string
}
const selectClass = "h-11 w-full min-w-0 rounded-md border bg-card px-3 text-base sm:h-10 sm:text-sm"
async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  if (response.redirected) throw new Error("Sesi berakhir. Muat ulang halaman untuk masuk kembali.")
  const data = await response.json().catch(() => ({ error: "Respons server tidak dapat dibaca" }))
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Permintaan gagal"), { status: response.status })
  return data
}
const post = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export function ScanWorkspace() {
  const { today, formatTime, timeZoneLabel } = useSchoolTimeZone()
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const feedbackSequence = useRef(0)
  const dismissFeedback = useCallback((id: number) => {
    setFeedback((current) => (current?.id === id ? null : current))
  }, [])
  const [cap, setCap] = useState<Capabilities | null>(null),
    [online, setOnline] = useState(true),
    [fatal, setFatal] = useState("")
  const [tab, setTab] = useState("scan"),
    [mode, setMode] = useState<ScanMode>("attendance"),
    [source, setSource] = useState<"CAMERA" | "USB">("USB")
  const [camera, setCamera] = useState(false),
    [cameraError, setCameraError] = useState(""),
    [focused, setFocused] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<PendingScan | null>(null)
  const [query, setQuery] = useState(""),
    [matches, setMatches] = useState<ScanStudent[]>([]),
    [searchError, setSearchError] = useState("")
  const [complaint, setComplaint] = useState(""),
    [treatment, setTreatment] = useState(""),
    [followUp, setFollowUp] = useState(""),
    [detail, setDetail] = useState("")
  const [formError, setFormError] = useState(""),
    [savePending, setSavePending] = useState(false)
  const [rows, setRows] = useState<ScanHistoryRow[]>([]),
    [historyMode, setHistoryMode] = useState<ScanMode>("attendance"),
    [date, setDate] = useState<string>(() => today()),
    [historyQuery, setHistoryQuery] = useState("")
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [historyError, setHistoryError] = useState("")
  const input = useRef<HTMLInputElement>(null),
    form = useRef<HTMLFormElement>(null),
    complaintInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false),
    cameraSeen = useRef({ code: "", at: 0 }),
    pendingBody = useRef<unknown>(null)
  const draft = result?.outcome === "DRAFT",
    locked = busy || Boolean(draft) || Boolean(pending) || savePending
  const historyAllowed = historyMode === "attendance" ? cap?.historyAttendance : cap?.historyUks
  const refreshCapabilities = useCallback(async () => {
    try {
      const data = await jsonRequest<Capabilities>("/api/scan")
      setCap(data)
      setOnline(true)
      setFatal("")
      return data
    } catch (e) {
      setOnline(false)
      setFatal(e instanceof Error ? e.message : "Server tidak dapat dihubungi")
      return null
    }
  }, [])
  useEffect(() => {
    void refreshCapabilities().then((data) => {
      if (data && !data.attendance && data.uks) setMode("uks")
      if (data && !data.historyAttendance && data.historyUks) setHistoryMode("uks")
      if (data && !data.attendance && !data.uks) setTab(data.cards ? "cards" : "history")
    })
    if (window.matchMedia("(pointer:coarse)").matches) setSource("CAMERA")
    else {
      try {
        if (localStorage.getItem("sismepda-scan-source") === "CAMERA") setSource("CAMERA")
      } catch {
        /* preference optional */
      }
    }
    const tick = setInterval(() => {
      if (!document.hidden) void refreshCapabilities()
    }, 15000)
    const offline = () => setOnline(false),
      connected = () => {
        void refreshCapabilities()
      }
    window.addEventListener("offline", offline)
    window.addEventListener("online", connected)
    return () => {
      clearInterval(tick)
      window.removeEventListener("offline", offline)
      window.removeEventListener("online", connected)
    }
  }, [refreshCapabilities])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draft || pending || savePending) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [draft, pending, savePending])
  useEffect(() => {
    if (!draft && !pending && !savePending) return
    const protectDraft = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(target instanceof HTMLAnchorElement)) return
      const url = new URL(target.href, window.location.href)
      if (url.origin === window.location.origin && url.pathname === "/scan") return
      event.preventDefault()
      event.stopPropagation()
      toast.error("Selesaikan atau batalkan pencatatan yang aktif sebelum meninggalkan halaman.")
    }
    document.addEventListener("click", protectDraft, true)
    return () => document.removeEventListener("click", protectDraft, true)
  }, [draft, pending, savePending])
  useEffect(() => {
    if (source === "USB" && tab === "scan" && !locked && online) input.current?.focus()
  }, [source, locked, online, tab, cap?.attendance, cap?.uks])
  useEffect(() => {
    if (draft) {
      complaintInput.current?.focus()
      form.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [draft])
  useEffect(() => {
    if (query.trim().length < 2 || !cap) {
      setMatches([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void jsonRequest<{ students: ScanStudent[] }>(`/api/scan/students?mode=${mode}&q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((d) => {
          setMatches(d.students)
          setSearchError(d.students.length ? "" : "Siswa tidak ditemukan dalam akses Anda.")
        })
        .catch((e) => {
          if (e.name !== "AbortError") setSearchError(e.message)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, mode, cap])
  const loadHistory = useCallback(async () => {
    if (!historyAllowed) return
    try {
      const data = await jsonRequest<{ rows: ScanHistoryRow[]; pages: number }>(
        `/api/scan/history?mode=${historyMode}&date=${date}&page=${page}&q=${encodeURIComponent(historyQuery)}`,
      )
      setRows(data.rows)
      setPages(data.pages)
      setHistoryError("")
    } catch (e) {
      setRows([])
      setHistoryError(e instanceof Error ? e.message : "Riwayat gagal dimuat")
    }
  }, [historyAllowed, historyMode, date, page, historyQuery])
  useEffect(() => {
    const timer = setTimeout(() => void loadHistory(), 250)
    const poll = setInterval(() => {
      if (!document.hidden && tab === "history") void loadHistory()
    }, 10000)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
    }
  }, [loadHistory, tab])

  const submitScan = useCallback(
    async (body: PendingScan) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setPending(body)
      setFormError("")
      try {
        const data = await jsonRequest<ScanResult>("/api/scan", post(body))
        setResult(data)
        if (body.mode === "attendance") {
          setFeedback({ ...attendanceFeedback(data), id: ++feedbackSequence.current })
        }
        setPending(null)
        setOnline(true)
        setQuery("")
        setMatches([])
        if (data.outcome === "DRAFT") {
          setComplaint("")
          setTreatment("")
          setFollowUp("")
          setDetail("")
          pendingBody.current = null
        }
        if (data.outcome === "PRESENT") navigator.vibrate?.(70)
        void loadHistory()
      } catch (e) {
        const error = e as Error & { status?: number }
        if (body.mode === "attendance") {
          setFeedback({
            id: ++feedbackSequence.current,
            success: false,
            title: error.status && error.status < 500 ? "Scan gagal" : "Belum terkonfirmasi",
            message: error.message || "Hubungkan kembali, lalu coba proses permintaan yang sama.",
          })
        }
        if (error.status && error.status < 500) setPending(null)
        else setOnline(false)
        setFormError(
          error.message ?? "Hasil scan belum terkonfirmasi. Hubungkan kembali, lalu coba proses permintaan yang sama.",
        )
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [loadHistory],
  )
  const onCode = useCallback(
    (code: string) => {
      const at = Date.now(),
        previous = cameraSeen.current
      cameraSeen.current = { code, at }
      if (previous.code === code && at - previous.at < 1500) return
      if (locked || !online || tab !== "scan") return
      void submitScan({ requestId: crypto.randomUUID(), mode, source: "CAMERA", code })
    },
    [locked, online, tab, mode, submitScan],
  )
  function changeTab(next: string) {
    if (locked) {
      toast.error("Selesaikan atau batalkan pencatatan yang aktif terlebih dahulu.")
      return
    }
    setTab(next)
    setCamera(false)
    setQuery("")
    setMatches([])
  }
  async function saveVisit() {
    if (!result || busy || !online) return
    const body = pendingBody.current ?? {
      eventId: result.id,
      complaint,
      treatment,
      followUp,
      detail,
      notify: Boolean(cap?.notify),
    }
    pendingBody.current = body
    setBusy(true)
    setSavePending(true)
    setFormError("")
    try {
      const saved = await jsonRequest<ScanResult>("/api/scan/visits", post(body))
      setResult(saved)
      setSavePending(false)
      pendingBody.current = null
      toast.success("Kunjungan UKS tersimpan")
      void loadHistory()
    } catch (e) {
      const error = e as Error & { status?: number }
      if (error.status && error.status < 500) {
        pendingBody.current = null
        setSavePending(false)
      } else setOnline(false)
      setFormError(error.message ?? "Hasil simpan belum terkonfirmasi. Coba simpan lagi setelah terhubung.")
    } finally {
      setBusy(false)
    }
  }
  async function cancelVisit() {
    if (!result || busy || savePending) return
    if (
      (complaint || treatment || followUp || detail) &&
      !window.confirm("Batalkan pencatatan UKS ini? Isian formulir tidak akan disimpan.")
    )
      return
    setBusy(true)
    try {
      await jsonRequest("/api/scan/visits", post({ eventId: result.id }, "DELETE"))
      setResult(null)
      setFormError("")
      void loadHistory()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Pencatatan belum dapat dibatalkan")
    } finally {
      setBusy(false)
    }
  }
  const cameraFailure = useCallback((message: string) => {
    setCameraError(message)
    setCamera(false)
  }, [])
  if (!cap)
    return (
      <PageContainer>
        <PageHeading title="Scan Siswa" description="Memuat akses pemindai…" />
        {fatal ? (
          <div className="space-y-3 rounded-xl border p-5">
            <p role="alert">{fatal}</p>
            <Button onClick={() => void refreshCapabilities()}>Coba hubungkan kembali</Button>
          </div>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </PageContainer>
    )
  const allowedScan = cap.attendance || cap.uks
  const success = result && ["PRESENT", "REPEAT", "SAVED"].includes(result.outcome)
  const canReadHistory = cap.historyAttendance || cap.historyUks
  return (
    <PageContainer>
      <PageHeading
        title="Scan Siswa"
        description="Satu kartu untuk kehadiran dan layanan sekolah."
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${online ? "bg-[var(--success)] text-[var(--success-foreground)]" : "bg-[var(--danger)] text-[var(--danger-foreground)]"}`}
          >
            {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
            {online ? "Server terhubung" : "Koneksi terputus"}
          </span>
        }
      />
      <div role="tablist" aria-label="Halaman scan" className="flex flex-wrap gap-1 border-b pb-3">
        {[
          { key: "scan", text: "Pemindai", show: allowedScan, icon: ScanLine },
          { key: "history", text: "Riwayat Scan", show: canReadHistory, icon: History },
          { key: "cards", text: "Kartu QR", show: cap.cards, icon: IdCard },
        ]
          .filter((t) => t.show)
          .map((t) => (
            <Button
              key={t.key}
              id={`tab-${t.key}`}
              aria-controls={`panel-${t.key}`}
              role="tab"
              aria-selected={tab === t.key}
              variant={tab === t.key ? "secondary" : "ghost"}
              onClick={() => changeTab(t.key)}
            >
              <t.icon />
              {t.text}
            </Button>
          ))}
      </div>
      {!online && (
        <div
          className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          <p>{fatal || "Koneksi terputus. Pemindaian dijeda; data belum dinyatakan tersimpan."}</p>
          <Button size="sm" variant="outline" onClick={() => void refreshCapabilities()}>
            Hubungkan kembali
          </Button>
        </div>
      )}
      {tab === "scan" && allowedScan && (
        <div id="panel-scan" role="tabpanel" aria-labelledby="tab-scan" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid w-full max-w-xs gap-2">
              <Label htmlFor="scan-mode">Tujuan scan</Label>
              <select
                id="scan-mode"
                className={selectClass}
                disabled={locked}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as ScanMode)
                  setResult(null)
                  setQuery("")
                  setMatches([])
                  setFormError("")
                }}
              >
                {cap.attendance && <option value="attendance">Kehadiran</option>}
                {cap.uks && <option value="uks">Kunjungan UKS</option>}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">{formatSchoolDate(today())}</p>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <section className="rounded-xl border bg-card" aria-label="Pemindai QR">
              <div className="p-5">
                <h2 className="font-semibold">Pindai kartu siswa</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "attendance"
                    ? "Kehadiran langsung tersimpan setelah QR terbaca."
                    : "Pindai siswa, lengkapi kunjungan, lalu simpan."}
                </p>
              </div>
              <div className={draft ? "hidden px-5 pb-5 lg:block" : "px-5 pb-5"}>
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
                  {(["CAMERA", "USB"] as const).map((s) => (
                    <Button
                      key={s}
                      variant={source === s ? "outline" : "ghost"}
                      disabled={locked}
                      aria-pressed={source === s}
                      onClick={() => {
                        setSource(s)
                        setCamera(false)
                        setCameraError("")
                        try {
                          localStorage.setItem("sismepda-scan-source", s)
                        } catch {
                          /* optional */
                        }
                      }}
                    >
                      {s === "CAMERA" ? <Camera /> : <Usb />}
                      {s === "CAMERA" ? "Kamera" : "Scanner USB"}
                    </Button>
                  ))}
                </div>
                {source === "CAMERA" ? (
                  <div className="space-y-3">
                    <CameraScanner
                      active={camera && tab === "scan"}
                      paused={locked || !online}
                      onCode={onCode}
                      onError={cameraFailure}
                    />
                    <Button
                      className="w-full"
                      variant={camera ? "outline" : "default"}
                      disabled={locked || !online}
                      onClick={() => {
                        setCameraError("")
                        setCamera(!camera)
                      }}
                    >
                      <Camera />
                      {camera ? "Hentikan kamera" : "Aktifkan kamera"}
                    </Button>
                    {cameraError && (
                      <p role="alert" className="text-sm text-destructive">
                        {cameraError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 rounded-lg border bg-secondary/40 p-4">
                    <Usb className="size-7 text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Hubungkan scanner 2D QR dalam mode keyboard, dengan suffix Enter otomatis.
                    </p>
                    <Label htmlFor="scanner-input">Input scanner</Label>
                    <Input
                      id="scanner-input"
                      ref={input}
                      autoComplete="off"
                      maxLength={180}
                      disabled={locked || !online}
                      placeholder="Menunggu QR + Enter otomatis…"
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return
                        e.preventDefault()
                        const code = e.currentTarget.value.trim()
                        e.currentTarget.value = ""
                        if (code && !locked && online)
                          void submitScan({ requestId: crypto.randomUUID(), mode, source: "USB", code })
                      }}
                    />
                    <p className="text-xs text-muted-foreground" role="status">
                      {locked
                        ? "Scanner dijeda selama pencatatan aktif."
                        : focused
                          ? "Input aktif · siap menerima scan"
                          : "Scanner belum siap · fokus tidak berada pada input"}
                    </p>
                    <Button size="sm" variant="outline" disabled={!online || locked || focused} onClick={() => input.current?.focus()}>
                      {focused ? "Scanner aktif" : "Aktifkan scanner"}
                    </Button>
                  </div>
                )}
                <details className="mt-5 border-t pt-4">
                  <summary className="text-sm text-primary">Kartu tidak terbaca? Cari siswa</summary>
                  <div className="mt-3 space-y-3">
                    <Label htmlFor="scan-search">Nama, NIS, atau NISN</Label>
                    <Input
                      id="scan-search"
                      value={query}
                      disabled={locked || !online}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Ketik minimal 2 karakter"
                    />
                    <div>
                      {matches.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                          disabled={locked || !online}
                          onClick={() =>
                            void submitScan({ requestId: crypto.randomUUID(), mode, source: "MANUAL", studentId: s.id })
                          }
                        >
                          <span>
                            {s.name}
                            <small className="block text-xs text-muted-foreground">
                              {s.className} · {s.nis ? `NIS ${s.nis}` : `NISN ${s.nisn ?? "—"}`}
                            </small>
                          </span>
                          <Search className="size-4 shrink-0" />
                        </button>
                      ))}
                    </div>
                    {query.length >= 2 && searchError && <p className="text-xs text-muted-foreground">{searchError}</p>}
                  </div>
                </details>
              </div>
              <div className="flex gap-2 border-t px-5 py-4 text-xs text-muted-foreground">
                <ShieldCheck className="size-4 shrink-0" />
                <span>
                  {draft
                    ? "Scanner dijeda sampai kunjungan disimpan atau dibatalkan."
                    : "Scan ulang tetap dicatat. Kehadiran dihitung satu kali per hari."}
                </span>
              </div>
            </section>
            <div className="space-y-5">
              <section className="rounded-xl border bg-card p-5" aria-label="Hasil scan">
                <h2 className="font-semibold">{draft ? "Catat kunjungan UKS" : "Hasil scan terakhir"}</h2>
                <div aria-live="polite">
                  {!result && !busy && (
                    <div className="py-12 text-center">
                      <ScanLine className="mx-auto mb-3 size-7 text-primary" />
                      <h3 className="text-sm font-medium">Siap menerima siswa</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Identitas dan hasil pencatatan muncul di sini.
                      </p>
                    </div>
                  )}
                  {busy && !draft && (
                    <p className="flex items-center gap-2 py-5 text-sm">
                      <Loader2 className="size-4 animate-spin" />
                      Memproses scan…
                    </p>
                  )}
                  {result && !draft && (
                    <div
                      className={`mt-4 rounded-lg p-4 ${success ? "bg-[var(--success)] text-[var(--success-foreground)]" : "bg-amber-50 text-amber-900"}`}
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        {success ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
                        {SCAN_OUTCOMES[result.outcome] ?? result.outcome}
                      </h3>
                      <p className="mt-2 text-xs">
                        {result.outcome === "PRESENT" && "Hadir sudah tercatat di absensi SISMEPDA."}
                        {result.outcome === "REPEAT" &&
                          (result.firstSeenAt
                            ? `Kehadiran pertama pukul ${formatTime(new Date(result.firstSeenAt))} ${timeZoneLabel} tetap berlaku.`
                            : "Status hadir tetap berlaku. Tidak ada kehadiran ganda.")}
                        {result.outcome === "CONFLICT" &&
                          `Status saat ini ${result.existingStatus}. Tidak diubah otomatis; koreksi melalui Input Absensi.`}
                        {result.outcome === "UNKNOWN" &&
                          "Gunakan kartu SISMEPDA yang aktif atau cari siswa secara manual."}
                        {result.outcome === "HOLIDAY" &&
                          "Hari ini ditandai libur. Scan dicatat tanpa membuat kehadiran."}
                        {result.outcome === "OUTSIDE_WINDOW" &&
                          "Scan dicatat tanpa membuat kehadiran. Periksa jam buka/tutup dan auto-lock pada Pengaturan."}
                        {result.outcome === "SAVED" &&
                          (result.notifyStatus === "SENT"
                            ? "WhatsApp terkirim ke wali kelas."
                            : (result.notifyError ?? "Notifikasi belum dikirim. Periksa kunjungan melalui E-UKS."))}
                      </p>
                    </div>
                  )}
                  {result?.student && (
                    <div className="my-5 flex items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {result.student.name
                          .split(" ")
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold">{result.student.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {result.student.className} ·{" "}
                          {result.student.nis ? `NIS ${result.student.nis}` : `NISN ${result.student.nisn ?? "—"}`}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Scan {formatTime(new Date(result.scannedAt))} {timeZoneLabel}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {formError && (
                  <p role="alert" className="my-3 text-sm text-destructive">
                    {formError}
                  </p>
                )}
                {pending && (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm">
                      Hasil scan belum terkonfirmasi. Permintaan yang sama akan diperiksa kembali tanpa menggandakan
                      pencatatan.
                    </p>
                    <Button disabled={busy || !online} onClick={() => void submitScan(pending)}>
                      Coba proses lagi
                    </Button>
                  </div>
                )}
                {draft && (
                  <form
                    ref={form}
                    onSubmit={(e) => {
                      e.preventDefault()
                      void saveVisit()
                    }}
                    className="space-y-4"
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="uks-complaint">
                        Keluhan <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="uks-complaint"
                        ref={complaintInput}
                        list="scan-complaints"
                        required
                        minLength={2}
                        maxLength={500}
                        value={complaint}
                        disabled={busy || savePending}
                        onChange={(e) => setComplaint(e.target.value)}
                        placeholder="Pilih atau tuliskan keluhan"
                      />
                      <datalist id="scan-complaints">
                        {cap.complaints.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="uks-treatment">
                        Tindakan <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="uks-treatment"
                        required
                        minLength={2}
                        maxLength={500}
                        value={treatment}
                        disabled={busy || savePending}
                        onChange={(e) => setTreatment(e.target.value)}
                        placeholder="Tuliskan tindakan yang diberikan"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="uks-follow-up">
                        Tindak lanjut <span className="text-destructive">*</span>
                      </Label>
                      <select
                        id="uks-follow-up"
                        className={selectClass}
                        required
                        disabled={busy || savePending}
                        value={followUp}
                        onChange={(e) => setFollowUp(e.target.value)}
                      >
                        <option value="">Pilih kondisi selanjutnya</option>
                        {followUps.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    {(followUp === "Lainnya" || detail) && (
                      <div className="grid gap-2">
                        <Label htmlFor="uks-detail">Rincian tindak lanjut</Label>
                        <Textarea
                          id="uks-detail"
                          required={followUp === "Lainnya"}
                          minLength={2}
                          maxLength={300}
                          disabled={busy || savePending}
                          value={detail}
                          onChange={(e) => setDetail(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="rounded-lg bg-secondary p-3 text-sm">
                      <p className="font-medium">
                        {cap.notify
                          ? "Pemberitahuan otomatis ke wali kelas"
                          : "Pengiriman memerlukan izin notifikasi UKS"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result?.student?.homeroomName ?? "Wali kelas belum ditetapkan"}
                        {cap.notify && !result?.student?.recipientReady
                          ? " · Nomor penerima belum siap. Kunjungan tetap dapat disimpan."
                          : ""}
                      </p>
                    </div>
                    {savePending && (
                      <p role="status" className="text-sm text-muted-foreground">
                        Isian dikunci sampai hasil simpan terkonfirmasi. Coba simpan lagi setelah terhubung.
                      </p>
                    )}
                    <Button className="min-h-11 w-full" type="submit" disabled={busy || !online}>
                      <Save />
                      {busy
                        ? "Menyimpan…"
                        : savePending
                          ? "Periksa / coba simpan lagi"
                          : cap.notify
                            ? "Simpan & beri tahu wali kelas"
                            : "Simpan kunjungan"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || savePending || !online}
                      onClick={() => void cancelVisit()}
                    >
                      Batalkan pencatatan
                    </Button>
                  </form>
                )}
                {result?.visitId && !draft && cap.historyUks && (
                  <Button className="mt-4" variant="outline" render={<Link href="/e-uks/riwayat-kunjungan" />}>
                    Buka riwayat UKS / notifikasi
                  </Button>
                )}
              </section>
              {canReadHistory && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">Riwayat scan</h2>
                    <Button size="sm" variant="ghost" disabled={locked} onClick={() => changeTab("history")}>
                      Lihat semua
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Riwayat mengikuti izin baca dan scope kelas akun Anda. Scan baru langsung masuk ke absensi atau
                    E-UKS setelah tersimpan.
                  </p>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
      {tab === "history" && canReadHistory && (
        <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="history-mode">Tujuan</Label>
              <select
                id="history-mode"
                className={selectClass}
                value={historyMode}
                onChange={(e) => {
                  setHistoryMode(e.target.value as ScanMode)
                  setPage(1)
                }}
              >
                {cap.historyAttendance && <option value="attendance">Kehadiran</option>}
                {cap.historyUks && <option value="uks">Kunjungan UKS</option>}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="history-date">Tanggal</Label>
              <Input
                id="history-date"
                type="date"
                value={date}
                onChange={(e) => {
                  if (parseSchoolDate(e.target.value)) {
                    setDate(e.target.value)
                    setPage(1)
                  }
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="history-search">Cari siswa</Label>
              <Input
                id="history-search"
                value={historyQuery}
                onChange={(e) => {
                  setHistoryQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="Nama, NIS, NISN"
              />
            </div>
          </div>
          {historyError && (
            <p role="alert" className="text-sm text-destructive">
              {historyError}
            </p>
          )}
          <div className="divide-y rounded-xl border bg-card px-4">
            {rows.length ? (
              rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-4">
                  <span className="min-w-20 text-xs tabular-nums text-muted-foreground">
                    {formatTime(new Date(r.scannedAt))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {r.student?.name ?? "QR tidak dikenal / identitas tidak tersedia"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.className ?? "—"} ·{" "}
                      {r.source === "CAMERA" ? "Kamera" : r.source === "USB" ? "Scanner USB" : "Input manual"} ·{" "}
                      {r.actorName}
                    </p>
                  </div>
                  <span className="rounded-md bg-secondary px-2 py-1 text-xs">
                    {SCAN_OUTCOMES[r.outcome] ?? r.outcome}
                    {r.visit?.notifyStatus ? ` · WA ${r.visit.notifyStatus}` : ""}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-9 text-center text-sm text-muted-foreground">Belum ada scan untuk filter ini.</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Sebelumnya
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Berikutnya
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Waktu mengikuti zona sekolah ({timeZoneLabel}). Pembukaan formulir UKS belum berarti kunjungan tersimpan.
          </p>
        </div>
      )}
      {cap.cards && (
        <div id="panel-cards" role="tabpanel" aria-labelledby="tab-cards" hidden={tab !== "cards"}>
          <ScanCards schoolName={cap.schoolName} schoolLogoUrl={cap.schoolLogoUrl} />
        </div>
      )}
      <ScanFeedbackPopup feedback={feedback} onDismiss={dismissFeedback} />
    </PageContainer>
  )
}
