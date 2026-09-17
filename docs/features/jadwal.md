# Jadwal

Satu menu sidebar (`/jadwal`) berisi lima tab: **Jadwal Saya**, **Jadwal Kelas**,
**Jam Kosong Guru**, **Kelola Jadwal**, dan **Waktu & Kegiatan**. Dua tab
terakhir hanya muncul bagi pemegang permission pengelolaan. Tidak ada submenu
sidebar terpisah untuk masing-masing tab.

Modul ini memisahkan empat hal yang sering tercampur:

| Lapisan | Pemilik | Berkas |
|---|---|---|
| Otorisasi | permission RBAC `schedule.*` | `lib/schedule-authorization.ts`, `lib/schedule-access.ts` |
| Identitas guru | role key `guru` + tautan `User` ↔ Data Master Guru | `lib/teacher-population.ts`, `lib/server-schedule.ts` |
| Jadwal | revisi + penempatan (`ScheduleRevision`, `ScheduleEntry`) | `lib/server-schedule.ts` |
| Pemetaan eksternal | `ScheduleExternalMapping` | `lib/asc-mapping.ts`, `lib/server-schedule-import.ts` |

## Siapa yang dianggap guru

Guru ditentukan oleh **role key `guru`**, bukan nama tampilan role — nama
tampilan boleh berubah dan boleh berduplikat. Modul ini memakai
`teacherPopulationWhere()` yang sudah dipakai fitur lain, sehingga seorang guru
harus:

1. memiliki role dengan `key === "guru"` (multi-role tetap dihitung: Guru +
   Kepala Sekolah tetap guru), dan
2. akun aktif (`active: true`), dan
3. terhubung dengan Data Master Guru melalui akun yang sama.

Role lama **`legacy_guru` bukan bagian dari logika ini**. Akun yang hanya
memegang `legacy_guru` tidak muncul sebagai guru di modul Jadwal; migrasi
keanggotaan `legacy_guru` → `guru` dikerjakan administrator secara manual di
luar modul ini.

Selama migrasi itu belum dijalankan, populasi guru bisa **kosong sepenuhnya**.
Itu keadaan sah, bukan kerusakan — tetapi UI wajib menjelaskannya. Dropdown guru
di tab "Jadwal Saya" dan di tabel pemetaan impor dinonaktifkan saat daftar
kosong dan disertai keterangan syarat populasi guru, supaya tidak tampak seperti
komponen rusak yang membuka menu tanpa isi. Aturan yang sama berlaku untuk kelas
dan mata pelajaran ketika Data Master-nya masih kosong.

`User` adalah entitas guru itu sendiri (`ScheduleEntry.teacherId → User`), sama
seperti `TeachingAssignment` yang sudah ada — modul ini tidak menambah entitas
guru kedua.

## Waktu & Kegiatan adalah sumber kebenaran jam

`ScheduleEntry` menyimpan **nomor jam** (`day`, `period`), bukan pukul. Pukul
selalu diresolusi dari profil waktu aktif:

```
ScheduleTimeProfile (Reguler, Ramadan, …)  — tepat satu `active`
└── ScheduleProfileDay   day (1=Senin … 7=Minggu) | position
    └── ScheduleTimeSlot  position | kind | name | startMinute | endMinute | ascPeriod
```

Struktur waktu dimiliki **hari**, bukan profil. Hari disimpan sebagai baris,
bukan enam kolom, sehingga menambah atau menghapus hari aktif tidak pernah
membutuhkan migrasi. Profil baru dibuat dengan Senin–Sabtu (`DEFAULT_PROFILE_DAYS`)
— itu nilai awal, bukan aturan yang dipaku.

`kind` bernilai `PELAJARAN`, `ISTIRAHAT`, atau `KEGIATAN`. Hanya `PELAJARAN`
yang boleh memiliki `ascPeriod`, dan `ascPeriod` unik **per hari**: inilah satu-
satunya jembatan antara `card.period` pada XML aSc dan jam dinding sekolah.

