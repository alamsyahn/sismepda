import PDFDocument from "pdfkit"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { KesiswaanData } from "@/lib/server-kesiswaan"
import {
  attendanceMetrics,
  KS_LEVELS,
  KS_STAGES,
  completedReview,
  memberInMonth,
  memberAt,
} from "@/lib/kesiswaan"
import { ApiError } from "@/lib/api-errors"

export type KsReportOptions = {
  section: string
  tab: string
  activity: string
  session: string
  query: string
  level: string
  month: string
  all: boolean
  full: boolean
  attachments: boolean
  timeline: boolean
  blank: boolean
}
const ink = "#303044",
  muted = "#666679",
  purple = "#6452C7",
  border = "#E4E4ED"
const date = (v: string) => v.slice(0, 10)
const clean = (v: unknown) =>
  String(v ?? "-")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[–—]/g, "-")

/** One authorized, repeatable-read snapshot feeds every page of the document. */
export async function buildKesiswaanPdf(
  data: KesiswaanData,
  options: KsReportOptions,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout:
      options.all ||
      options.section === "ringkasan" ||
      options.section === "presensi" ||
      (options.activity && options.tab === "Profil")
        ? "portrait"
        : "landscape",
    margin: 46,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: "Laporan Kesiswaan", Author: data.settings?.schoolName ?? "SISMEPDA" },
  })
  const regular = readFileSync(join(process.cwd(), "public/fonts/kesiswaan/Lato-Regular.ttf")),
    bold = readFileSync(join(process.cwd(), "public/fonts/kesiswaan/Lato-Bold.ttf"))
  doc.registerFont("Body", regular)
  doc.registerFont("Bold", bold)
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })
  const width = () => doc.page.width - 92,
    bottom = () => doc.page.height - 65
  const stamp = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.settings?.timeZone ?? "Asia/Jakarta",
  }).format(new Date(data.generatedAt))
  doc.on("pageAdded", () => {
    doc
      .font("Bold")
      .fontSize(11)
      .fillColor(purple)
      .text(clean(data.settings?.schoolName ?? "SISMEPDA"), 46, 25, {
        width: width(),
        height: 30,
        ellipsis: true,
      })
    doc
      .font("Body")
      .fontSize(8)
      .fillColor(muted)
      .text(`KESISWAAN${data.settings?.npsn ? ` | NPSN ${data.settings.npsn}` : ""}`, 46, 54)
    doc
      .strokeColor(purple)
      .lineWidth(1)
      .moveTo(46, 70)
      .lineTo(doc.page.width - 46, 70)
      .stroke()
    doc.x = 46
    doc.y = 88
  })
  doc.addPage()
  function space(height: number) {
    if (doc.y + height > bottom()) doc.addPage()
  }
  function text(value: unknown, size = 10, strong = false) {
    doc
      .font(strong ? "Bold" : "Body")
      .fontSize(size)
      .fillColor(ink)
    const s = clean(value),
      h = doc.heightOfString(s, { width: width(), lineGap: 3 })
    space(Math.min(h + 10, bottom() - 90))
    doc.text(s, 46, doc.y, { width: width(), lineGap: 3 })
    doc.moveDown(0.6)
  }
  function heading(value: string) {
    space(48)
    text(value, 13, true)
  }
  function title(value: string) {
    text(value, 23, true)
    text(
      `${data.period?.year ?? ""} | ${data.period?.semester ?? ""} | ${data.period ? `${date(data.period.start)} s.d. ${date(data.period.end)}` : ""}`,
      9,
    )
  }
  function lines(value: unknown, w: number): string[] {
    const result: string[] = []
    let line = ""
    for (const word of clean(value).split(/\s+/)) {
      if (doc.widthOfString(word) > w) {
        if (line) result.push(line)
        line = ""
        for (const char of word) {
          if (doc.widthOfString(line + char) > w) {
            result.push(line)
            line = ""
          }
          line += char
        }
      } else if (doc.widthOfString(line ? `${line} ${word}` : word) > w) {
        result.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line || !result.length) result.push(line || "-")
    return result
  }
  function table(heads: string[], rows: unknown[][], ratios: number[]) {
    let widths = ratios.map((r) => r * width())
    function draw(cells: string[][], from: number, count: number, header = false) {
      const y = doc.y,
        h = count * 14 + 16
      if (header) doc.rect(46, y, width(), h).fill("#F1EFF9")
      let x = 46
      doc
        .font(header ? "Bold" : "Body")
        .fontSize(9)
        .fillColor(ink)
      cells.forEach((ls, i) => {
        ls.slice(from, from + count).forEach((line, j) =>
          doc.text(line, x + 8, y + 8 + j * 14, { width: widths[i] - 16, lineBreak: false }),
        )
        x += widths[i]
      })
      doc
        .strokeColor(border)
        .lineWidth(0.4)
        .moveTo(46, y + h)
        .lineTo(doc.page.width - 46, y + h)
        .stroke()
      doc.x = 46
      doc.y = y + h
    }
    function header() {
      widths = ratios.map((r) => r * width())
      doc.font("Bold").fontSize(9)
      const cells = heads.map((s, i) => lines(s, widths[i] - 16))
      const h = Math.max(...cells.map((c) => c.length))
      space(h * 14 + 46)
      draw(cells, 0, h, true)
    }
    header()
    for (const row of rows.length ? rows : [heads.map((_, i) => (i ? "" : "Belum ada data"))]) {
      doc.font("Body").fontSize(9)
      const cells = row.map((v, i) => lines(v, widths[i] - 16)),
        total = Math.max(...cells.map((c) => c.length))
      let offset = 0
      if (total * 14 + 16 <= bottom() - 125 && doc.y + total * 14 + 16 > bottom()) {
        doc.addPage()
        header()
      }
      while (offset < total) {
        let room = Math.floor((bottom() - doc.y - 16) / 14)
        if (room < 1) {
          doc.addPage()
          header()
          room = Math.floor((bottom() - doc.y - 16) / 14)
        }
        const count = Math.min(room, total - offset)
        draw(cells, offset, count)
        offset += count
        if (offset < total) {
          doc.addPage()
          header()
        }
      }
    }
    doc.y += 14
  }
  const activities = data.activities.filter(
    (a) => options.all || `${a.name} ${a.kind}`.toLowerCase().includes(options.query.toLowerCase()),
  )
  const a = data.activities.find((a) => a.id === options.activity)
  if (options.activity && !a) throw new ApiError(404, "Ekstra tidak ditemukan")
  const session =
    a?.sessions.find((s) => s.id === options.session) ??
    (!options.session ? a?.sessions[0] : undefined)
  if (options.session && !session) throw new ApiError(404, "Pertemuan tidak ditemukan")
  const verified = data.achievements.filter((p) => p.status === "VERIFIED")
  function stats(activity: KesiswaanData["activities"][number]) {
    return attendanceMetrics(activity.sessions.filter((s) => date(s.date) <= data.today))
  }
  function overview() {
    title("Ringkasan Kesiswaan")
    table(
      ["Indikator", "Jumlah / cakupan"],
      [
        ["Siswa aktif saat ini", data.studentCount ?? "Hanya data ekstra binaan"],
        [
          "Siswa peserta ekstra (unik)",
          new Set(data.activities.flatMap((a) => a.members.map((m) => m.studentId))).size,
        ],
        ["Program aktif", data.activities.filter((a) => a.active).length],
        ["Prestasi terverifikasi (perolehan)", verified.length],
      ],
      [0.55, 0.45],
    )
    heading("Tren prestasi per bulan")
    const monthly: { month: string; value: number }[] = []
    if (data.period) {
      const c = new Date(data.period.start)
      c.setUTCDate(1)
      for (
        let i = 0;
        i < 12 &&
        c <= new Date(data.period.end) &&
        c.toISOString().slice(0, 7) <= data.today.slice(0, 7);
        i++
      ) {
        const key = c.toISOString().slice(0, 7)
        monthly.push({ month: key, value: verified.filter((v) => v.date.startsWith(key)).length })
        c.setUTCMonth(c.getUTCMonth() + 1)
      }
    }
    if (monthly.length) {
      space(150)
      const y = doc.y,
        max = Math.max(1, ...monthly.map((m) => m.value)),
        chartWidth = width() - 40
      doc.font("Body").fontSize(8)
      for (let i = 0; i < 3; i++) {
        const gy = y + 110 - i * 50
        doc
          .strokeColor(border)
          .lineWidth(0.5)
          .moveTo(65, gy)
          .lineTo(doc.page.width - 50, gy)
          .stroke()
      }
      monthly.forEach((m, i) => {
        const x =
            66 + (monthly.length === 1 ? chartWidth / 2 : (i * chartWidth) / (monthly.length - 1)),
          py = y + 110 - (m.value / max) * 95
        if (i) {
          const prev = monthly[i - 1],
            px = 66 + ((i - 1) * chartWidth) / (monthly.length - 1)
          doc
            .strokeColor(purple)
            .lineWidth(1.5)
            .moveTo(px, y + 110 - (prev.value / max) * 95)
            .lineTo(x, py)
            .stroke()
        }
        doc.circle(x, py, 2.5).fill(purple)
        doc
          .fillColor(ink)
          .text(String(m.value), x - 12, py - 14, { width: 24, align: "center", lineBreak: false })
        doc
          .fontSize(7)
          .text(m.month.slice(5), x - 12, y + 120, { width: 24, align: "center", lineBreak: false })
        doc.fontSize(8)
      })
      doc.y = y + 145
      doc.x = 46
    } else text("Belum ada bulan yang berlangsung.")
    table(
      ["Tingkat", "Perolehan terverifikasi"],
      KS_LEVELS.map((l) => [l, verified.filter((v) => v.level === l).length]),
      [0.6, 0.4],
    )
    text(
      "Tren berdasarkan data terverifikasi yang tercatat, bukan jumlah peserta. Bulan berjalan belum selesai.",
      9,
    )
  }
  function program(activity: KesiswaanData["activities"][number]) {
    title(activity.name)
    table(
      ["Informasi", "Keterangan"],
      [
        ["Jenis", activity.kind],
        ["Pembina", activity.coaches.map((c) => c.user.name).join(", ")],
        ["Jadwal / lokasi", `${activity.schedule} / ${activity.venue}`],
        ["Status", activity.active ? "Aktif" : "Diarsipkan"],
        ["Tujuan", activity.description],
      ],
      [0.3, 0.7],
    )
  }
  function members(activity: KesiswaanData["activities"][number]) {
    heading("Daftar anggota")
    table(
      ["Siswa", "Kelas saat bergabung", "Masa keanggotaan"],
      activity.members.map((m) => [
        m.student.name,
        m.className,
        `${date(m.joined)} - ${m.left ? date(m.left) : "Aktif"}`,
      ]),
      [0.4, 0.25, 0.35],
    )
  }
  function attendance(s: NonNullable<typeof session>) {
    heading(`Presensi ${date(s.date)} | ${options.blank ? "FORMULIR KOSONG" : s.status}`)
    text(s.topic, 10)
    text(
      "H Hadir | S Sakit | I Izin | A Alfa | - Belum diisi. DRAFT belum masuk agregat kehadiran final.",
      9,
    )
    table(
      ["No.", "Siswa", "Kelas", "H/S/I/A", "Catatan"],
      s.attendance.map((r, i) => [
        i + 1,
        r.studentName,
        r.className,
        options.blank ? "" : (r.status ?? "-"),
        options.blank ? "" : r.note,
      ]),
      [0.07, 0.31, 0.15, 0.13, 0.34],
    )
  }
  function reviews(activity: KesiswaanData["activities"][number]) {
    heading(`Perkembangan siswa | ${options.month}`)
    table(
      ["Siswa", "Keterampilan", "Kerja sama", "Kemandirian", "Catatan"],
      activity.members
        .filter((m) => memberInMonth(m, options.month))
        .map((m) => {
          const r = m.reviews.find((r) => r.month === options.month)
          return [
            m.student.name,
            r?.skill ?? KS_STAGES[0],
            r?.teamwork ?? KS_STAGES[0],
            r?.independence ?? KS_STAGES[0],
            r?.note ?? "-",
          ]
        }),
      [0.23, 0.17, 0.17, 0.17, 0.26],
    )
  }
  function achievements(activityId?: string) {
    title(options.timeline ? "Kronologi Prestasi" : "Register Prestasi")
    const rows = data.achievements.filter(
      (v) =>
        (!activityId || v.activityId === activityId) &&
        (!options.level || v.level === options.level),
    )
    text(
      `Tingkat: ${options.level || "Semua"} | ${rows.length} perolehan (termasuk status belum diverifikasi)`,
      9,
    )
    table(
      ["Tanggal", "Ajang / hasil", "Tingkat", "Peserta", "Status"],
      rows.map((r) => [
        date(r.date),
        `${r.result} - ${r.title}\n${r.organizer}`,
        r.level,
        r.participants.map((p) => `${p.name} (${p.className})`).join(", "),
        r.status,
      ]),
      [0.14, 0.28, 0.13, 0.3, 0.15],
    )
  }
  function recap() {
    table(
      ["Program / jenis", "Pembina", "Anggota", "Jadwal"],
      activities.map((a) => [
        a.name + " / " + a.kind,
        a.coaches.map((c) => c.user.name).join(", "),
        a.members.filter((m) =>
          memberAt(
            m,
            data.period && date(data.period.end) < data.today ? date(data.period.end) : data.today,
          ),
        ).length,
        a.schedule,
      ]),
      [0.29, 0.31, 0.12, 0.28],
    )
    text(
      "Anggota per program adalah keanggotaan aktif. Satu siswa dapat mengikuti beberapa program; jumlah kolom anggota bukan siswa unik.",
      9,
    )
  }
  if (options.all) {
    title("Laporan Seluruh Ekstrakurikuler")
    text(`${activities.length} program sesuai hak akses. Pencarian daftar tidak diterapkan.`, 10)
    recap()
    if (options.full)
      for (const activity of activities) {
        doc.addPage({ layout: "portrait" })
        program(activity)
        const m = stats(activity)
        heading("Ringkasan pelaksanaan")
        text(
          `${activity.sessions.filter((s) => s.status !== "CANCELLED" && date(s.date) <= data.today).length} sesi terlaksana | ${m.filled}/${m.slots} slot terisi | Hadir ${m.rate === null ? "belum ada data" : m.rate + "%"} berdasarkan presensi final.`,
        )
        text(
          `Evaluasi ${options.month}: ${activity.members.filter((s) => memberInMonth(s, options.month) && s.reviews.some((r) => r.month === options.month && completedReview(r))).length}/${activity.members.filter((m) => memberInMonth(m, options.month)).length} anggota dinilai.`,
        )
        heading("Prestasi terverifikasi")
        const found = verified.filter((v) => v.activityId === activity.id)
        text(
          found.length
            ? found.map((v) => `${date(v.date)} | ${v.level} | ${v.result} - ${v.title}`).join("\n")
            : "Belum ada prestasi terverifikasi.",
        )
        heading("Evaluasi dan tindak lanjut")
        text(
          activity.followups.length
            ? activity.followups
                .map(
                  (f) =>
                    `${f.finding} | ${f.owner} | ${date(f.due)} | ${f.done ? "Selesai" : "Terbuka"}`,
                )
                .join("\n")
            : "Belum ada tindak lanjut tercatat.",
        )
        if (options.attachments) {
          doc.addPage({ layout: "landscape" })
          members(activity)
          reviews(activity)
          for (const s of activity.sessions) {
            doc.addPage({ layout: "portrait" })
            attendance(s)
          }
        }
      }
  } else if (options.section === "ringkasan") overview()
  else if (options.section === "monitoring") {
    title("Monitoring & Evaluasi")
    const m = attendanceMetrics(
      data.activities.flatMap((a) => a.sessions).filter((s) => date(s.date) <= data.today),
    )
    text(
      `Kelengkapan: ${m.filled}/${m.slots} slot | Hadir ${m.rate === null ? "belum ada data" : m.rate + "%"} (hanya presensi final).`,
      10,
    )
    table(
      ["Program", "Slot terisi", "Hadir", "Evaluasi bulan"],
      activities.map((a) => {
        const m = stats(a)
        return [
          a.name,
          `${m.filled}/${m.slots}`,
          m.rate === null ? "Belum ada data" : m.rate + "%",
          `${a.members.filter((m) => memberInMonth(m, options.month) && m.reviews.some((r) => r.month === options.month && completedReview(r))).length}/${a.members.filter((m) => memberInMonth(m, options.month)).length}`,
        ]
      }),
      [0.37, 0.2, 0.2, 0.23],
    )
    heading("Tindak lanjut")
    table(
      ["Ekstra", "Temuan / tindakan", "PIC", "Tenggat", "Status"],
      activities.flatMap((a) =>
        a.followups.map((f) => [
          a.name,
          f.finding,
          f.owner,
          date(f.due),
          f.done ? "Selesai" : "Terbuka",
        ]),
      ),
      [0.18, 0.35, 0.18, 0.15, 0.14],
    )
  } else if (options.section === "prestasi") achievements()
  else if (options.section === "presensi" || (a && options.tab === "Pertemuan & Presensi")) {
    if (!session) throw new ApiError(404, "Pilih pertemuan untuk dicetak")
    title(`Presensi ${a?.name}`)
    attendance(session)
  } else if (a) {
    if (options.tab === "Anggota") {
      title(`Anggota ${a.name}`)
      members(a)
    } else if (options.tab === "Perkembangan") {
      title(`Perkembangan ${a.name}`)
      reviews(a)
    } else if (options.tab === "Prestasi") achievements(a.id)
    else program(a)
  } else {
    title("Daftar Ekstrakurikuler")
    text(`Pencarian: ${options.query || "Semua"} | ${activities.length} program`, 9)
    recap()
  }
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i)
    doc.page.margins.bottom = 20
    doc
      .strokeColor(border)
      .lineWidth(0.5)
      .moveTo(46, doc.page.height - 48)
      .lineTo(doc.page.width - 46, doc.page.height - 48)
      .stroke()
    doc
      .font("Body")
      .fontSize(8)
      .fillColor(muted)
      .text(`SISMEPDA | ${stamp} | Sesuai hak akses`, 46, doc.page.height - 36, {
        width: width() - 60,
        lineBreak: false,
      })
    doc.text(`${i + 1} / ${range.count}`, doc.page.width - 95, doc.page.height - 36, {
      width: 49,
      align: "right",
      lineBreak: false,
    })
  }
  doc.end()
  return done
}
