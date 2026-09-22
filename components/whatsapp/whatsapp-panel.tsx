"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CONNECTION_STATE_DESCRIPTIONS,
  CONNECTION_STATE_LABELS,
  connectionActionsFor,
  type WhatsAppConnectionAction,
  type WhatsAppConnectionState,
  type WhatsAppStatus,
} from "@/lib/whatsapp-transport"
import {
  WHATSAPP_SCHEDULE,
  formatSlots,
  type WhatsAppMessageType,
} from "@/lib/whatsapp-schedule"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { normalizeSlots, slotsErrorMessage } from "@/lib/whatsapp-slot-config"
import { WhatsAppTemplateEditor } from "@/components/whatsapp/whatsapp-template-editor"
import {
  customizedKeys,
  effectiveTemplateSet,
  parseStoredTemplates,
} from "@/lib/whatsapp-template-store"
// Modul murni tanpa Prisma/pg, jadi aman diimpor komponen klien. Label tujuan
// dihitung fungsi bersama agar layar dan server tidak pernah berbeda pendapat
// tentang tujuan mana yang sedang berlaku.
import {
  STALE_DESTINATION_MESSAGE,
  destinationDisplay,
  type DestinationMode,
} from "@/lib/whatsapp-target"
import type { WhatsAppGroup } from "@/lib/whatsapp-transport"

/**
 * Panel WhatsApp Otomatis.
 *
 * Komponen ini hanya mengimpor modul murni (`whatsapp-transport`,
 * `whatsapp-schedule`) — keduanya tidak menyentuh Prisma. Mengimpor
 * `lib/server-*` dari sini akan menarik `pg` ke bundel klien dan memecahkan
 * `next build`.
 */

/**
 * Payload status yang diterima klien.
 *
 * Diturunkan dari {@link WhatsAppStatus} lewat `Omit`, bukan ditulis ulang.
 * Definisi manual pernah melenceng dari kontrak — `lastError` sempat dideklarasi
 * `string | null` di sini sementara worker sudah mengirim `{ code, message }`,
 * sehingga React menerima object sebagai child dan seluruh halaman gagal dimuat.
 * Dengan `Omit`, perubahan kontrak berikutnya menjadi error TypeScript.
 *
 * `qr` dibuang karena route status memang menanggalkannya (`withoutQr`); QR
 * diambil terpisah lewat `/api/whatsapp/qr` sebagai data URL.
 */
type StatusPayload = Omit<WhatsAppStatus, "qr">

type ScheduleRow = {
  type: WhatsAppMessageType
  label: string
  slot: string
  status: "SENT" | "FAILED" | "SKIPPED" | "NOT_YET"
  sentAt: string | null
  errorMessage: string | null
}

type HistoryRow = {
  id: string
  type: WhatsAppMessageType
  trigger: "SCHEDULED" | "MANUAL"
  status: "SENT" | "FAILED" | "SKIPPED"
  scheduledSlot: string | null
  schoolDate: string
  targetGroupName: string | null
  errorCode: string | null
  errorMessage: string | null
  attemptedAt: string
  sentAt: string | null
  initiatedBy: { name: string | null; email: string } | null
}

/**
 * Kartu pesan sebagaimana dikirim server.
 *
 * `builtinType` bernilai null untuk kartu manual dan kartu buatan admin; layar
 * ini masih menampilkan kartu bawaan saja, sehingga kartu tanpa jenis disaring
 * di satu tempat (`builtinConfigurations`) alih-alih di setiap pemakaian.
 */
type MessageRow = {
  id: string
  kind: "BUILTIN" | "CUSTOM" | "MANUAL"
  builtinType: WhatsAppMessageType | null
  title: string
  description: string | null
  sortOrder: number
  enabled: boolean
  destinationMode: DestinationMode
  targetGroupJid: string | null
  targetGroupName: string | null
  slots: string[]
  messageTemplates?: unknown
}

type ConfigurationRow = {
  type: WhatsAppMessageType
  enabled: boolean
  destinationMode: DestinationMode
  targetGroupJid: string | null
  targetGroupName: string | null
  slots: string[]
  /** JSON mentah dari server; selalu lewat `parseStoredTemplates`. */
  messageTemplates?: unknown
}