Keunikan berlingkup hari inilah inti fiturnya. `card.period` menyatakan *jam
ke-berapa*, bukan pukul berapa; pukulnya baru ditentukan oleh profil + hari +
nomor jam (`resolveSlotForDayPeriod`). Karena itu jam ke-1 boleh berakhir 07:40
pada Senin dan 07:30 pada Jumat, dan sebuah hari yang tidak punya jam ke-3
menjawab "tidak ada" alih-alih meminjam jam hari lain.

Waktu disimpan sebagai **menit sejak tengah malam (0..1439)**, bukan `DateTime`,
karena ini jam dinding yang berlaku setiap hari — menyimpannya sebagai timestamp
akan menyeret tanggal dan zona waktu ke data yang tidak memilikinya.

Penyuntingan struktur waktu (`PUT /api/jadwal/waktu`) mengganti seluruh daftar
slot **satu hari** dalam satu transaksi setelah validasi: format jam benar, mulai
< selesai, tidak ada tumpang tindih, `ascPeriod` hanya pada `PELAJARAN` dan
tidak berduplikat. Mengubah jam menggeser tampilan seluruh sekolah pada hari itu
tanpa menyentuh satu pun penempatan, dan tanpa menyentuh hari lain.

### Migrasi ke struktur per hari

Migrasi `20260917150000_schedule_time_per_day_and_templates` bersifat
**expand → backfill → switch**, bukan destruktif. Setiap profil memperoleh
Senin–Sabtu; baris slot lama TIDAK dipindahkan maupun dibuat ulang — Senin
memakai baris yang sudah ada (id lama tetap hidup), sedangkan Selasa–Sabtu
menerima salinan deterministik (id diturunkan dari `md5(id sumber + hari)`).
Hasilnya perilaku aplikasi sesudah migrasi identik dengan sebelumnya: period 4
pada hari apa pun menunjuk jam dinding yang sama seperti dulu.

Keunikan lama berlingkup profil (`profileId, position` dan `profileId, ascPeriod`)
dibuang **sebelum** penyalinan, lalu dibangun kembali berlingkup hari — tanpa
urutan itu penyalinan Selasa–Sabtu pasti melanggar constraint. Slot yatim tidak
menyebabkan penghapusan diam-diam: migrasi justru `RAISE EXCEPTION` dan
membatalkan seluruh transaksi agar data yang tidak dipahami tidak hilang.

### Template waktu adalah salinan, bukan referensi

`ScheduleTimeTemplate` + `ScheduleTimeTemplateSlot` menyimpan struktur siap
pakai ("Reguler Senin–Kamis", "Ramadan"). Template **tidak** punya foreign key
ke hari mana pun, dan sebaliknya. Menerapkan template ke sebuah hari, menyalin
hari ke hari lain, atau menyimpan hari sebagai template selalu berarti
menuliskan baris baru (`snapshotSlots` membuang id sumber dan merapatkan urutan
menjadi 1..n).

Konsekuensinya disengaja: mengedit atau menghapus template tidak pernah
mengubah hari yang pernah memakainya, dan mengubah hari sumber tidak pernah
mengubah hari hasil salinan. Template boleh dihapus tanpa merusak jadwal.
Semua operasi salin/ganti berjalan dalam satu transaksi, dan hasil salinan
melewati validasi yang sama dengan penyuntingan manual — apply/copy bukan pintu
belakang untuk data korup. Menimpa hari yang sudah terisi selalu didahului
konfirmasi di UI.

Endpoint: `/api/jadwal/waktu` (struktur per hari, tambah/hapus hari, salin
antarhari) dan `/api/jadwal/waktu/template` (daftar, buat, buat-dari-hari,
edit, duplikat, hapus, terapkan). Membaca cukup dengan izin baca jadwal; semua
mutasi menuntut permission `schedule.time.manage` yang sudah ada — tidak ada
permission baru dan tidak ada pengecekan nama role.

Beberapa profil didukung schema dan API, tetapi UI saat ini hanya menyunting
profil aktif; menambah profil Ramadan berarti menambah baris `ScheduleTimeProfile`
tanpa perubahan schema.

Hari ini dan jam sekarang memakai helper zona waktu sekolah yang sudah ada
(`lib/school-time-zone.ts`, `lib/school-date.ts`), bukan jam kontainer.

