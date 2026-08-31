"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, BarChart3, Info, Loader2, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  comparisonChange,
  defaultRange,
  formatPercentage,
  missingPercentage,
  niceTrendMaximum,
  selectedStatusTotal,
  statusPercentage,
  trendValue,
  TREND_STATUSES,
  type TrendBucket,
  type TrendGranularity,
  type TrendMeasure,
  type TrendResponse,
  type TrendStatus,
} from "@/lib/attendance-trend"
import { statusMeta } from "@/lib/dashboard-data"
import { indonesiaDateValue } from "@/lib/date"
import { cn } from "@/lib/utils"

const periodOptions: Array<{ value: TrendGranularity; label: string }> = [
  { value: "harian", label: "Harian" },
  { value: "mingguan", label: "Mingguan" },
  { value: "bulanan", label: "Bulanan" },
  { value: "semester", label: "Sejak Awal Semester" },
]

const statusLabels: Record<TrendStatus, string> = {
  sakit: "Sakit",
  izin: "Izin",
  alfa: "Alfa",
  dispensasi: "Dispensasi",
}

const statusTokens: Record<TrendStatus, string> = {
  sakit: statusMeta.sakit.token,
  izin: statusMeta.izin.token,
  alfa: statusMeta.alfa.token,
  dispensasi: statusMeta.dispensasi.token,
}

type ClassOption = { id: string; name: string }

type ChartState = {
  data: TrendResponse | null
  loading: boolean
  error: string
}

