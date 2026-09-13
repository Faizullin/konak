-- One live bill per reservation, enforced where it is actually true.
--
-- `folioForReservation` and `openFolioFor` both read "is there a non-VOID
-- folio" and then create one. Under any concurrency they both read *no* and
-- both create: a clerk pressing "Open the bill" while the check-out transaction
-- is still running gets two folios, two burnt folio numbers, and the room
-- charges on only one of them. The guest is then shown a bill that is missing
-- the room.
--
-- Partial, because VOID is the exception the model already makes: a bill raised
-- in error and voided leaves the stay needing a real one, so voided folios must
-- be allowed to pile up. Prisma's schema language cannot express a partial
-- unique index, which is why this is written by hand and the model carries a
-- comment pointing here.
CREATE UNIQUE INDEX "folios_one_live_per_reservation"
  ON "folios" ("reservationId")
  WHERE "reservationId" IS NOT NULL AND "status" <> 'VOID';