## Jam Kosong Guru

Nama fitur sengaja **Jam Kosong Guru**, bukan "Guru Tersedia": tidak adanya
jadwal mengajar tidak berarti guru bebas tugas.

Perhitungannya: ambil populasi guru (definisi di atas), kurangi guru yang
memiliki `ScheduleEntry` pada revisi aktif dengan `day` dan `period` yang
dipilih. Default hari = hari ini, default jam = slot pelajaran yang sedang
berlangsung. Bila saat ini bukan slot `PELAJARAN` (istirahat/kegiatan/di luar
jam sekolah), UI menyatakan hal itu dan meminta pengguna memilih jam pelajaran,
bukan menampilkan daftar "kosong" yang menyesatkan.

Daftar guru tidak pernah diambil dari entitas `<teacher>` pada XML.

## Revisi dan rollback

```
ScheduleRevision  number | source (ASC_IMPORT | MANUAL | ROLLBACK) | active | summary
└── ScheduleEntry …
```

Tepat satu revisi `active`. Setiap revisi menyimpan **snapshot penuh**: satu
revisi kira-kira sebesar jumlah slot mengajar satu sekolah (ribuan baris berisi
ID saja), sedangkan diff inkremental membuat pertanyaan "jadwal Rabu" hanya bisa
dijawab dengan memutar ulang seluruh riwayat.

Suntingan manual pertama setelah sebuah impor membuat revisi `MANUAL` baru dari
salinan revisi aktif, sehingga versi hasil impor tetap utuh sebagai titik balik.
Rollback menyalin revisi lama menjadi revisi baru bersumber `ROLLBACK` — tidak
ada riwayat yang dihapus. Rollback dilindungi permission, meminta konfirmasi,
atomik, dan tercatat di audit log.

## Suntingan manual

`POST`/`PATCH`/`DELETE /api/jadwal/entries` mengubah satu penempatan (hari,
period, kelas, mapel, guru, ruang) tanpa perlu membuka aSc. Validasi bentrok:

- satu kelas tidak boleh punya dua pelajaran pada slot yang sama — ditegakkan
  constraint database `@@unique([revisionId, day, period, classId])`;
- satu guru tidak boleh punya dua penempatan pada slot yang sama — ditegakkan di
  lapisan aplikasi, **bukan** constraint database, karena satu guru sah mengajar
  kelas gabungan; pengecualian ini disengaja dan pesan galatnya menyebut
  bentrokannya.

Tidak ada penimpaan diam-diam: setiap bentrok ditolak dengan penjelasan.

## Impor aSc TimeTables

XML menentukan **siapa mengajar apa, di kelas mana, hari apa, period berapa**.
XML **tidak** menentukan jam mulai/selesai; `starttime`/`endtime` hanya
ditampilkan sebagai informasi saat pratinjau.

Alur wajib dua langkah — tidak ada jalur "pilih berkas lalu langsung timpa":

1. `POST /api/jadwal/impor` — unggah XML lewat slot upload terdaftar
   `schedule.asc.xml` (batas ukuran dari konfigurasi upload global, lihat
   `docs/architecture/uploads.md`; tidak ada konstanta ukuran di route).
2. Parse (`fast-xml-parser`, entity eksternal dimatikan; tidak ada regex),
   resolve `card.lessonid → lesson → teacher/class/subject/period/days`. Urutan
   node tidak diandalkan. XML rusak, referensi menggantung, nilai kosong, dan
   duplikat menjadi galat/peringatan yang dapat dibaca, bukan crash.
3. Resolve pemetaan, hitung diff terhadap revisi aktif.
4. Pratinjau: ringkasan guru/kelas/mapel yang dikenali vs perlu dipetakan, dan
   jadwal `+ baru / ~ berubah / − dihapus`, dengan detail per baris.
5. Apply (`POST /api/jadwal/impor/[importId]`) dalam satu transaksi: revisi baru
   dibuat utuh lalu dijadikan aktif. Bila gagal di tengah, jadwal aktif lama
   tetap utuh dan tidak ada data separuh masuk.