export function AttendanceTrendChart({ classes }: { classes: ClassOption[] }) {
  const today = indonesiaDateValue()
  const initialRange = defaultRange("harian", today, null)
  const [granularity, setGranularity] = useState<TrendGranularity>("harian")
  const [measure, setMeasure] = useState<TrendMeasure>("jumlah")
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [classId, setClassId] = useState("all")
  const [showMissing, setShowMissing] = useState(false)
  const [showValues, setShowValues] = useState(true)
  const [selected, setSelected] = useState<Record<TrendStatus, boolean>>({
    sakit: true,
    izin: true,
    alfa: true,
    dispensasi: true,
  })
  const [state, setState] = useState<ChartState>({ data: null, loading: true, error: "" })
  const requestSequence = useRef(0)

  useEffect(() => {
    const sequence = ++requestSequence.current
    const controller = new AbortController()
    const query = new URLSearchParams({ granularity })
    if (granularity !== "semester") {
      query.set("from", from)
      query.set("to", to)
    }
    if (classId !== "all") query.set("classId", classId)

    setState((current) => ({ ...current, loading: true, error: "" }))
    fetch(`/api/attendance-trend?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? "Tren ketidakhadiran gagal dimuat")
        if (sequence !== requestSequence.current) return
        const data = body as TrendResponse
        setState({ data, loading: false, error: "" })
        if (granularity === "semester") {
          setFrom(data.from)
          setTo(data.to)
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (sequence === requestSequence.current) {
          setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Tren ketidakhadiran gagal dimuat" }))
        }
      })

    return () => controller.abort()
  }, [classId, from, granularity, to])

  const changeGranularity = (next: TrendGranularity) => {
    setGranularity(next)
    if (next !== "semester") {
      const range = defaultRange(next, today, null)
      setFrom(range.from)
      setTo(range.to)
    }
  }

  const enabledStatuses = TREND_STATUSES.filter((status) => selected[status])
  const selectedTotal = useMemo(() => {
    if (!state.data) return 0
    return selectedStatusTotal(state.data.buckets, enabledStatuses)
  }, [enabledStatuses, state.data])

  const validRecords = state.data?.buckets.reduce((sum, bucket) => sum + bucket.validRecords, 0) ?? 0
  const selectedRate = statusPercentage(selectedTotal, validRecords)
  const previousTotal = state.data?.comparison
    ? selectedStatusTotal(state.data.comparison.buckets, enabledStatuses)
    : 0
  const previousValidRecords = state.data?.comparison?.buckets.reduce((sum, bucket) => sum + bucket.validRecords, 0) ?? 0
  const currentValue = measure === "jumlah" ? selectedTotal : selectedRate
  const previousValue = measure === "jumlah"
    ? previousTotal
    : statusPercentage(previousTotal, previousValidRecords)
  const comparison = state.data?.comparison?.available && currentValue !== null && previousValue !== null
    ? comparisonChange(currentValue, previousValue, measure)
    : null
  const allAbsenceSelected = enabledStatuses.length === TREND_STATUSES.length

  const invalidRange = granularity !== "semester" && (!from || !to || from > to)

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="gap-4 border-b border-border/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-5 text-primary" />
              Tren Ketidakhadiran Siswa
            </CardTitle>
            <CardDescription>
              {state.data?.semester
                ? `${state.data.semester.label} · Tahun Ajaran ${state.data.semester.academicYear}`
                : "Frekuensi status absensi berdasarkan data yang sudah diinput"}
            </CardDescription>
          </div>
          <div className="flex w-fit rounded-lg border border-border bg-muted/40 p-1" aria-label="Mode pengukuran">
            {(["jumlah", "persentase"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={measure === value ? "default" : "ghost"}
                className="h-7 px-3 capitalize"
                aria-pressed={measure === value}
                onClick={() => setMeasure(value)}
              >
                {value === "jumlah" ? "Jumlah" : "Persentase"}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Periode grafik">
          {periodOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={granularity === option.value ? "secondary" : "outline"}
              aria-pressed={granularity === option.value}
              onClick={() => changeGranularity(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(170px,1fr)_160px_160px_auto] lg:items-end">
          {classes.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="trend-class">Kelas</Label>
              <Select value={classId} onValueChange={(value) => value && setClassId(value)}>
                <SelectTrigger id="trend-class" className="w-full">
                  <SelectValue>{(value: string) => value === "all" ? "Semua Kelas" : classes.find((item) => item.id === value)?.name ?? "Semua Kelas"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kelas</SelectItem>
                  {classes.map((schoolClass) => <SelectItem key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : <div />}
          <div className="space-y-1.5">
            <Label htmlFor="trend-from">Tanggal mulai</Label>
            <Input id="trend-from" type="date" value={from} max={to || today} disabled={granularity === "semester"} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trend-to">Tanggal akhir</Label>
            <Input id="trend-to" type="date" value={to} min={from} max={today} disabled={granularity === "semester"} onChange={(event) => setTo(event.target.value)} />
          </div>
          <p className="pb-1 text-xs text-muted-foreground lg:max-w-48">
            {granularity === "semester" ? "Rentang mengikuti semester aktif." : "Rentang tanggal dapat disesuaikan."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {TREND_STATUSES.map((status) => (
            <label key={status} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={selected[status]}
                onCheckedChange={(checked) => setSelected((current) => ({ ...current, [status]: checked === true }))}
                style={{ backgroundColor: selected[status] ? statusTokens[status] : undefined, borderColor: selected[status] ? statusTokens[status] : undefined }}
              />
              <span className="size-2.5 rounded-full" style={{ backgroundColor: statusTokens[status] }} aria-hidden />
              {statusLabels[status]}
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 border-l border-border pl-5 text-sm font-medium">
            <Checkbox checked={showMissing} onCheckedChange={(checked) => setShowMissing(checked === true)} />
            <span className="size-2.5 rounded-sm bg-muted-foreground/60" aria-hidden />
            Belum diisi
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox checked={showValues} onCheckedChange={(checked) => setShowValues(checked === true)} />
            Tampilkan nilai
          </label>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
          <strong className="tabular-nums">
            {measure === "jumlah"
              ? `${allAbsenceSelected ? "Total ketidakhadiran" : "Total status ditampilkan"}: ${selectedTotal.toLocaleString("id-ID")}`
              : `Ketidakhadiran: ${formatPercentage(selectedRate)}`}
          </strong>
          <ComparisonText comparison={comparison} measure={measure} />
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6">
        {invalidRange ? <ChartMessage kind="error">Tanggal mulai tidak boleh setelah tanggal akhir.</ChartMessage> : null}
        {!invalidRange && state.error ? <ChartMessage kind="error">{state.error}</ChartMessage> : null}
        {!invalidRange && state.loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="mr-2 size-5 animate-spin" />Memuat tren ketidakhadiran...
          </div>
        ) : null}
        {!invalidRange && !state.loading && !state.error && enabledStatuses.length === 0 && !showMissing ? (
          <ChartMessage>Pilih setidaknya satu status atau Belum diisi untuk ditampilkan.</ChartMessage>
        ) : null}
        {!invalidRange && !state.loading && !state.error && (enabledStatuses.length > 0 || showMissing) && state.data ? (
          <StackedBarChart
            buckets={state.data.buckets}
            previousBuckets={state.data.comparison?.buckets ?? []}
            statuses={enabledStatuses}
            measure={measure}
            showMissing={showMissing}
            showValues={showValues}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function ChartMessage({ children, kind = "empty" }: { children: React.ReactNode; kind?: "empty" | "error" }) {
  return (
    <div className={cn("flex h-64 items-center justify-center gap-2 rounded-xl border border-dashed px-6 text-center text-sm", kind === "error" ? "border-destructive/40 text-destructive" : "text-muted-foreground")} role={kind === "error" ? "alert" : "status"}>
      <Info className="size-4 shrink-0" />{children}
    </div>
  )
}

function ComparisonText({ comparison, measure }: {
  comparison: ReturnType<typeof comparisonChange>
  measure: TrendMeasure
}) {
  if (!comparison) return <span className="text-xs text-muted-foreground">Belum ada periode pembanding</span>
  const Icon = comparison.direction === "up" ? ArrowUp : comparison.direction === "down" ? ArrowDown : Minus
  const direction = comparison.direction === "up" ? "Naik" : comparison.direction === "down" ? "Turun" : "Tetap"
  const detail = measure === "jumlah"
    ? `${Math.abs(comparison.difference).toLocaleString("id-ID")}${comparison.relativePercent === null ? "" : ` (${comparison.relativePercent >= 0 ? "+" : "-"}${formatPercentage(Math.abs(comparison.relativePercent))})`}`
    : `${formatPercentage(Math.abs(comparison.difference))} poin persentase`
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden />{direction} {detail} dibanding periode sebelumnya</span>
}

function BucketStateMarker({ bucket, x, y }: { bucket: TrendBucket; x: number; y: number }) {
  if (bucket.state === "future") return null
  const holiday = bucket.state === "holiday"
  return (
    <g aria-hidden>
      <line x1={x - 5} x2={x + 5} y1={y - 1} y2={y - 1} stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray={holiday ? undefined : "2 2"} />
      <text x={x} y={y - 7} textAnchor="middle" fill="var(--muted-foreground)" fontSize="8">{holiday ? "Libur" : "?"}</text>
    </g>
  )
}

function StackedBarChart({
  buckets, previousBuckets, statuses, measure, showMissing, showValues,
}: {
  buckets: TrendBucket[]
  previousBuckets: TrendBucket[]
  statuses: TrendStatus[]
  measure: TrendMeasure
  showMissing: boolean
  showValues: boolean
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const width = 960
  const height = 310
  const margin = { top: 24, right: showMissing ? 64 : 18, bottom: 54, left: 64 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const values = buckets.map((bucket) => statuses.reduce((sum, status) => {
    const value = trendValue(bucket, status, measure) ?? 0
    return sum + value
  }, 0))
  const maxValue = niceTrendMaximum(Math.max(...values, 0), measure)
  const missingValues = buckets.map((bucket) => measure === "jumlah" ? bucket.missingRecords : (missingPercentage(bucket) ?? 0))
  const missingMax = niceTrendMaximum(Math.max(...missingValues, 0), measure)
  const ticks = Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index)
  const band = plotWidth / Math.max(buckets.length, 1)
  const groupGap = showMissing ? Math.min(5, band * 0.08) : 0
  const barWidth = showMissing
    ? Math.min(26, Math.max(4, (band * 0.72 - groupGap) / 2))
    : Math.min(38, Math.max(5, band * 0.72))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 10))
  const active = buckets.find((bucket) => bucket.key === activeKey) ?? null
  const activeIndex = active ? buckets.findIndex((bucket) => bucket.key === active.key) : -1
  const previousActive = activeIndex >= 0 ? previousBuckets[activeIndex] ?? null : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-h-60 w-full" role="img" aria-label={`Grafik batang bertumpuk tren ketidakhadiran dalam mode ${measure}`} onMouseLeave={() => setActiveKey(null)}>
        {ticks.map((tick) => {
          const y = margin.top + plotHeight - (tick / maxValue) * plotHeight
          return (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray={tick === 0 ? undefined : "4 4"} />
              <text x={margin.left - 10} y={y + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="11">
                {measure === "persentase" ? `${formatAxis(tick)}%` : formatAxis(tick)}
              </text>
            </g>
          )
        })}
        {showMissing ? ticks.map((_, index) => {
          const tick = (missingMax / 4) * index
          const y = margin.top + plotHeight - (tick / missingMax) * plotHeight
          return (
            <text key={`missing-${tick}`} x={width - margin.right + 10} y={y + 4} fill="var(--muted-foreground)" fontSize="10">
              {measure === "persentase" ? `${formatAxis(tick)}%` : formatAxis(tick)}
            </text>
          )
        }) : null}

        {buckets.map((bucket, index) => {
          const groupWidth = showMissing ? barWidth * 2 + groupGap : barWidth
          const x = margin.left + index * band + (band - groupWidth) / 2
          const missingX = x + barWidth + groupGap
          let cumulative = 0
          const total = values[index]
          const missingValue = missingValues[index]
          const visibleStatuses = statuses.filter((status) => (trendValue(bucket, status, measure) ?? 0) > 0)
          const topStatus = visibleStatuses.at(-1) ?? null
          const showLabel = index % labelEvery === 0 || index === buckets.length - 1
          return (
            <g
              key={bucket.key}
              tabIndex={0}
              role="button"
              aria-label={tooltipAria(bucket, statuses, measure)}
              onFocus={() => setActiveKey(bucket.key)}
              onBlur={() => setActiveKey(null)}
              onMouseEnter={() => setActiveKey(bucket.key)}
              onClick={() => setActiveKey(bucket.key)}
              className="outline-none"
            >
              <rect x={margin.left + index * band} y={margin.top} width={band} height={plotHeight} fill="transparent" />
              {bucket.state !== "active" ? (
                <BucketStateMarker bucket={bucket} x={x + groupWidth / 2} y={margin.top + plotHeight} />
              ) : statuses.map((status) => {
                const raw = trendValue(bucket, status, measure) ?? 0
                const segmentHeight = (raw / maxValue) * plotHeight
                const y = margin.top + plotHeight - cumulative - segmentHeight
                cumulative += segmentHeight
                if (segmentHeight <= 0) return null
                if (status === topStatus) {
                  return (
                    <path
                      key={status}
                      d={roundedTopSegmentPath(x, y, barWidth, segmentHeight, 5)}
                      fill={statusTokens[status]}
                      opacity={activeKey && activeKey !== bucket.key ? 0.48 : 1}
                      className="transition-opacity"
                    />
                  )
                }
                return (
                  <rect
                    key={status}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={segmentHeight}
                    fill={statusTokens[status]}
                    opacity={activeKey && activeKey !== bucket.key ? 0.48 : 1}
                    className="transition-opacity"
                  />
                )
              })}
              {bucket.state === "active" && showMissing && missingValue > 0 ? (
                <path
                  d={roundedTopSegmentPath(missingX, margin.top + plotHeight - (missingValue / missingMax) * plotHeight, barWidth, (missingValue / missingMax) * plotHeight, 4)}
                  fill="var(--muted-foreground)"
                  opacity={activeKey && activeKey !== bucket.key ? 0.28 : 0.58}
                  className="transition-opacity"
                />
              ) : null}
              {bucket.state === "active" && showValues && (buckets.length <= 16 || index % 2 === 0) ? (
                <text x={x + barWidth / 2} y={Math.max(11, margin.top + plotHeight - (total / maxValue) * plotHeight - 5)} textAnchor="middle" fill="var(--foreground)" fontSize="10" fontWeight="600">
                  {formatChartValue(total, measure)}
                </text>
              ) : null}
              {bucket.state === "active" && showValues && showMissing && missingValue > 0 && buckets.length <= 12 ? (
                <text x={missingX + barWidth / 2} y={Math.max(11, margin.top + plotHeight - (missingValue / missingMax) * plotHeight - 5)} textAnchor="middle" fill="var(--muted-foreground)" fontSize="9" fontWeight="600">
                  {formatChartValue(missingValue, measure)}
                </text>
              ) : null}
              {showLabel ? (
                <text x={x + groupWidth / 2} y={margin.top + plotHeight + 18} textAnchor="end" transform={`rotate(-35 ${x + groupWidth / 2} ${margin.top + plotHeight + 18})`} fill="var(--muted-foreground)" fontSize="10">
                  {bucket.label}
                </text>
              ) : null}
            </g>
          )
        })}
        <text x={15} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 15 ${margin.top + plotHeight / 2})`} fill="var(--muted-foreground)" fontSize="11">
          {measure === "jumlah" ? "Jumlah ketidakhadiran" : "Persentase ketidakhadiran (%)"}
        </text>
      </svg>

      {active ? <ChartTooltip bucket={active} previousBucket={previousActive} statuses={statuses} measure={measure} showMissing={showMissing} /> : null}
      <p className="mt-1 text-center text-xs text-muted-foreground">Arahkan kursor atau fokuskan batang untuk melihat detail.</p>
    </div>
  )
}

function ChartTooltip({ bucket, previousBucket, statuses, measure, showMissing }: {
  bucket: TrendBucket
  previousBucket: TrendBucket | null
  statuses: TrendStatus[]
  measure: TrendMeasure
  showMissing: boolean
}) {
  const selectedTotal = statuses.reduce((sum, status) => sum + bucket.counts[status], 0)
  const comparablePrevious = previousBucket?.state === "active" ? previousBucket : null
  const previousTotal = comparablePrevious ? statuses.reduce((sum, status) => sum + comparablePrevious.counts[status], 0) : null
  const currentValue = measure === "jumlah" ? selectedTotal : statusPercentage(selectedTotal, bucket.validRecords)
  const previousValue = comparablePrevious && previousTotal !== null
    ? measure === "jumlah" ? previousTotal : statusPercentage(previousTotal, comparablePrevious.validRecords)
    : null
  const change = currentValue !== null && previousValue !== null ? comparisonChange(currentValue, previousValue, measure) : null
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 min-w-56 rounded-lg border border-border bg-popover/95 p-3 text-sm text-popover-foreground shadow-lg backdrop-blur" role="status" aria-live="polite">
      <p className="mb-2 font-semibold">{bucket.tooltipLabel}</p>
      {bucket.state === "holiday" ? (
        <p className="text-muted-foreground">Libur{bucket.holidayNames.length ? ` · ${bucket.holidayNames.join(", ")}` : ""}</p>
      ) : bucket.state === "no_data" ? (
        <p className="max-w-60 text-muted-foreground">Tidak ada data absensi pada tanggal ini. Status hari tidak dapat dipastikan.</p>
      ) : bucket.state === "future" ? (
        <p className="text-muted-foreground">Tanggal mendatang tidak masuk perhitungan.</p>
      ) : (
        <ul className="space-y-1.5">
          {statuses.map((status) => (
            <li key={status} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: statusTokens[status] }} />
              <span className="flex-1 text-muted-foreground">{statusLabels[status]}</span>
              <strong className="tabular-nums">
                {measure === "jumlah"
                  ? bucket.counts[status].toLocaleString("id-ID")
                  : `${formatPercentage(statusPercentage(bucket.counts[status], bucket.validRecords))} (${bucket.counts[status].toLocaleString("id-ID")})`}
              </strong>
            </li>
          ))}
          <li className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
            <span>Total ketidakhadiran</span>
            <span className="tabular-nums">{measure === "jumlah" ? selectedTotal.toLocaleString("id-ID") : formatPercentage(statusPercentage(selectedTotal, bucket.validRecords))}</span>
          </li>
          {previousValue !== null ? <li className="flex justify-between text-xs text-muted-foreground"><span>Sebelumnya</span><span>{formatChartValue(previousValue, measure)}</span></li> : null}
          {change ? <li><ComparisonText comparison={change} measure={measure} /></li> : null}
          {bucket.isCurrentDay && bucket.missingRecords > 0 ? <li className="text-xs text-muted-foreground">Hari ini · pengisian mungkin masih berlangsung.</li> : null}
        </ul>
      )}
      {showMissing && bucket.state === "active" ? (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kelengkapan data</p>
          <p className="flex justify-between gap-4"><span>Belum diisi</span><strong className="tabular-nums">{bucket.missingRecords.toLocaleString("id-ID")} / {bucket.expectedAttendance.toLocaleString("id-ID")} ({formatPercentage(missingPercentage(bucket))})</strong></p>
        </div>
      ) : null}
    </div>
  )
}

