# SISMEPDA

Sistem operasional sekolah berbasis Next.js 16, Auth.js, Prisma 7, dan PostgreSQL. Modul saat ini mencakup absensi dan pelaporan, data siswa/guru, profil dan jadwal, supervisi Buku Kerja, BOS, Sarpras, pengaturan, serta backup/restore.

## Documentation

[`docs/README.md`](docs/README.md) adalah peta dan knowledge base canonical untuk architecture, fitur, operasi, dan technical debt. Kontributor dan Hermes harus mengikuti workflow di [`.hermes.md`](.hermes.md): baca dokumentasi relevan, inspect source secara targeted, implementasi, test, lalu review/update dokumentasi.

## Quick start

1. Salin `.env.example` ke `.env` dan isi `DATABASE_URL`, `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, serta `SEED_ADMIN_PASSWORD`.
2. Pastikan PostgreSQL aktif.
3. Jalankan:

```bash
npm install
npm run db:setup:local
npm run dev:local
```

Buka `http://localhost:3000`.

Panduan lengkap:

- [Development dan quality gates](docs/operations/development.md)
- [Deployment dan migration](docs/operations/deployment.md)
- [Backup dan restore](docs/operations/backup-restore.md)
- [Authentication dan authorization](docs/architecture/authentication-authorization.md)

Jangan commit file environment atau nilai secret. Konfigurasi deployment repository menggunakan jaringan PostgreSQL dan edge proxy eksternal; verifikasi state host sebelum perubahan produksi.
