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

Kebutuhan minimum yang disarankan:

- Ubuntu 22.04/24.04 atau Debian 12.
- RAM 2 GB, 2 vCPU, dan penyimpanan 20 GB.
- Docker Engine beserta plugin Docker Compose.
- Domain yang record `A`-nya mengarah ke IP publik VPS.
- Port TCP 80/443 dan UDP 443 terbuka.

### 1. Siapkan environment

Salin template berikut pada VPS:

```bash
cp .env.production.example .env.production
nano .env.production
```

Gunakan password PostgreSQL berbentuk alfanumerik/hex agar aman digunakan dalam URL. Contoh pembuatan secret:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Isi `POSTGRES_PASSWORD` dan bagian password pada `DATABASE_URL` dengan nilai hex yang sama. Isi `AUTH_SECRET` dengan hasil perintah kedua. Jangan commit `.env.production`.

### 2. Jalankan

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f migrate app caddy
```

Caddy otomatis meminta dan memperpanjang sertifikat HTTPS. Setelah container sehat, buka `https://DOMAIN_ANDA` dan login memakai `SEED_ADMIN_EMAIL` serta `SEED_ADMIN_PASSWORD`.

### 3. Update aplikasi

Setelah source code terbaru tersedia di VPS:

```bash
docker compose --env-file .env.production up -d --build
docker image prune -f
```

Container `migrate` menjalankan migration Prisma yang belum diterapkan dan seed sebelum versi aplikasi baru dimulai.

### Backup PostgreSQL

```bash
mkdir -p backups
docker compose --env-file .env.production exec -T db pg_dump -U sismepda -d sismepda -Fc > backups/sismepda-$(date +%F-%H%M).dump
```

Salin backup secara berkala ke mesin/lokasi lain. Volume Docker saja bukan backup.

Restore ke database kosong:

```bash
docker compose --env-file .env.production exec -T db pg_restore -U sismepda -d sismepda --clean --if-exists < backups/NAMA_FILE.dump
```

### Operasional

```bash
# Melihat status
docker compose --env-file .env.production ps

# Melihat log aplikasi
docker compose --env-file .env.production logs -f --tail=200 app

# Restart aplikasi
docker compose --env-file .env.production restart app

# Menghentikan stack tanpa menghapus data
docker compose --env-file .env.production down
```

Jangan menjalankan `docker compose down -v`, karena opsi `-v` menghapus volume PostgreSQL.

## Menjalankan development dengan PostgreSQL

Jalankan PostgreSQL lokal dan isi `.env` dengan `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, serta `SEED_ADMIN_PASSWORD`, kemudian:

```bash
npm install
npm run db:setup
npm run dev
```

Database SQLite lama tidak lagi digunakan karena schema sekarang disiapkan langsung untuk PostgreSQL production.