function tooltipAria(bucket: TrendBucket, statuses: TrendStatus[], measure: TrendMeasure) {
  if (bucket.state === "holiday") return `${bucket.tooltipLabel}: Libur`
  if (bucket.state === "no_data") return `${bucket.tooltipLabel}: Tidak ada data, status hari tidak dapat dipastikan`
  if (bucket.state === "future") return `${bucket.tooltipLabel}: tanggal mendatang`
  return `${bucket.tooltipLabel}. ${statuses.map((status) => `${statusLabels[status]} ${measure === "jumlah" ? bucket.counts[status] : formatPercentage(statusPercentage(bucket.counts[status], bucket.validRecords))}`).join(", ")}`
}


function formatChartValue(value: number, measure: TrendMeasure) {
  return measure === "jumlah" ? value.toLocaleString("id-ID") : formatPercentage(value)
}

function roundedTopSegmentPath(x: number, y: number, width: number, height: number, radius: number) {
  const topRadius = Math.min(radius, width / 2, height)
  const right = x + width
  const bottom = y + height
  return [
    `M ${x} ${bottom}`,
    `V ${y + topRadius}`,
    `Q ${x} ${y} ${x + topRadius} ${y}`,
    `H ${right - topRadius}`,
    `Q ${right} ${y} ${right} ${y + topRadius}`,
    `V ${bottom}`,
    "Z",
  ].join(" ")
}

function formatAxis(value: number) {
  return value.toLocaleString("id-ID", { maximumFractionDigits: value < 10 ? 1 : 0 })
}