type DefaultDestinationPayload = {
  jid: string | null
  name: string | null
}

/** Nilai sentinel pilihan "ikut grup default" di dalam Select. */
const USE_DEFAULT = "__default__"

export type WhatsAppPanelProps = {
  canManageConnection: boolean
  canSend: boolean
}

const STATE_VARIANT: Record<WhatsAppConnectionState, "default" | "secondary" | "destructive"> = {
  CONNECTED: "default",
  CONNECTING: "secondary",
  WAITING_QR: "secondary",
  UNPAIRED: "secondary",
  // Putus sementara masih memegang penautan yang sah, jadi ia bukan kegagalan
  // semerah sesi yang benar-benar tidak sah lagi.
  DISCONNECTED: "secondary",
  LOGGED_OUT: "destructive",
  ERROR: "destructive",
}

const SEND_STATUS_LABELS: Record<string, string> = {
  PROCESSING: "Sedang dikirim",
  SENT: "Terkirim",
  FAILED: "Gagal",
  SKIPPED: "Dilewati",
  NOT_YET: "Belum waktunya",
}

const ACTION_SUCCESS: Record<WhatsAppConnectionAction, string> = {
  connect: "Permintaan penautan dikirim. Kode QR akan muncul sebentar lagi.",
  reconnect: "Permintaan sambung ulang dikirim.",
  relogin: "Sesi lama dihapus. Kode QR baru akan muncul sebentar lagi.",
  logout: "Sesi WhatsApp dihapus. Penautan ulang diperlukan.",
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function WhatsAppPanel({ canManageConnection, canSend }: WhatsAppPanelProps) {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [configurations, setConfigurations] = useState<ConfigurationRow[]>([])
  // `null` = daftar grup tidak diketahui (belum terhubung / fetch gagal).
  // Dibedakan dari `[]` yang berarti benar-benar tidak ada grup.
  const [groups, setGroups] = useState<WhatsAppGroup[] | null>(null)
  const [defaultDestination, setDefaultDestination] = useState<DefaultDestinationPayload>({
    jid: null,
    name: null,
  })
  const [refreshingGroups, setRefreshingGroups] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, configResponse] = await Promise.all([
        fetch("/api/whatsapp", { cache: "no-store" }),
        fetch("/api/whatsapp/configuration", { cache: "no-store" }),
      ])
      if (statusResponse.ok) {
        const data = await statusResponse.json()
        setStatus(data.status)
        setSchedule(data.schedule ?? [])
        setHistory(data.history ?? [])
      }
      if (configResponse.ok) {
        const data = await configResponse.json()
        // Server kini mengirim kartu pesan. Kartu bawaan dipetakan ke bentuk
        // yang dipakai layar ini; kartu manual dan kartu buatan admin belum
        // ditampilkan di sini.
        const messages: MessageRow[] = data.messages ?? []
        setConfigurations(
          messages
            .filter((row): row is MessageRow & { builtinType: WhatsAppMessageType } =>
              row.builtinType !== null,
            )
            .map((row) => ({
              type: row.builtinType,
              enabled: row.enabled,
              destinationMode: row.destinationMode,
              targetGroupJid: row.targetGroupJid,
              targetGroupName: row.targetGroupName,
              slots: row.slots,
              messageTemplates: row.messageTemplates,
            })),
        )
        setDefaultDestination(data.defaultDestination ?? { jid: null, name: null })
        // Daftar grup hanya ditimpa bila server benar-benar mengirim daftar.
        // Pengambilan yang gagal mengirim `null`, dan menimpakannya akan
        // mengosongkan pilihan yang sedang dilihat admin.
        if (data.groups) setGroups(data.groups)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Status koneksi berubah tanpa interaksi pengguna (putus, reconnect,
    // pengiriman terjadwal), jadi layar menariknya berkala. 10 detik cukup
    // responsif untuk pairing QR tanpa membebani worker.
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  // QR hanya ditarik saat memang sedang menunggu pemindaian, dan hanya oleh
  // pemegang izin kelola koneksi.
  useEffect(() => {
    if (!canManageConnection || status?.state !== "WAITING_QR") {
      setQr(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const response = await fetch("/api/whatsapp/qr", { cache: "no-store" })
      if (!response.ok || cancelled) return
      const data = await response.json()
      // Yang diterima sudah berupa data URL gambar; payload mentah tidak
      // pernah meninggalkan server.
      if (!cancelled) setQr(data.qrImage ?? null)
    }
    void load()
    // WhatsApp merotasi QR setiap ±20 detik; interval 5 detik menjaga gambar
    // di layar tetap yang sedang berlaku.
    const timer = setInterval(() => void load(), 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [canManageConnection, status?.state])

  const runConnectionAction = async (action: WhatsAppConnectionAction) => {
    setBusy(action)
    try {
      const response = await fetch("/api/whatsapp/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Aksi koneksi gagal.")
        return
      }
      toast.success(ACTION_SUCCESS[action])
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const sendNow = async (type: WhatsAppMessageType) => {
    setBusy(`send:${type}`)
    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Pengiriman gagal.")
        return
      }
      if (data.status === "SENT") toast.success("Pesan terkirim ke grup.")
      else if (data.status === "SKIPPED") toast.warning(data.detail ?? "Pengiriman dilewati.")
      else toast.error(data.message ?? "Pengiriman gagal.")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const toggleSchedule = async (type: WhatsAppMessageType, enabled: boolean) => {
    setBusy(`toggle:${type}`)
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Perubahan gagal disimpan.")
        return
      }
      toast.success(enabled ? "Pengiriman otomatis diaktifkan." : "Pengiriman otomatis dinonaktifkan.")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  /** Ambil ulang daftar grup dari koneksi aktif. */
  const refreshGroups = async () => {
    setRefreshingGroups(true)
    try {
      const response = await fetch("/api/whatsapp/configuration", { cache: "no-store" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Daftar grup gagal dimuat.")
        return
      }
      // Kegagalan pengambilan TIDAK menghapus pilihan tersimpan: `groups`
      // dibiarkan seperti semula agar konfigurasi yang sudah benar tidak
      // terlihat rusak hanya karena WhatsApp sedang tidak dapat ditanya.
      if (!data.groups) {
        toast.error("Daftar grup belum dapat dimuat. Pastikan WhatsApp terhubung.")
        return
      }
      setGroups(data.groups)
      toast.success(`Daftar grup diperbarui (${data.groups.length} grup).`)
    } finally {
      setRefreshingGroups(false)
    }
  }

  /** Simpan grup tujuan default. */
  const saveDefaultDestination = async (jid: string | null) => {
    const group = groups?.find((row) => row.jid === jid) ?? null
    setBusy("default-destination")
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "default",
          destination: jid ? { jid, name: group?.name } : null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Grup tujuan gagal disimpan.")
        return
      }
      toast.success("Grup tujuan default disimpan.")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  /**
   * Simpan tujuan satu jenis laporan.
   *
   * Memilih "Gunakan grup default" hanya mengubah MODE; JID override yang
   * pernah dipilih sengaja dibiarkan tersimpan, sehingga admin yang kembali ke
   * override tidak perlu memilih ulang dari awal.
   */
  const saveReportDestination = async (type: WhatsAppMessageType, value: string) => {
    const useDefault = value === USE_DEFAULT
    const group = groups?.find((row) => row.jid === value) ?? null
    setBusy(`destination:${type}`)
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          destinationMode: useDefault ? "DEFAULT" : "OVERRIDE",
          ...(useDefault ? {} : { destination: { jid: value, name: group?.name } }),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Grup tujuan gagal disimpan.")
        return
      }
      toast.success("Grup tujuan disimpan.")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  /**
   * Simpan jadwal satu jenis laporan.
   *
   * Normalisasi (urut, buang duplikat, tolak format salah) dilakukan fungsi
   * murni yang sama dengan yang dipakai server, sehingga yang terlihat di layar
   * setelah menyimpan sama dengan yang benar-benar tersimpan.
   */
  const saveSlots = async (type: WhatsAppMessageType, slots: string[]) => {
    const normalized = normalizeSlots(slots)
    if (!normalized.ok) {
      toast.error(slotsErrorMessage(normalized.error))
      return
    }

    setBusy(`slots:${type}`)
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, slots: normalized.slots }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.message ?? "Jadwal gagal disimpan.")
        return
      }
      toast.success("Jadwal disimpan.")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Memuat status WhatsApp…</p>
  }

  const state = status?.state ?? "ERROR"
  // Tombol ditentukan satu fungsi murni yang diuji terpisah, bukan oleh
  // rangkaian ternary di dalam JSX. "Hubungkan" dan "Sambungkan ulang" tidak
  // pernah muncul bersamaan: keduanya berarti hal berbeda, dan menampilkan
  // keduanya memaksa admin menebak mana yang benar.
  const actions = connectionActionsFor(state, status?.sessionExists ?? false)

  // Grup hanya dapat dibaca dari sesi yang hidup, jadi selector mengikuti
  // keadaan koneksi, bukan sekadar ada-tidaknya daftar di memori.
  const connected = state === "CONNECTED"
  const defaultGroupLive = groups?.find((group) => group.jid === defaultDestination.jid) ?? null
  const defaultDestinationLabel = defaultDestination.jid
    ? // Nama terbaru menang atas snapshot: nama grup dapat berubah, dan yang
      // ingin dilihat admin adalah nama grup hari ini.
      (defaultGroupLive?.name ?? defaultDestination.name ?? "Grup tersimpan")
    : "Belum dipilih"
  const defaultDestinationStale =
    defaultDestination.jid !== null && groups !== null && defaultGroupLive === null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Status koneksi</CardTitle>
          <Badge variant={STATE_VARIANT[state]}>{CONNECTION_STATE_LABELS[state]}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Kalimat tindakan lebih dulu, karena itulah yang dibutuhkan admin.
              Enum internal seperti LOGGED_OUT tidak pernah menjadi informasi
              utama; ia tersedia di bagian detail teknis di bawah. */}
          <p className="text-sm">{CONNECTION_STATE_DESCRIPTIONS[state]}</p>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Nomor terhubung</dt>
              <dd className="font-medium">{status?.phoneNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Nama profil</dt>
              <dd className="font-medium">{status?.displayName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Terhubung sejak</dt>
              <dd className="font-medium">{formatDateTime(status?.connectedSince ?? null)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Terakhir terputus</dt>
              <dd className="font-medium">{formatDateTime(status?.lastDisconnectedAt ?? null)}</dd>
            </div>
          </dl>

          {status?.lastDisconnectReason ? (
            <p className="text-muted-foreground text-sm">
              Alasan terputus: {status.lastDisconnectReason}
            </p>
          ) : null}

          {status?.lastError ? (
            <p className="text-destructive text-sm">{status.lastError.message}</p>
          ) : null}

          {/* Detail teknis dipisahkan dan tertutup secara bawaan. Admin
              membutuhkan kalimat tindakan; penelusur masalah membutuhkan kode
              persis, dan keduanya tidak boleh saling mengaburkan. Isinya hanya
              metadata — tidak ada kredensial maupun payload QR. */}
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer select-none">Detail teknis</summary>
            <dl className="mt-2 grid gap-1 font-mono">
              <div>Status: {state}</div>
              <div>Sesi tersimpan: {status?.sessionExists ? "ya" : "tidak"}</div>
              <div>Kategori putus terakhir: {status?.lastDisconnectCategory ?? "—"}</div>
              <div>Kode kesalahan: {status?.lastError?.code ?? "—"}</div>
              <div>Detak terakhir: {formatDateTime(status?.lastHeartbeatAt ?? null)}</div>
            </dl>
          </details>

          {qr ? (
            <div className="rounded-md border p-4">
              <p className="mb-2 text-sm font-medium">Pindai kode ini dari WhatsApp ponsel sekolah</p>
              <ol className="text-muted-foreground mb-3 list-decimal space-y-0.5 pl-5 text-xs">
                <li>Buka WhatsApp di ponsel sekolah</li>
                <li>Masuk ke menu Perangkat tertaut</li>
                <li>Pilih Tautkan perangkat, lalu arahkan kamera ke kode di bawah</li>
              </ol>
              {/*
                Gambar QR dirender di server sebagai data URL. `next/image`
                sengaja tidak dipakai: sumbernya data URL yang berubah tiap
                beberapa detik, bukan aset yang perlu dioptimalkan. Latar putih
                dipaksa karena pemindai membutuhkan kontras gelap-di-terang,
                yang akan hilang pada tema gelap.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="Kode QR untuk menautkan perangkat WhatsApp"
                width={288}
                height={288}
                className="rounded bg-white p-2"
              />
              <p className="text-muted-foreground mt-2 text-xs">
                Kode berganti otomatis setiap beberapa detik selama halaman terbuka.
              </p>
            </div>
          ) : null}

          {canManageConnection ? (
            <>
              <Separator />
              <div className="flex flex-wrap gap-2">
                {actions.map((descriptor) => (
                  <Button
                    key={descriptor.action}
                    size="sm"
                    variant={descriptor.variant}
                    disabled={busy !== null || descriptor.disabled === true}
                    onClick={() => void runConnectionAction(descriptor.action)}
                  >
                    {busy === descriptor.action ? descriptor.busyLabel : descriptor.label}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jadwal pengiriman</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">Grup tujuan default</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={defaultDestination.jid ?? ""}
                disabled={!canManageConnection || !connected || busy !== null}
                onValueChange={(value) => void saveDefaultDestination(String(value))}
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Pilih grup WhatsApp">
                    {defaultDestinationLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(groups ?? []).map((group) => (
                    <SelectItem key={group.jid} value={group.jid}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canManageConnection ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || refreshingGroups}
                  onClick={() => void refreshGroups()}
                >
                  {refreshingGroups ? "Memuat…" : "Muat ulang grup"}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {connected
                ? "Digunakan oleh jadwal yang tidak memiliki grup khusus."
                : "Hubungkan WhatsApp terlebih dahulu untuk memilih grup."}
            </p>
            {defaultDestinationStale ? (
              <p className="text-destructive text-xs">{STALE_DESTINATION_MESSAGE}</p>
            ) : null}
          </div>

          <Separator />

          {WHATSAPP_SCHEDULE.map((definition) => {
            const configuration = configurations.find((row) => row.type === definition.type)
            const slots = schedule.filter((row) => row.type === definition.type)
            const reportDestination = {
              mode: configuration?.destinationMode ?? "DEFAULT",
              jid: configuration?.targetGroupJid ?? null,
              name: configuration?.targetGroupName ?? null,
            }
            const display = destinationDisplay(
              reportDestination,
              { jid: defaultDestination.jid, name: defaultDestination.name },
              groups,
            )
            // Tujuan yang belum sah membuat pengiriman mustahil, jadi tombolnya
            // dimatikan lebih dulu — lebih jujur daripada membiarkan admin
            // menekan tombol yang sudah pasti gagal.
            const destinationReady = display.kind !== "MISSING"
            // Jadwal berasal dari database, bukan dari konstanta di kode.
            const configuredSlots = configuration?.slots ?? []

            return (
              <div key={definition.type} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{definition.label}</p>
                    <p className="text-muted-foreground text-sm">{definition.description}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {configuredSlots.length > 0 ? formatSlots(configuredSlots) : "Jadwal belum diatur"} · Grup:{" "}
                      {display.kind === "DEFAULT"
                        ? `Gunakan grup default (${display.label})`
                        : display.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {canManageConnection ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={configuration?.enabled ?? false}
                          disabled={busy !== null || (!destinationReady && !configuration?.enabled)}
                          onCheckedChange={(checked) =>
                            void toggleSchedule(definition.type, checked === true)
                          }
                        />
                        Otomatis
                      </label>
                    ) : (
                      <Badge variant={configuration?.enabled ? "default" : "secondary"}>
                        {configuration?.enabled ? "Otomatis aktif" : "Otomatis nonaktif"}
                      </Badge>
                    )}
                    {canSend ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !destinationReady}
                        title={
                          destinationReady ? undefined : "Pilih grup tujuan terlebih dahulu."
                        }
                        onClick={() => void sendNow(definition.type)}
                      >
                        {busy === `send:${definition.type}` ? "Mengirim…" : "Kirim sekarang"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {canManageConnection ? (
                  <div className="space-y-1">
                    <Select
                      value={
                        reportDestination.mode === "OVERRIDE" && reportDestination.jid
                          ? reportDestination.jid
                          : USE_DEFAULT
                      }
                      disabled={!connected || busy !== null}
                      onValueChange={(value) =>
                        void saveReportDestination(definition.type, String(value))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-72">
                        {/*
                          Label WAJIB ditulis sebagai anak SelectValue. Tanpa
                          anak, komponen menampilkan value mentahnya — dan value
                          di sini adalah JID, yang tidak berarti apa pun bagi
                          admin. JID tetap menjadi identitas yang disimpan.
                        */}
                        <SelectValue>
                          {reportDestination.mode === "OVERRIDE"
                            ? display.label
                            : "Gunakan grup default"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={USE_DEFAULT}>Gunakan grup default</SelectItem>
                        {(groups ?? []).map((group) => (
                          <SelectItem key={group.jid} value={group.jid}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {display.kind === "STALE" ? (
                      <p className="text-destructive text-xs">{STALE_DESTINATION_MESSAGE}</p>
                    ) : null}
                  </div>
                ) : null}

                {canManageConnection ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Jadwal</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {configuredSlots.map((slot, index) => (
                        <div key={`${slot}-${index}`} className="flex items-center gap-1">
                          <Input
                            type="time"
                            value={slot}
                            className="w-28"
                            disabled={busy !== null}
                            onChange={(event) => {
                              const next = [...configuredSlots]
                              next[index] = event.target.value
                              void saveSlots(definition.type, next)
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() =>
                              void saveSlots(
                                definition.type,
                                configuredSlots.filter((_, position) => position !== index),
                              )
                            }
                          >
                            Hapus
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void saveSlots(definition.type, [...configuredSlots, "07:00"])}
                      >
                        + Tambah waktu
                      </Button>
                    </div>
                    {configuredSlots.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Tanpa jadwal, pengiriman otomatis tidak akan berjalan untuk laporan ini.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <Badge
                      key={slot.slot}
                      variant={
                        slot.status === "SENT"
                          ? "default"
                          : slot.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                      className="font-normal"
                      title={slot.errorMessage ?? undefined}
                    >
                      {slot.slot} · {SEND_STATUS_LABELS[slot.status] ?? slot.status}
                    </Badge>
                  ))}
                </div>

                {canManageConnection ? (
                  <details className="rounded-md border p-3">
                    {/* Ditutup secara bawaan: editor template cukup panjang, dan
                        halaman ini terutama dipakai untuk memantau pengiriman,
                        bukan menyunting teks setiap hari. */}
                    <summary className="cursor-pointer text-sm font-medium">
                      Format Pesan Otomatis
                    </summary>
                    <div className="pt-3">
                      <WhatsAppTemplateEditor
                        type={definition.type}
                        templates={effectiveTemplateSet(
                          parseStoredTemplates(configuration?.messageTemplates),
                        )}
                        customized={customizedKeys(
                          parseStoredTemplates(configuration?.messageTemplates),
                        )}
                        disabled={busy !== null}
                        onSaved={() => void refresh()}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histori pengiriman</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada pengiriman.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Pemicu</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Grup</TableHead>
                    <TableHead>Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => (
                    <TableRow key={row.id} className="align-top">
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(row.sentAt ?? row.attemptedAt)}
                      </TableCell>
                      <TableCell>
                        {WHATSAPP_SCHEDULE.find((d) => d.type === row.type)?.label ?? row.type}
                        {row.scheduledSlot ? (
                          <span className="text-muted-foreground"> · {row.scheduledSlot}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {row.trigger === "MANUAL" ? "Manual" : "Terjadwal"}
                        </Badge>
                        {row.initiatedBy ? (
                          <div className="text-muted-foreground mt-1 text-xs">
                            {row.initiatedBy.name ?? row.initiatedBy.email}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "SENT"
                              ? "default"
                              : row.status === "FAILED"
                                ? "destructive"
                                : "secondary"
                          }
                          className="font-normal"
                        >
                          {SEND_STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.targetGroupName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs text-sm">
                        {row.errorMessage ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