Berkas XML mentah tidak disimpan; yang disimpan hanya hasil parse ternormalisasi
(`ScheduleImport.payload`) dan ringkasannya.

**Pemetaan yang belum selesai memblokir Apply.** Guru, kelas, dan mapel aSc yang
belum dipetakan semuanya menjadi *blocker*: pratinjau menyebutkannya satu per
satu, dan `POST /api/jadwal/impor/[importId]` menolak dengan `409` selama masih
ada blocker. Bentrok pada hasil impor juga menjadi blocker. Admin memperbaiki
pemetaan lalu memuat ulang pratinjau sampai bersih.

### Pemetaan external ID dan nama typo

Pencocokan nama **tidak pernah** dipakai untuk mengikat data. Yang disimpan dan
dipakai impor berikutnya adalah pasangan ID:

```
ScheduleExternalMapping  source=ASC_TIMETABLES | entityType=TEACHER|CLASS|SUBJECT
                         externalId (dari XML) → internalId (SISMEPDA)
```

Normalisasi nama (huruf kecil, rapatkan spasi, abaikan tanda baca, lepas gelar
seperti `S.Pd.`, kemiripan Dice bigram) hanya dipakai untuk **menyarankan**
kandidat kepada admin. Kandidat berkemiripan tinggi dan tidak ambigu ditandai
percaya tinggi tetapi tetap harus dilihat admin sebelum Apply; kandidat ambigu
ditampilkan sebagai beberapa pilihan dan **tidak pernah** ditautkan otomatis.

Karena itu `Muhammad Nur Alamsyah, S.pd.` di XML dan `Muhammad Nur Alamsyah,
S.Pd.` di SISMEPDA tidak menjadi masalah setelah dipetakan sekali; impor
berikutnya memakai external ID walau nama XML berubah. Bila external ID aSc
berubah (guru dihapus lalu dibuat ulang), datanya dianggap belum dipetakan dan
ditawarkan ulang — tidak pernah diam-diam membuat Data Master Guru baru. Nama
resmi Data Master tidak pernah ditimpa nama dari XML.

`INFORMATIKA` ↔ `Informatika` dan `PPKn` ↔ `Pendidikan Pancasila` ditangani
dengan mekanisme yang sama.

### Suntingan manual vs impor berikutnya

Semantiknya sengaja dibuat dapat ditebak, bukan merge otomatis: **Apply
menjadikan hasil impor sebagai jadwal aktif baru**. Suntingan manual yang
berbeda dari berkas akan tertimpa, dan pratinjau menampilkannya sebagai
perubahan `~`/`−` sebelum admin menekan Terapkan. Revisi manual sebelumnya tetap
tersimpan dan dapat di-rollback.

## Permission

Modul `schedule` pada katalog RBAC (`lib/rbac-permissions.ts`):

| Key | Kegunaan |
|---|---|
| `schedule.own.read` | Membuka menu Jadwal dan melihat jadwal sendiri |
| `schedule.classes.read` | Tab Jadwal Kelas |
| `schedule.teachers.read` | Memilih guru lain pada tab Jadwal Saya |
| `schedule.free_teachers.read` | Tab Jam Kosong Guru |
| `schedule.entries.create` / `.update` / `.delete` | Editor jadwal manual |
| `schedule.time.manage` | Tab Waktu & Kegiatan |
| `schedule.import` | Unggah, pratinjau, dan terapkan impor aSc |
| `schedule.revisions.read` | Riwayat versi |
| `schedule.revisions.rollback` | Kembalikan ke versi sebelumnya |

Template role bawaan `guru` mendapat tiga permission melihat
(`schedule.own.read`, `schedule.classes.read`, `schedule.free_teachers.read`).
Template hanya menetapkan permission role; keanggotaan role tidak disentuh.
Satu-satunya bypass adalah mekanisme Admin Sistem yang sudah ada
(`SYSTEM_ADMIN_ROLE_KEY`); tidak ada pengecualian berbasis nama role.

Pengguna non-guru yang memegang `schedule.teachers.read` tetap mendapat tab
Jadwal Saya dan dapat memilih guru — tidak ada galat hanya karena ia tidak punya
profil guru sendiri.

