-- The stay carries its property, and cannot disagree with its reservation.
--
-- Measured before it was written. The grid and the day lists filter
-- `reservation.propertyId` plus a date range, and at 300,000 stays the planner
-- drives from `reservations`, walks every booking the property has ever taken
-- and probes `room_stays` once per row — ~195 ms, growing with history, on a
-- screen that polls every thirty seconds per open desk. Three date-leading
-- indexes on `room_stays` were benchmarked and **none of them was ever chosen**,
-- because the filter they would serve lives on the other table. With the column
-- here the join disappears and the same query is 0.02 ms.
--
-- Table convention 1 says a child inherits its tenant through its parent,
-- because "a copied scope can disagree with its parent". This copy cannot: the
-- composite foreign key below refuses any stay whose property differs from its
-- reservation's. The rule's reason is satisfied rather than waived.

ALTER TABLE "room_stays" ADD COLUMN "propertyId" INTEGER;

UPDATE "room_stays" s
   SET "propertyId" = r."propertyId"
  FROM "reservations" r
 WHERE r."id" = s."reservationId";

ALTER TABLE "room_stays" ALTER COLUMN "propertyId" SET NOT NULL;

-- The target the composite key needs. `id` is already unique on its own, so
-- this adds a second index only for the reference.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_id_propertyId_key" UNIQUE ("id", "propertyId");

-- The whole reason the copy is allowed.
ALTER TABLE "room_stays"
  ADD CONSTRAINT "room_stays_property_matches_reservation"
  FOREIGN KEY ("reservationId", "propertyId")
  REFERENCES "reservations" ("id", "propertyId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "room_stays"
  ADD CONSTRAINT "room_stays_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant first, then the bound that actually prunes.
CREATE INDEX "room_stays_propertyId_checkOut_checkIn_idx"
  ON "room_stays" ("propertyId", "checkOut", "checkIn");
