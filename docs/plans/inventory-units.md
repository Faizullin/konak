# What a bookable unit is

Two things the client sells that the 46 models cannot express: a **bed** in a
dorm, and a **баня** by the hour. Both were raised as questions before MVP
sign-off; this is the design each needs, so `todo.md` can carry a title and a
line and nothing more.

They are one plan because they are the same question asked twice — *what is the
unit that gets sold, and what stops it being sold twice* — and because the
answers pull in opposite directions. One belongs inside the reservation model.
The other must stay out of it.

---

## Койко-места — a bed is a unit, inside the model

### What the client sells

A hostel sells a bed. Six people who do not know each other sleep in one room,
pay separately, arrive on different days and leave on different days. The room
is not the thing being sold; it is the thing the beds are in.

### The shape

`RoomType` gains a **unit** — `ROOM` or `BED` — and that is the whole
discriminator. A type whose unit is `BED` is "Bed in 6-bed dorm": it prices,
maps to a channel and counts inventory exactly like any other room type, and
the only difference is what a stay points at.

```
RoomType.unit  ROOM | BED
Room           unchanged — the physical room, still what housekeeping cleans
Bed            new: belongs to a Room, carries a label and a position
RoomStay.bedId new: nullable, set when the type's unit is BED
```

A bed stay sets `bedId` and leaves `roomId` null. A room stay is unchanged.

### Why this is cheaper than it looks

**The existing constraint already allows it.** `room_stays_no_overlap`
(`prisma/migrations/20260908211304_reservation_overlap/migration.sql:20`) is
scoped `WHERE ("roomId" IS NOT NULL AND ...)`, and `RoomStay.roomId` is already
nullable and already documented as "null is normal for a future booking"
(`prisma/schema/reservations.prisma:97`). A stay with a bed and no room does not
collide with it. Nothing about the room-level invariant changes; a second
constraint is added beside it:

```sql
ALTER TABLE "room_stays"
  ADD CONSTRAINT "room_stays_bed_no_overlap"
  EXCLUDE USING gist (
    "bedId" WITH =,
    daterange("checkIn"::date, "checkOut"::date, '[)') WITH &&
  )
  WHERE ("bedId" IS NOT NULL AND "status" IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'));
```

Same half-open range, same status predicate, same reason for both — a partial
constraint keeps the GiST index to live bookings instead of every cancellation
since opening. `btree_gist` is already installed by the migration above, so
there is no extension step.

Multiple exclusion constraints on one table are ordinary; each maintains its own
GiST index, and the write cost is one more tree per insert on a table that
already carries four btree indexes.

### What this is not: split inventory

A dorm sold **either** by the bed **or** whole, whichever comes first, is the
hard problem in this domain. Cloudbeds needs a dependency engine for it: sell
one bed and the "entire 6-bed dorm" product must drop to zero across every
channel; sell the dorm and all six beds must vanish. It cannot be expressed as
an exclusion constraint, because the two constraints do not see each other.

**A dorm is bed-only.** A buy-out is six bed stays on one reservation, which the
constraint above enforces atomically and for free. The client can sell a whole
dorm; they just cannot sell it as a distinct product with its own price. If they
ever need that, it is a plan of its own and it starts by reading how the
channel manager represents it — not by adding a third constraint.

### Why this is not optional

Not a convenience. `GuestRegistration` files one record per guest
(`prisma/schema/reservations.prisma:141`, the comment above `ReservationGuest`),
and Kazakh immigration reporting wants **ФИО — документ — конкретное койко-место
— период**. A hostel whose stays point only at a room cannot file correctly.
That makes this a condition of Phase 9 working in a hostel at all, not a
feature that competes with other features.

### What does not change

- **Housekeeping** stays room-level. You clean a room; you do not clean a bed.
  `HousekeepingTask.roomId` (`prisma/schema/housekeeping.prisma:14`) is required
  and stays required.
- **Rates** are per room type, so a bed type prices through `RateCalendar`
  unchanged. `baseOccupancy` for a bed type is 1, and the extra-person amounts
  are simply never reached.
- **Channels** map a bed type as a room type with N units. Nothing in
  `ChannelMapping` needs a new column; the mapping is already type-to-type.
- **The grid.** A dorm draws as its beds — more rows, same shape. It is not a
  new axis.

---

## Почасовые объекты — an hour is a unit, outside the model

### What the client sells

A баня, a беседка, a conference room, a banquet hall. Rented from 14:00 to
17:00, not for the night of the 14th. Often to someone who is not staying.

### The shape

A feature of its own — `src/features/facilities/` — with its own three models
and its own constraint:

```
Facility        propertyId, name, kind, capacity, minimum block
FacilityRate    hour bands and day-of-week pricing
FacilityBooking facilityId, tstzrange, status, folioId?
```

```sql
ALTER TABLE "facility_bookings"
  ADD CONSTRAINT "facility_bookings_no_overlap"
  EXCLUDE USING gist (
    "facilityId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED'));
```

### Why not inside `RoomStay`

Three reasons, in order of how expensive each would be to undo:

1. **The constraint cannot be shared.** `room_stays_no_overlap` compares
   `daterange` over `::date`. An hourly booking needs `tstzrange` over
   timestamps. One exclusion constraint cannot do both, so a unified table means
   weakening the invariant that is currently the strongest thing in the schema.
2. **Every report would need an exception.** A sauna inside `Room` lands in
   occupancy, ADR, RevPAR, the availability grid, the housekeeping queue and the
   channel push. Phase 10 pins those formulas in `model/` with tests precisely
   because a hotelier checks them; a denominator that silently includes a
   беседка fails that check.
3. **The pricing shares nothing.** `RateCalendar` is a row per date with
   MinLOS, meal plans and extra-person amounts. Hourly pricing is an hour band,
   a weekday, a minimum block and a setup/teardown buffer. Putting both behind
   one rate engine makes a tested subsystem answer two unrelated questions.

The industry splits the same way, and the split is not stylistic: Mews unifies
everything into Space + Service, Oracle Opera keeps `Function Space` and
`Events` apart from rooms. Opera's answer is the one that fits a schema whose
room-night invariant is already load-bearing.

### The one thing that is shared: the folio

`FacilityBooking.folioId` is nullable and points at the existing `Folio`. A
sauna booked by a guest in house lands on their bill; one booked by a walk-in
opens its own folio and takes a payment through the same `Payment` rows. That is
the seam where a separated module usually hurts, and here it costs one nullable
foreign key because billing already exists.

### What v1 does not do

**Concurrent capacity.** A sauna that holds ten people, booked by ten unrelated
parties in the same hour, cannot be an exclusion constraint — the constraint
refuses the second booking, not the eleventh guest. `Facility.capacity` is
therefore a headcount shown to the person booking, not a number of simultaneous
bookings. A баня is rented whole, by one company, for two hours; that is the
market this is for. Shared-capacity slots are a different product and would want
a counter and a serialisable transaction, not a constraint.

**Setup and teardown buffers** are modelled as part of the booked range rather
than as a separate field. A hall booked 14:00–17:00 with thirty minutes of
clearing is stored 14:00–17:30 and displayed as 14:00–17:00. One range, one
constraint, and the buffer cannot drift out of sync with what the constraint
checks.

---

## Order

The bed level goes first and is small: one model, one enum field, one nullable
foreign key, one migration. It settles what a unit is before Phase 8's booking
engine and Phase 10's denominators have to read it, and it is the one of the two
that a regulator cares about.

Facilities are a phase of their own and depend on nothing. They land when the
client's revenue says they do.
