BEGIN;

ALTER TABLE "User"
DROP CONSTRAINT "User_login_identifier_check",
ADD CONSTRAINT "User_login_identifier_check"
CHECK (
  NULLIF(BTRIM("nip"), '') IS NOT NULL
  OR NULLIF(BTRIM("email"), '') IS NOT NULL
  OR ("studentId" IS NOT NULL AND NOT "isTeacher")
) NOT VALID;

COMMIT;
