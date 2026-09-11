-- Business calendar values must be PostgreSQL DATE, not timestamps.
--
-- Historical audit requirement: legacy writers stored canonical date-only values
-- as timestamp-without-time-zone at exactly 00:00:00. Any non-midnight value is
-- ambiguous (it may encode a local/UTC projection), so this migration aborts
-- rather than guessing and silently shifting a business date.
-- Block legacy writes to every converted table before validation, and keep the
-- locks through collision checks and conversion within this migration transaction.
LOCK TABLE "AttendanceDay" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "SchoolHoliday" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "AdditionalDuty" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "StudentViolationPoint" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "BosEntry" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "SarprasItem" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  ambiguous_values BIGINT;
BEGIN
  SELECT
    (SELECT count(*) FROM "AttendanceDay" WHERE date::time <> time '00:00:00') +
    (SELECT count(*) FROM "SchoolHoliday" WHERE date::time <> time '00:00:00') +
    (SELECT count(*) FROM "User" WHERE "teachingSince" IS NOT NULL AND "teachingSince"::time <> time '00:00:00') +
    (SELECT count(*) FROM "AdditionalDuty" WHERE "startDate" IS NOT NULL AND "startDate"::time <> time '00:00:00') +
    (SELECT count(*) FROM "StudentViolationPoint" WHERE "occurredAt"::time <> time '00:00:00') +
    (SELECT count(*) FROM "BosEntry" WHERE "occurredAt"::time <> time '00:00:00') +
    (SELECT count(*) FROM "SarprasItem" WHERE "acquisitionDate" IS NOT NULL AND "acquisitionDate"::time <> time '00:00:00')
  INTO ambiguous_values;

  IF ambiguous_values > 0 THEN
    RAISE EXCEPTION
      'Date-only migration aborted: % non-midnight legacy value(s) require manual review',
      ambiguous_values;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AttendanceDay"
    GROUP BY "classId", date::date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Date-only migration aborted: AttendanceDay(classId, date) collision detected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SchoolHoliday"
    GROUP BY date::date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Date-only migration aborted: SchoolHoliday(date) collision detected';
  END IF;
END $$;

-- Midnight legacy literals already represent the intended calendar date. Casting
-- directly preserves that literal independently of database/session timezone.
ALTER TABLE "AttendanceDay"
  ALTER COLUMN "date" TYPE DATE USING "date"::date;

ALTER TABLE "SchoolHoliday"
  ALTER COLUMN "date" TYPE DATE USING "date"::date;

ALTER TABLE "User"
  ALTER COLUMN "teachingSince" TYPE DATE USING "teachingSince"::date;

ALTER TABLE "AdditionalDuty"
  ALTER COLUMN "startDate" TYPE DATE USING "startDate"::date;

ALTER TABLE "StudentViolationPoint"
  ALTER COLUMN "occurredAt" TYPE DATE USING "occurredAt"::date;

ALTER TABLE "BosEntry"
  ALTER COLUMN "occurredAt" TYPE DATE USING "occurredAt"::date;

ALTER TABLE "SarprasItem"
  ALTER COLUMN "acquisitionDate" TYPE DATE USING "acquisitionDate"::date;
