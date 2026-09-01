# SISMEPDA

Dashboard absensi sekolah berbasis Next.js 16, Auth.js, Prisma, dan PostgreSQL. Repository ini merupakan versi lengkap yang dikembangkan dari proyek SISMEPDA Dashboard.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, dan `SEED_ADMIN_PASSWORD`.
2. Pastikan PostgreSQL lokal aktif.
3. Jalankan:

```bash
npm install
npm run db:setup
npm run dev
```

Buka `http://localhost:3000`. Prisma Client dibuat otomatis setelah `npm install`.

## Hak akses

- `ADMIN`: seluruh halaman dan seluruh kelas.
- `GURU`: dashboard, input absensi, halaman rekap, dan export data absensi.
- Secara default guru hanya dapat melihat dan menyimpan absensi kelas yang ditugaskan kepadanya.
- Admin dapat mengaktifkan **Izinkan guru mengakses seluruh kelas** di Pengaturan agar seluruh guru dapat melihat, mengekspor, menginput, dan memperbarui absensi semua kelas.

Admin membuat akun guru melalui Input Guru, lalu menetapkan kelas melalui Wali Kelas.

## Deployment VPS dengan Docker

Deployment produksi di VPS SMPN 2 Blitar memakai infrastruktur bersama yang sudah
ada, bukan membuat PostgreSQL atau Caddy baru:

```text
Internet -> edge-caddy-1 -> network edge -> sismepda-new-app:3000
                                       app -> sismepda-dashboard_internal -> db:5432
```

### 1. Siapkan environment

```bash
cp .env.production.example .env.production
nano .env.production
```

Jangan commit `.env.production`. Gunakan kembali kredensial database,
`AUTH_SECRET`, dan akun admin dari deployment lama; jangan membuat secret baru
saat cutover. `DOMAIN` produksi adalah `app.smpn2blitar.sch.id`.

### 2. Validasi dan build

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production build
```

`compose.edge.yaml` menyambungkan hanya service `app` ke network eksternal
`edge` dengan alias `sismepda-new-app`. Stack ini tidak memublikasikan port
80/443 atau 5432 dan tidak menjalankan Caddy/PostgreSQL baru.

### 3. Migrasi dan startup (hanya saat jadwal deployment disetujui)

Sebelum migrasi, pastikan koneksi menuju database yang dimaksud. Migrasi
production harus dijalankan terpisah dan diperiksa sebelum aplikasi dinaikkan:

```bash
docker compose --env-file .env.production --profile migration run --rm -T migrate \
  sh -c 'npx prisma migrate status && npx prisma migrate deploy && npx prisma db seed'
docker compose --env-file .env.production up -d app
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f --tail=200 app
```

Shared Caddy harus dikonfigurasi secara terpisah untuk meneruskan
`app.smpn2blitar.sch.id` ke `sismepda-new-app:3000`. Blok yang nantinya perlu
ditambahkan ke Caddyfile edge adalah:

```caddyfile
app.smpn2blitar.sch.id {
    encode zstd gzip

    reverse_proxy sismepda-new-app:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
}
```

Validasi Caddyfile sebelum reload. Jangan jalankan Compose atau mengubah edge
Caddy sebelum backup, maintenance window, dan cutover disetujui.

### Operasional

```bash
# Melihat status/log aplikasi baru
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f --tail=200 app

# Restart hanya aplikasi baru
docker compose --env-file .env.production restart app

# Hentikan hanya stack baru (external networks/data tidak dihapus)
docker compose --env-file .env.production down
```

Backup/restore database tetap dilakukan melalui container PostgreSQL produksi
yang sudah ada (`sismepda-dashboard-db-1`), bukan melalui Compose repo baru.
Jangan menjalankan operasi restore/drop tanpa prosedur maintenance terpisah.

## Menjalankan development dengan PostgreSQL

Jalankan PostgreSQL lokal dan isi `.env` dengan `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, serta `SEED_ADMIN_PASSWORD`, kemudian:

```bash
npm install
npm run db:setup
npm run dev
```

Database SQLite lama tidak lagi digunakan karena schema sekarang disiapkan langsung untuk PostgreSQL production.
