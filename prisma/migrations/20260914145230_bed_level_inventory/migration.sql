-- The unit of inventory, split from the room it happens to be in.
--
-- `RoomType.unit` is the whole discriminator: a BED type prices, maps and
-- counts exactly like a ROOM type, and the only difference is what a stay
-- points at. `beds` mirrors `rooms` the way `rooms` mirrors `room_types` — a
-- physical thing that belongs to the room, not the type. See
-- docs/plans/inventory-units.md.

-- AlterTable
ALTER TABLE "room_types" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'ROOM';

-- AlterTable
ALTER TABLE "room_stays" ADD COLUMN     "bedId" INTEGER;

-- CreateTable
CREATE TABLE "beds" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beds_roomId_label_key" ON "beds"("roomId", "label");

-- CreateIndex
CREATE INDEX "room_stays_bedId_checkIn_checkOut_idx" ON "room_stays"("bedId", "checkIn", "checkOut");

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stays" ADD CONSTRAINT "room_stays_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The bed-level twin of `room_stays_no_overlap` — same half-open range, same
-- status predicate, same reason: a constraint cannot read `reservations`, so
-- `status` stays denormalised onto the stay. `btree_gist` is already installed
-- by 20260908211304_reservation_overlap.
--
-- `roomId IS NOT NULL` scopes the existing constraint away from bed stays,
-- which leave it null — the two constraints never see the same row, and a
-- table can carry more than one exclusion constraint at no cost beyond one
-- more GiST index to maintain.
ALTER TABLE "room_stays"
  ADD CONSTRAINT "room_stays_bed_no_overlap"
  EXCLUDE USING gist (
    "bedId" WITH =,
    daterange("checkIn"::date, "checkOut"::date, '[)') WITH &&
  )
  WHERE ("bedId" IS NOT NULL AND "status" IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'));
