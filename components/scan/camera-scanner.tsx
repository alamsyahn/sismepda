"use client"

import { useEffect, useRef, useState } from "react"
import type QrScanner from "qr-scanner"
import { Camera, SwitchCamera, Flashlight } from "lucide-react"
import { Button } from "@/components/ui/button"

function enableContinuousFocus(video: HTMLVideoElement) {
  const stream = video.srcObject
  if (!(stream instanceof MediaStream)) return
  const track = stream.getVideoTracks()[0]
  if (!track) return
  const capabilities = track.getCapabilities?.() as
    | (MediaTrackCapabilities & { focusMode?: string[] })
    | undefined
  if (!capabilities?.focusMode?.includes("continuous")) return

  const focus: MediaTrackConstraintSet & { focusMode: string } = { focusMode: "continuous" }
  const constraints = track.getConstraints()
  void track
    .applyConstraints({ ...constraints, advanced: [...(constraints.advanced ?? []), focus] })
    .catch(() => {
      // The scanner can keep using the camera's default focus mode.
    })
}

export function CameraScanner({
  active,
  paused,
  onCode,
  onError,
}: {
  active: boolean
  paused: boolean
  onCode: (code: string) => void
  onError: (message: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null),
    overlay = useRef<HTMLDivElement>(null),
    instance = useRef<QrScanner | null>(null)
  const callbacks = useRef({ onCode, onError }),
    preferred = useRef<"environment" | "user">("environment")
  const [flash, setFlash] = useState(false),
    [ready, setReady] = useState(false)
  const [facing, setFacing] = useState<"environment" | "user">("environment")
  useEffect(() => {
    callbacks.current = { onCode, onError }
  }, [onCode, onError])
  useEffect(() => {
    if (!active || !video.current) return
    let disposed = false,
      scanner: QrScanner | null = null
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Kamera memerlukan HTTPS. Buka alamat resmi SISMEPDA atau gunakan scanner USB.")
        const { default: Scanner } = await import("qr-scanner")
        if (disposed || !video.current || !overlay.current) return
        scanner = new Scanner(video.current, (result) => callbacks.current.onCode(result.data), {
          preferredCamera: preferred.current,
          maxScansPerSecond: 10,
          returnDetailedScanResult: true,
          calculateScanRegion: ({ videoWidth, videoHeight }) => {
            const size = Math.round(Math.min(videoWidth, videoHeight) * 0.8)
            const decodeSize = Math.min(size, 640)
            return {
              x: Math.round((videoWidth - size) / 2),
              y: Math.round((videoHeight - size) / 2),
              width: size,
              height: size,
              downScaledWidth: decodeSize,
              downScaledHeight: decodeSize,
            }
          },
          highlightScanRegion: true,
          overlay: overlay.current,
        })
        instance.current = scanner
        await scanner.start()
        if (disposed) {
          scanner.destroy()
          return
        }
        setReady(true)
        const hasFlash = await scanner.hasFlash()
        if (!disposed) setFlash(hasFlash)
      } catch (error) {
        if (!disposed)
          callbacks.current.onError(
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Izin kamera ditolak. Izinkan kamera melalui pengaturan situs, lalu coba lagi; atau gunakan scanner USB."
              : error instanceof Error
                ? error.message
                : "Kamera tidak dapat dibuka. Coba scanner USB atau pencarian manual.",
          )
      }
    }
    void start()
    return () => {
      disposed = true
      scanner?.destroy()
      instance.current = null
      setReady(false)
      setFlash(false)
    }
  }, [active])
  useEffect(() => {
    const scanner = instance.current
    if (!scanner || !ready) return
    if (paused) scanner.pause()
    else void scanner.start().catch(() => callbacks.current.onError("Kamera terhenti. Aktifkan kembali kamera."))
  }, [paused, ready])
  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-secondary/60">
        <video
          ref={video}
          className="h-full w-full object-contain"
          muted
          playsInline
          onPlaying={(event) => enableContinuousFocus(event.currentTarget)}
          aria-label="Pratinjau kamera pemindai QR"
        />
        <div ref={overlay} className="absolute rounded-xl border-2 border-primary/70" aria-hidden="true" />
        {(!active || !ready || paused) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-secondary/90 p-5 text-center">
            <Camera className="size-7 text-primary" />
            <span className="text-sm">
              {paused ? "Pemindaian dijeda" : active ? "Membuka kamera…" : "Kamera belum aktif"}
            </span>
            <span className="text-xs text-muted-foreground">Arahkan kartu QR siswa ke dalam bingkai.</span>
          </div>
        )}
      </div>
      {active && ready && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={paused}
            onClick={async () => {
              const next = facing === "environment" ? "user" : "environment"
              try {
                await instance.current?.setCamera(next)
                preferred.current = next
                setFacing(next)
                setFlash((await instance.current?.hasFlash()) ?? false)
              } catch {
                callbacks.current.onError("Kamera lain tidak tersedia pada perangkat ini.")
              }
            }}
          >
            <SwitchCamera />
            Ganti kamera
          </Button>
          {flash && (
            <Button
              size="sm"
              variant="outline"
              disabled={paused}
              onClick={() => {
                void instance.current
                  ?.toggleFlash()
                  .catch(() => callbacks.current.onError("Lampu kamera tidak tersedia."))
              }}
            >
              <Flashlight />
              Lampu
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
