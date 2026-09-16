"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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

type ConfigurationRow = {
  type: WhatsAppMessageType
  enabled: boolean
  targetGroupName: string | null
}

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
        setConfigurations(data.configurations ?? [])
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

  if (loading) {
    return <p className="text-muted-foreground text-sm">Memuat status WhatsApp…</p>
  }

  const state = status?.state ?? "ERROR"
  // Tombol ditentukan satu fungsi murni yang diuji terpisah, bukan oleh
  // rangkaian ternary di dalam JSX. "Hubungkan" dan "Sambungkan ulang" tidak
  // pernah muncul bersamaan: keduanya berarti hal berbeda, dan menampilkan
  // keduanya memaksa admin menebak mana yang benar.
  const actions = connectionActionsFor(state, status?.sessionExists ?? false)

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
          {WHATSAPP_SCHEDULE.map((definition) => {
            const configuration = configurations.find((row) => row.type === definition.type)
            const slots = schedule.filter((row) => row.type === definition.type)

            return (
              <div key={definition.type} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{definition.label}</p>
                    <p className="text-muted-foreground text-sm">{definition.description}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatSlots(definition.slots)} · Grup:{" "}
                      {configuration?.targetGroupName ?? "belum dipilih"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {canManageConnection ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={configuration?.enabled ?? false}
                          disabled={busy !== null}
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
                        disabled={busy !== null}
                        onClick={() => void sendNow(definition.type)}
                      >
                        {busy === `send:${definition.type}` ? "Mengirim…" : "Kirim sekarang"}
                      </Button>
                    ) : null}
                  </div>
                </div>

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
