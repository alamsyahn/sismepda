# Profil dan Riwayat Siswa Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Menambahkan halaman profil siswa yang menampilkan identitas, ringkasan kehadiran, tren, dan riwayat absensi harian yang dapat difilter.

**Architecture:** Gunakan dynamic route server-rendered `app/siswa/[studentId]/page.tsx` agar data awal aman dan cepat, dengan helper query terpisah untuk otorisasi kelas dan agregasi. Riwayat detail menggunakan pagination/filter URL (`from`, `to`, `status`, `page`) supaya tautan dapat dibagikan dan tidak mengambil seluruh absensi sekaligus.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma/PostgreSQL, Tailwind/shadcn, Node test runner melalui `tsx --test`.

---

## Rekomendasi UX

### Struktur halaman

1. **Header profil**
   - Tombol kembali ke Rekap Siswa.
   - Nama, NIS, NISN, kelas saat ini, badge aktif/nonaktif.
   - Admin mendapat tombol `Edit data`; guru hanya melihat.

2. **Ringkasan periode**
   - Total hari tercatat.
   - Hadir, Sakit, Izin, Dispensasi, Alfa.
   - Persentase hadir dengan denominator hanya hari yang memiliki record absensi siswa.
   - Periode default: tahun ajaran/semester aktif; shortcut 30 hari dan rentang kustom dapat ditambahkan setelah MVP.

3. **Tren bulanan**
   - Grafik sederhana per bulan untuk Hadir vs Tidak Hadir.
   - Fokus pada pola, bukan visual berlebihan.

4. **Riwayat absensi**
   - Tabel: tanggal, hari, status, catatan, kelas, dicatat oleh, waktu pembaruan.
   - Filter status dan rentang tanggal.
   - Urutan terbaru terlebih dahulu.
   - Pagination server-side 20–30 baris per halaman.
   - Empty state yang jelas.

5. **Insight ringan**
   - Kehadiran berturut-turut saat ini.
   - Alfa terakhir.
   - Jumlah ketidakhadiran bulan berjalan.
   - Hindari label menghukum seperti “siswa bermasalah”.

### Entry point

- Nama siswa pada `/rekap-siswa` menjadi link ke `/siswa/{studentId}`.
- Tambahkan tombol `Lihat Profil` pada tabel Kelola Siswa.
- Ranking ketidakhadiran dapat ditautkan kemudian, bukan wajib untuk MVP.

### Keputusan data penting

- Profil memakai `Student.id`, bukan NIS/NISN, karena keduanya dapat diedit.
- Riwayat absensi yang ada tetap tersambung saat nama/NIS/kelas siswa diperbarui.
- Untuk MVP, `kelas` pada riwayat adalah kelas siswa saat ini karena schema belum menyimpan snapshot kelas historis per absensi.
- Jika sekolah membutuhkan histori perpindahan kelas yang akurat, tambahkan model enrollment/class-history pada fase berikutnya; jangan menyimpulkan kelas historis dari data saat ini.

---

### Task 1: Define profile query contract and aggregation tests

**Objective:** Mendefinisikan bentuk data profil dan memastikan agregasi status/tren/streak benar sebelum query UI dibuat.

**Files:**
- Create: `lib/student-profile.ts`
- Create: `tests/student-profile.test.ts`

**Step 1: Write failing tests**

Tambahkan fixture riwayat yang mencakup semua status, lintas bulan, tanggal berurutan, dan catatan kosong. Uji:
- total per status;
- attendance rate;
- tren per bulan;
- current attendance streak;
- last alfa date;
- zero-record behavior.

**Step 2: Verify RED**

Run: `npm test -- tests/student-profile.test.ts`
Expected: FAIL karena helper belum ada.

**Step 3: Implement pure aggregation helpers**

Buat tipe `StudentProfileAttendance` dan helper `summarizeStudentAttendance(records, now)` tanpa ketergantungan Prisma/UI.

**Step 4: Verify GREEN**

Run: `npm test -- tests/student-profile.test.ts`
Expected: seluruh test profil lulus.

**Step 5: Commit**

```bash
git add lib/student-profile.ts tests/student-profile.test.ts
git commit -m "test: define student profile attendance summaries"
```

### Task 2: Add authorized server query

**Objective:** Mengambil profil hanya jika pengguna boleh mengakses kelas siswa tersebut.

**Files:**
- Create: `lib/server-student-profile.ts`
- Modify: `lib/class-access.ts` bila helper reusable diperlukan
- Test: `tests/student-profile-access.test.ts`

**Step 1: Write failing authorization/query contract test**

Uji ADMIN dapat melihat semua siswa, GURU hanya siswa pada kelas yang diizinkan, siswa tak ditemukan menghasilkan not-found, dan filter status/tanggal diterapkan.

**Step 2: Verify RED**

Run: `npm test -- tests/student-profile-access.test.ts`
Expected: FAIL karena query belum tersedia.

**Step 3: Implement query**

Implement `readStudentProfile({ user, studentId, from, to, status, page, pageSize })` dengan:
- `student.findFirst` memakai `schoolClass: classWhere`;
- agregasi periode;
- riwayat `orderBy attendanceDay.date desc`;
- `skip/take` server-side;
- include submitter dan attendance day;
- page size dibatasi maksimal 100.

**Step 4: Verify GREEN**

Run query tests dan `npm test`.

**Step 5: Commit**

```bash
git add lib/server-student-profile.ts lib/class-access.ts tests/student-profile-access.test.ts
git commit -m "feat: add authorized student profile query"
```

### Task 3: Build profile page shell and summary

**Objective:** Menampilkan halaman profil yang responsif dengan identitas dan kartu ringkasan.

