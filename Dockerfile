FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Skrip postinstall (prisma generate) butuh prisma/schema.prisma yang belum
# tersedia di stage ini; generate dijalankan eksplisit pada stage builder.
# Paksa engine Prisma terunduh saat build agar migrator tidak bergantung pada
# binaries.prisma.sh ketika dijalankan di production.
RUN PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x npm ci --ignore-scripts \
  && node node_modules/@prisma/engines/scripts/postinstall.js

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-bookworm-slim AS migrator
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/app/generated ./app/generated
COPY prisma ./prisma
# prisma/seed.ts mengimpor lib/database-config dan lib/workbook-master.
COPY lib ./lib
# tsconfig.json memiliki path alias `@/*`; tsx membacanya untuk me-resolve
# impor seperti "@/lib/rbac-legacy" pada lib/rbac-backfill.ts. Tanpa berkas ini
# perintah backfill legacy gagal MODULE_NOT_FOUND di dalam image.
COPY prisma.config.ts package.json tsconfig.json ./
# Deployment normal HANYA menjalankan migrate deploy. Seed adalah operasi
# bootstrap eksplisit untuk database baru (`--entrypoint sh migrate -c "npx
# prisma db seed"`), bukan bagian rilis rutin: menjalankannya pada tiap deploy
# akan menulis ulang akun/data referensi pada database produksi yang sudah hidup.
CMD ["sh", "-c", "npx prisma migrate deploy"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Titik mount penyimpanan media. Direktori sengaja dibuat dan di-chown SEBELUM
# volume dipasang: volume Docker yang masih kosong mewarisi kepemilikan dari
# direktori ini, dan tanpa langkah ini proses uid 1001 tidak akan bisa menulis
# unggahan ke dalamnya. Isinya sendiri tidak pernah masuk image.
RUN mkdir -p /app/media && chown nextjs:nodejs /app/media
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
