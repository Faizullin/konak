-- The invariant SQLite could not hold: two stays of the same room may not share
-- a night.
--
-- `btree_gist` is what lets an equality column ("roomId") sit in the same GiST
-- index as a range. Without it the constraint cannot be created at all.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Half-open '[)': a departure on the 16th and an arrival on the 16th is a
-- same-day turnover, not an overlap.
--
-- The WHERE clause is why `status` is denormalised onto the stay — a constraint
-- cannot read `reservations.status`. Cancelled and no-show stays release the
-- room; an enquiry never held it.
ALTER TABLE "room_stays"
  ADD CONSTRAINT "room_stays_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    daterange("checkIn"::date, "checkOut"::date, '[)') WITH &&
  )
  WHERE ("roomId" IS NOT NULL AND "status" IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'));
