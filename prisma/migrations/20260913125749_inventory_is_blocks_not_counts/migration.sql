-- `totalRooms` was a stored copy of "how many rooms of this type exist", which
-- is a fact about rows in `rooms`. Two consequences, both real:
--
--   * a property set up through the app had no rows here at all, and a missing
--     row read as nought rooms — so it was sold out on every night for ever;
--   * a stored copy drifts the moment somebody adds a room, which is the exact
--     argument this table already makes about not storing a sold count.
--
-- The total is derived from `rooms` now, and this table holds only what staff
-- deliberately withheld. A night with no row is every room, nothing held back.
ALTER TABLE "room_type_inventory" DROP COLUMN "totalRooms";

-- Why they were held back, for whoever finds the row in March.
ALTER TABLE "room_type_inventory" ADD COLUMN "reason" TEXT;

-- Nothing reads a date on its own: every query supplies the room type and uses
-- the unique. The index was work on every write, for nobody.
DROP INDEX IF EXISTS "room_type_inventory_date_idx";

-- Rows that withhold nothing say nothing. Leaving them behind would make the
-- table's meaning ("somebody held rooms back here") false on its first read.
DELETE FROM "room_type_inventory" WHERE "blockedRooms" = 0;
