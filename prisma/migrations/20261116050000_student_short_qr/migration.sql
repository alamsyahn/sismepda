BEGIN;
ALTER TABLE "StudentQrCredential" ADD COLUMN "shortTokenHash" TEXT;
CREATE UNIQUE INDEX "StudentQrCredential_shortTokenHash_key" ON "StudentQrCredential"("shortTokenHash");
COMMIT;