**Files:**
- Create: `app/siswa/[studentId]/page.tsx`
- Create: `components/siswa/student-profile-header.tsx`
- Create: `components/siswa/student-attendance-summary.tsx`

**Step 1: Add page-level behavior test**

Uji rendering nama, identitas, kelas, badge status, summary counts, serta not-found/forbidden behavior.

**Step 2: Verify RED**

Run target test; expected route/component belum ada.

**Step 3: Implement minimal page**

- Parse `studentId` dan search params.
- Panggil authorized query.
- Gunakan `notFound()` bila siswa tidak tersedia bagi user.
- Render breadcrumb/back link, header, dan summary cards.

**Step 4: Verify GREEN and accessibility**

Run target test, lint, dan cek heading hierarchy serta label status tidak hanya mengandalkan warna.

**Step 5: Commit**

```bash
git add app/siswa/[studentId]/page.tsx components/siswa/student-profile-header.tsx components/siswa/student-attendance-summary.tsx
git commit -m "feat: add student profile overview"
```

### Task 4: Add trend and detailed history

**Objective:** Menampilkan pola bulanan dan riwayat detail yang dapat difilter.

**Files:**
- Create: `components/siswa/student-attendance-trend.tsx`
- Create: `components/siswa/student-attendance-history.tsx`
- Create: `components/siswa/student-history-filters.tsx`
- Modify: `app/siswa/[studentId]/page.tsx`

**Step 1: Write failing component behavior tests**

Uji tren empty state, row history, note fallback, filter URL, page navigation, dan preservation search params.

**Step 2: Verify RED**

Run target tests; expected fail.

**Step 3: Implement trend**

Gunakan chart SVG/CSS ringan mengikuti token chart yang sudah ada; tampilkan tooltip/label tekstual yang tetap dapat dipahami tanpa warna.

**Step 4: Implement filters/history**

- Status: Semua/Hadir/Sakit/Izin/Dispensasi/Alfa.
- From/to date dengan validasi `from <= to`.
- Pagination server-side.
- Tanggal lokal Indonesia dan status pill existing.

**Step 5: Verify GREEN**

Run component tests dan manual responsive check pada desktop/mobile.

**Step 6: Commit**

```bash
git add components/siswa/student-attendance-trend.tsx components/siswa/student-attendance-history.tsx components/siswa/student-history-filters.tsx app/siswa/[studentId]/page.tsx
git commit -m "feat: add student attendance timeline"
```

### Task 5: Link profile from existing student views

**Objective:** Membuat profil mudah ditemukan dari alur yang sudah dipakai.

**Files:**
- Modify: `app/rekap-siswa/page.tsx`
- Modify: `components/siswa/student-manager.tsx`

**Step 1: Write failing link tests**

Uji setiap row memiliki href `/siswa/{id}` dan aksi admin tetap tidak memicu navigasi yang salah.

**Step 2: Verify RED**

Run tests; expected link belum ada.

**Step 3: Implement links**

- Nama siswa di Rekap Siswa menjadi link ber-style jelas.
- Tambahkan tombol `Profil` di Kelola Siswa, terpisah dari Edit/Nonaktifkan/Hapus.

**Step 4: Verify GREEN**

Run tests dan smoke test navigasi.

**Step 5: Commit**

```bash
git add app/rekap-siswa/page.tsx components/siswa/student-manager.tsx
git commit -m "feat: link student lists to profiles"
```

### Task 6: Full validation and documentation

**Objective:** Memastikan feature aman, benar, dan siap dicoba lokal.

**Files:**
- Modify: `README.md` bila dokumentasi fitur diperlukan

**Step 1: Automated verification**

```bash
npm test
npm run lint
npm run build
```

Expected: seluruhnya berhasil tanpa warning/error.

**Step 2: Seed meaningful local history fixture**

Gunakan schema lokal saja; tambahkan data absensi beberapa tanggal untuk satu siswa agar profil tidak kosong saat demo. Jangan commit credential atau `.env`.

**Step 3: Manual smoke test**

- Login ADMIN.
- Buka Rekap Siswa.
- Klik nama siswa.
- Verifikasi ringkasan, tren, filter status, rentang tanggal, pagination, back navigation.
- Login GURU dan verifikasi akses lintas kelas ditolak.
- Uji mobile width dan tabel horizontal/pagination.

**Step 4: Commit and push after explicit review**

```bash
git add README.md
git commit -m "docs: document student profile workflow"
git push origin main
```

---

## Risks and tradeoffs

- **Kelas historis:** schema saat ini tidak menyimpan enrollment history; kelas pada row historis tidak boleh diklaim sebagai kelas siswa pada tanggal tersebut.
- **Performa:** jangan include semua attendance tanpa pagination; agregasi dapat dilakukan dalam query terpisah atau SQL aggregation jika data besar.
- **Timezone:** perbandingan tanggal harus mengikuti helper lokal project agar tidak bergeser satu hari.
- **Otorisasi:** jangan expose endpoint umum berdasarkan `studentId` tanpa filter kelas dari `getClassAccess`.
- **Siswa nonaktif:** profil dan history tetap harus dapat dilihat admin; guru mengikuti kebijakan akses kelas.
- **Privasi:** hindari menampilkan informasi pribadi di URL atau export tanpa otorisasi.

## MVP recommendation

Implementasi pertama sebaiknya mencakup header profil, lima ringkasan status, persentase hadir, tren bulanan sederhana, tabel riwayat berfilter, dan entry point dari Rekap/Kelola Siswa. Histori perpindahan kelas, dokumen siswa, catatan konseling, grafik prediktif, dan notifikasi orang tua sebaiknya tidak dimasukkan dulu.