## Route dan komponen

| Route API | Metode |
|---|---|
| `/api/jadwal/guru` | `GET` jadwal satu guru |
| `/api/jadwal/kelas` | `GET` jadwal satu kelas satu hari |
| `/api/jadwal/jam-kosong` | `GET` guru tanpa jadwal pada slot |
| `/api/jadwal/entries` | `GET`/`POST`/`PATCH`/`DELETE` penempatan |
| `/api/jadwal/waktu` | `GET`/`PUT` struktur Waktu & Kegiatan |
| `/api/jadwal/revisi` | `GET` riwayat, `POST` rollback |
| `/api/jadwal/impor` | `GET` daftar, `POST` unggah + pratinjau |
| `/api/jadwal/impor/[importId]` | `GET` pratinjau, `POST` terapkan, `DELETE` batal |
| `/api/jadwal/mapping` | `GET`/`PUT` pemetaan external ID |

Setiap route memanggil `requireSchedulePermission()` di server; tombol yang
disembunyikan di peramban bukan pengaman. `lib/route-policy.ts` bersifat
fail-closed sehingga tidak ada route yang lolos tanpa pemeriksaan.

Halaman: `app/jadwal/page.tsx` → `components/jadwal/schedule-view.tsx` (shell
tab) dengan `my-schedule-tab`, `class-schedule-tab`, `free-teachers-tab`,
`manage-schedule-tab`, `time-structure-tab`, `import-panel`,
`schedule-entry-dialog`, dan `schedule-week-grid`.

Desktop memakai grid Jam × Senin–Sabtu; mobile memakai pilihan hari berupa chip
dan daftar slot vertikal, bukan tabel horizontal sangat lebar.

## Batas bundel client

`lib/server-schedule.ts` dan `lib/server-schedule-import.ts` adalah satu-satunya
pintu ke Prisma. Komponen klien hanya boleh mengimpor **tipe** dari berkas
tersebut; mengimpor value akan menyeret Prisma ke bundel peramban dan memecah
`next build`. Logika murni yang dipakai bersama klien dan server berada di
`lib/schedule-constants.ts`, `lib/schedule-time.ts`,
`lib/schedule-authorization.ts`, `lib/asc-timetable-parser.ts`,
`lib/asc-mapping.ts`, dan `lib/schedule-diff.ts`. Aturan ini diuji otomatis.

## Audit log

Memakai `AuditLog` yang sudah ada, entitas `ScheduleTimeProfile`,
`ScheduleProfileDay`, `ScheduleTimeTemplate`,
`ScheduleTimeSlot`, `ScheduleRevision`, `ScheduleEntry`,
`ScheduleExternalMapping`, `ScheduleImport`. Yang dicatat: unggah dan penerapan
impor, impor gagal, perubahan pemetaan, tambah/ubah/hapus jadwal manual,
perubahan Waktu & Kegiatan, rollback, dan pergantian jadwal aktif. Isi XML tidak
pernah masuk audit log — hanya nama berkas, waktu, aktor, jumlah perubahan, ID
revisi, dan ringkasan.

## Pengujian

```
npx tsx --test tests/schedule-asc-parser.test.ts \
                tests/schedule-asc-mapping.test.ts \
                tests/schedule-time.test.ts \
                tests/schedule-time-days.test.ts \
                tests/schedule-conflicts.test.ts \
                tests/schedule-authorization.test.ts
```

Berkasnya berturut-turut menguji: parser aSc (resolusi lesson/card, hari,
period, XML tidak valid, referensi menggantung, entity eksternal); pemetaan dan
penanganan typo (external ID menang atas nama, ambigu tidak auto-link);
struktur waktu, deteksi jam berjalan, dan zona waktu sekolah; struktur per hari
dan semantik salinan template (hari berdiri sendiri, edit/hapus template tidak
merembet, migrasi bersifat expand-backfill); bentrok guru dan
kelas serta diff impor; dan otorisasi, role key `guru` versus nama tampilan,
multi-role, `legacy_guru`, serta batas bundel client.
