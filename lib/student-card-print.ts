import type { ScanStudent } from "./scan"

export type CardPaper = "A4" | "A3" | "F4" | "Custom"
export type CardPrintOptions = {
  paper: CardPaper
  orientation: "portrait" | "landscape"
  customWidth: number
  customHeight: number
}
export const defaultCardPrintOptions: CardPrintOptions = { paper: "A4", orientation: "portrait", customWidth: 210, customHeight: 297 }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export function cardPageLayout(options: CardPrintOptions) {
  const sizes = { A4: [210, 297], A3: [297, 420], F4: [210, 330], Custom: [options.customWidth, options.customHeight] }
  const size = sizes[options.paper]
  if (!size || size.some((n) => !Number.isFinite(n) || n < 75 || n > 1200)) throw new Error("Ukuran kertas harus antara 75 dan 1200 mm.")
  const [short, long] = [...size].sort((a, b) => a - b)
  const [width, height] = options.orientation === "landscape" ? [long, short] : [short, long]
  const columns = Math.floor((width - 16 + 5) / 95)
  const rows = Math.floor((height - 16 + 5) / 60)
  if (columns < 1 || rows < 1) throw new Error("Kertas terlalu kecil untuk kartu 90 × 55 mm dan margin 8 mm.")
  return { width, height, columns, rows, perPage: columns * rows }
}

/** SVG uses millimetre coordinates so the border and every QR retain their physical size. */
export function studentCardSvg(student: ScanStudent, qrImage: string, schoolName: string, logoUrl: string) {
  const text = (x: number, y: number, value: string, size: number, maxWidth: number, weight = 700) => {
    const fontSize = Math.min(size, maxWidth / Math.max(value.length * 0.58, 1))
    return `<text x="${x}" y="${y}" font-size="${fontSize}" font-weight="${weight}">${escapeHtml(value)}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="90mm" height="55mm" viewBox="0 0 90 55" role="img" aria-label="Kartu pelajar ${escapeHtml(student.name)}">
  <rect width="90" height="55" fill="white"/>
  <path d="M0 0H90V1.3H0z M0 53.7H90V55H0z" fill="#142344"/>
  <rect x="2.6" y="4.2" width="84.8" height="46.5" rx="2" fill="white" stroke="#2c54b5" stroke-width=".35"/>
  <path d="M4.6 4.4H70L54.5 21.4H2.8V6.4Q2.8 4.4 4.6 4.4" fill="#142344"/>
  <path d="M66.5 2.6H74L67.3 12.6H59.8z M66 45.5H87.2V50Q87.2 52.4 84.8 52.4H59.7z" fill="#2c54b5"/>
  <path d="M75 2.8H79.6L73 12.6H68.5z M66.5 45.5H71.5L64.6 52.4H59.6z" fill="#142344"/>
  <path d="M63 45.5H64.5L57.5 52.4H56z" fill="#2c54b5"/>
  ${logoUrl ? `<image href="${escapeHtml(logoUrl)}" x="4.4" y="6.4" width="12" height="12" preserveAspectRatio="xMidYMid meet"/>` : ""}
  <g font-family="Arial, sans-serif" fill="white">
  ${text(18.2, 10.3, "KARTU PELAJAR", 4.2, 39)}
  <path d="M32 12.7H51" stroke="white" stroke-width=".2"/>
  ${text(18.2, 18.2, schoolName.toUpperCase(), 4.1, 39)}
  </g>
  <g font-family="Arial, sans-serif" fill="#172746">
  ${text(5.8, 25, "Nama Lengkap", 2.1, 48)}
  ${text(5.8, 29.4, student.name, 2.7, 48)}
  ${text(5.8, 33, "NIS", 2.1, 48)}
  ${text(5.8, 37.4, student.nis ?? "—", 2.7, 48)}
  ${text(5.8, 41, "Kelas", 2.1, 48)}
  ${text(5.8, 45.4, student.className, 2.7, 48)}
  </g>
  <path d="M6 30.5H54 M6 38.5H54 M6 46.5H54" stroke="#172746" stroke-width=".3"/>
  <rect x="59.5" y="19" width="25" height="25" rx="1.8" fill="white" stroke="#2c54b5" stroke-width=".35"/>
  <image href="${escapeHtml(qrImage)}" x="60" y="19.5" width="24" height="24"/>
  </svg>`
}

export function studentCardsPrintHtml(cards: { student: ScanStudent; image: string }[], schoolName: string, logoUrl: string, options: CardPrintOptions) {
  const layout = cardPageLayout(options)
  const pages: string[] = []
  for (let i = 0; i < cards.length; i += layout.perPage) {
    pages.push(`<main class="sheet">${cards.slice(i, i + layout.perPage).map((c) => `<section class="card">${studentCardSvg(c.student, c.image, schoolName, logoUrl)}</section>`).join("")}</main>`)
  }
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Kartu Pelajar - ${escapeHtml(schoolName)}</title><style>
  @page{size:${layout.width}mm ${layout.height}mm;margin:8mm}
  *{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;color:#172746;background:#e8ebf0}
  .tools{padding:16px;position:sticky;top:0;background:white;border-bottom:1px solid #ccc}.tools p{margin:8px 0 0;line-height:1.5}.tools button{padding:10px 16px;cursor:pointer}
  .sheet{display:grid;grid-template-columns:repeat(${layout.columns},90mm);grid-auto-rows:55mm;gap:5mm;width:${layout.width - 16}mm;height:${layout.height - 16}mm;align-content:start;margin:16px auto;padding:0;background:white;outline:8mm solid white;break-after:page;page-break-after:always}
  .sheet:last-child{break-after:auto;page-break-after:auto}.card{width:90mm;height:55mm;break-inside:avoid;outline:.15mm dashed #aaa;outline-offset:0}.card svg{display:block;width:90mm;height:55mm}
  @media print{body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.tools{display:none}.sheet{margin:0;outline:0}}
  </style></head><body><div class="tools"><button id="print" disabled>Menyiapkan gambar…</button><p>${cards.length} kartu · ${pages.length} halaman · ${escapeHtml(options.paper)} ${layout.width} × ${layout.height} mm · ${options.orientation === "portrait" ? "Portrait" : "Landscape"}<br>Kartu 9 × 5,5 cm, jarak potong 5 mm. Saat mencetak pilih kertas yang sama, skala 100% / ukuran sebenarnya, dan nonaktifkan header/footer.</p><p id="status" role="status"></p></div>${pages.join("")}
  <script>
  (()=>{
  const button=document.getElementById('print');
  button.addEventListener('click',()=>window.print());
  const images=Array.from(document.querySelectorAll('svg image'));
  Promise.all(images.map(el=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src=el.getAttribute('href')}))).then(results=>{if(results.some(ok=>!ok)){document.getElementById('status').textContent='Gambar gagal dimuat. Tutup pratinjau dan coba lagi.';button.textContent='Gambar gagal dimuat';return}button.disabled=false;button.textContent='Cetak / Simpan PDF'});
  })();
  </script></body></html>`
}
