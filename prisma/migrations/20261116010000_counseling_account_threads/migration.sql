BEGIN;

ALTER TABLE "CounselingMessage" ADD COLUMN "participantId" TEXT;

-- Assign old conversations to their original sender. Stop if ownership is
-- ambiguous so messages cannot be attached to a different account.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CounselingMessage"
    GROUP BY "studentId"
    HAVING count(DISTINCT "authorId") FILTER (WHERE "fromStudent") <> 1
  ) THEN
    RAISE EXCEPTION 'A legacy counseling conversation has no unique sender';
  END IF;
END $$;

UPDATE "CounselingMessage" AS message
SET "participantId" = owner."authorId"
FROM (
  SELECT DISTINCT "studentId", "authorId"
  FROM "CounselingMessage"
  WHERE "fromStudent"
) AS owner
WHERE message."studentId" = owner."studentId";

ALTER TABLE "CounselingMessage"
  ALTER COLUMN "participantId" SET NOT NULL,
  ADD CONSTRAINT "CounselingMessage_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP COLUMN "studentId";
ALTER TABLE "CounselingMessage" RENAME COLUMN "fromStudent" TO "fromSender";
CREATE INDEX "CounselingMessage_participantId_createdAt_id_idx"
  ON "CounselingMessage"("participantId", "createdAt", "id");

COMMIT;
