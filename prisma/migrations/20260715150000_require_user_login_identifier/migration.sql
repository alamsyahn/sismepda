-- Jangan memblokir deploy jika ada akun lama yang belum memiliki NIP maupun
-- email. Constraint tetap berlaku untuk setiap data baru atau data yang diubah.
ALTER TABLE "User"
ADD CONSTRAINT "User_login_identifier_check"
CHECK (
  NULLIF(BTRIM("nip"), '') IS NOT NULL
  OR NULLIF(BTRIM("email"), '') IS NOT NULL
) NOT VALID;
