# The finished product

What the system does when it is done, in the language of the business rather
than the code. Not a sequence and not an architecture — this file answers "what
is this meant to be", so that a decision taken in one corner can be checked
against the whole.

A rule that appears here is a rule about hotels. Where the software refuses
something, the refusal is stated with the commercial reason behind it, because a
rule whose reason is lost gets removed by the next person who finds it
inconvenient.

---

## 1. What it is

A property management system: the software a hotel runs its day on. It holds
what the hotel has to sell, what has been sold, who is staying, what they owe,
and what the state requires to be filed about them.

It is sold to hotel companies, not to hotels. A company signs up once and holds
one or many properties under it — a single guesthouse and a fifteen-hotel group
are the same product with different row counts. That is the reason nearly every
table carries a tenant column and nearly every query is scoped by one.

It is not a channel manager, not an accounting package and not a CRM, though it
exchanges data with all three. The boundary is: **this system owns the room and
the stay.** Anything that owns something else is an integration.

## 2. Who uses it

Four kinds of person, and their needs pull in different directions.

**The receptionist** is at the desk all day and works in minutes. Arrivals,
departures, who is in house, a walk-in at 01:00, a guest who wants a different
room. This person is the primary user and the screen density is set by them: a
forty-room grid read for eight hours is not a marketing page.

**The housekeeper** works standing up, on a phone, moving between floors. They
need today's rooms, the state of each, and a way to say "clean" or "there is a
fault here" without typing. Mobile-first is a statement about this person, not a
general preference.

**The manager** sets up the property, prices it, and reads the numbers. They
open room types, rooms and rate plans, and they are the only ones who may change
what things cost or delete anything that takes bytes with it.

**The owner** signs up, holds the billing relationship, and can hand the
organization to someone else. This is the only role that can destroy the
organization, and destroying it is the one operation the rest of the system is
built to make safe.

Rights are held by role, and the split that matters most is **uploading versus
deleting**: a receptionist attaches a passport scan as part of doing their job;
deleting one destroys evidence, so it is a manager's.

## 3. Organization, property, module

An **organization** is the customer. It holds members, its own settings, its
quota, and its properties.

A **property** is one hotel: an address, a timezone, a currency, a check-in and
check-out hour. The timezone is not cosmetic. A hotel's day ends at its front
desk, not at UTC midnight — at 01:00 local an arrival is still yesterday's in
Auckland and tomorrow's in Los Angeles, and *"has this booking arrived yet"* is
answered against the property's day or it is answered wrongly twice a day.

Not every organization runs a hotel. **Modules are per-organization switches**:
an organization that only keeps a contact directory never sees the front desk,
and the front desk's routes do not exist for it. This is what lets the same
install serve a hotel group and a company that bought the product for one of its
parts. A module that is off is off completely — not a hidden menu item.

## 4. Room types and rooms

**The decision the whole system turns on: a guest books a room type, not a
room.**

A *room type* — Double Sea View, Family Suite — is what is sold, priced,
restricted and pushed to a channel. It carries how many people it sleeps, how
many of those may be adults, how many children, and a stable short code that
survives renaming so an OTA's mapping does not break when marketing rewrites the
name.

A *room* is a physical door with a number, a floor and a housekeeping state. It
belongs to exactly one type.

Availability is counted against the **type**. The physical room is chosen later
— at check-in, or earlier if the desk wants to — and until then the booking sits
in a band of its own, assigned to a type and to nobody's door. Model it the
other way round and every rate plan, every restriction and every channel push
has to be rewritten to hang off individual rooms, which is both wrong
commercially and impossible to price.

A room out of order is removed from what can be sold. That is the only
housekeeping state with a commercial consequence; dirty, in progress and
inspected are the floor's business and do not stop a sale.

## 5. The stay is the unit

A **reservation** is the commercial agreement. A **stay** is one room type, for
one date range, inside it. A reservation with two rooms has two stays, and a
reservation that changes room mid-visit has two stays as well.

A stay is the half-open interval `[check-in, check-out)`. The departure day is
not a night. Three consequences, all of them things hotels actually do:

- **Nights are a subtraction.** Arrive the 4th, leave the 7th, three nights.
- **Same-day turnover is legal.** One guest departs the 4th, another arrives the
  4th, same room, no conflict. An inclusive comparison refuses the most ordinary
  event in the business.
- **A zero-night booking is a mistake**, not a day-use rate. Hourly and day-use
  are a different product and would be a different interval model.

Dates that mean a *day* are stored as the property's day, not as an instant.
A nightly rate belongs to a calendar day; an arrival at 23:50 and one at 00:10
are different nights and must not be resolved by rounding.

## 6. Availability

Free rooms of a type on a night is:

> total for that night − out of order − sold − held

**It is derived every time, never stored.** A cached count drifts the first time
a channel cancels quietly, and a wrong number here is an overbooking — a guest
standing at a desk with nowhere to sleep — not a stale figure on a report.

*Sold* counts the stays that actually occupy the room. A confirmed booking
occupies. A checked-in guest occupies. **A checked-out stay still occupies**,
because the guest did sleep those nights and a past date that reads as free is a
lie the reports will repeat. A cancellation and a no-show release the nights
immediately — that is what those statuses mean.

*Held* is a short-lived claim with an expiry, taken while a booking is being
made and released automatically if it is not completed. Without holds, a
thousand simultaneous searches all see the last room and all succeed. The hold
is the difference between "available" and "available to you, for the next few
minutes".

An **enquiry holds nothing.** It is a quote. Treating a quote as occupancy is
how a hotel ends a season with empty rooms it believed were sold.

## 7. The life of a booking

Six states, and the machine only moves forward:

| State | What it means commercially |
|---|---|
| **Enquiry** | A quote. Holds no inventory, owes no money. |
| **Confirmed** | Sold. The nights are off the market. |
| **Checked in** | The guest is in the building and in a specific room. |
| **Checked out** | The stay happened. The folio closes. |
| **Cancelled** | It will not happen. The nights return to sale. |
| **No-show** | It did not happen and the guest did not say. Nights return; the charge may not. |

Checked out, cancelled and no-show are final.

**Nothing goes backwards**, and this is a business rule before it is a technical
one. Checking in issued a key, opened a folio, told housekeeping and consumed a
night of inventory. None of that is undone by setting a column to its previous
value. Correcting a mistake is a new decision with its own record — a guest who
was marked a no-show and then walks in is a new booking, because the old one
released its rooms and somebody else may already have them.

The desk refuses more than the machine does, and every refusal carries its
reason to the screen so a greyed-out button explains itself:

- **A booking cannot check in without a room.** Check-in is the moment a booking
  stops being a room type and becomes a door. Checking in to nothing means a
  guest with no key.
- **A booking cannot check in or be marked a no-show before its arrival day.** A
  guest standing at the desk a day early is wrong dates, and moving dates is its
  own decision with its own price consequences.
- **A booking cannot check in after its last night.** There is no night left to
  check into. A no-show, by contrast, can still be recorded late — that is
  exactly when it is usually noticed.

## 8. Assignment, moves and the grid

The шахматка — rooms down, dates across — is the desk's main screen and the
place most work happens. It shows, per room type: how many are free each night,
the bookings that have a type but no room yet, and then each physical room with
its bookings drawn as spans.

Three gestures, and each is a distinct commercial act:

- **Drag a booking onto a room** — assignment. Same dates, a door is chosen.
- **Drag it sideways** — the stay moves. Different nights, which means
  re-checking availability and possibly a different price.
- **Drag an edge** — the stay lengthens or shortens. One date changes, the room
  does not.

A move that would put two guests in one room on one night is refused, with the
reason shown where the drag ended. **The refusal is the database's**: an
exclusion constraint over the room and the night range, which is the only answer
that stays true when two clerks drag at once. What the application refuses
before the write is everything the constraint cannot know — that an arrived
guest arrived when they arrived, that nights already gone cannot be moved into.
Half-open, so the same-day turnover above still passes.

Cancelled and no-show bookings are not drawn. Drawing them would say a free room
is taken, and the dangerous failure on this screen is hiding a booking that
exists, not showing one too few.

## 9. The day

Beside the grid, the desk works from three lists: **arriving today**,
**departing today**, and **in house**. They answer the questions asked most —
who is coming, who is leaving, who is here — without reading a grid.

Both surfaces act on the same booking through the same rules, so two views of
one reservation cannot disagree. A change in either is visible in both.

"Today" is the property's day.

## 10. Housekeeping

Every room has a state: clean, dirty, in progress, inspected, out of order.
Check-out marks the room dirty automatically — that is the event that creates
the work, and expecting a receptionist to also remember is how boards go stale.

The floor gets a task list per day, and a way to report a **fault**, which is a
different thing from dirt: a fault may take the room out of order, and out of
order is the state that removes it from sale. That is the one place the floor's
screen touches the money.

## 11. Guests and companies

A **person** is a guest, a contact, a signatory. A **company** is a corporate
account, an agency, a tour operator. A person may be linked to companies, and
the link is what makes "this booking is on the Acme rate, billed to Acme"
possible.

A profile carries stay history, notes, tags and per-organization custom fields —
the hotel's own vocabulary, because "VIP", "allergic to feathers" and "always
wants a high floor" are not things a vendor can enumerate in advance.

Identity documents are attached here, and are treated as a separate class of
data from a name: stored privately, never on a public URL, and read only by
someone entitled to. **Who read this passport** is a question the system answers.

A booking names its guests separately from the profile, because the person who
books is often not the person who sleeps.

## 12. Rates and prices

A **rate plan** is a way of selling a room type: a name, terms, and how it
prices. Flexible, non-refundable, corporate, a package with breakfast — these
are plans, not discounts applied at the till.

Prices live in a **calendar**, per plan per type per day, because a hotel's
price is a function of the date before it is a function of anything else. A
Saturday in July is not a Tuesday in February and no percentage expresses the
difference.

**Restrictions** are the other half, and they are what makes a rate plan a
commercial instrument rather than a number: a minimum stay, a closed arrival, a
plan closed entirely on a date. A plan with a two-night minimum over a weekend
is how a hotel refuses to sell the Saturday alone.

Quoting a stay walks its nights, takes each night's price from the plan's
calendar, and adds the plan's extra-person amounts for anyone beyond the type's
base occupancy. The total is the sum of nights, not a nightly rate multiplied —
they differ whenever the calendar does.

**Money is stored in the currency's smallest unit**, with the currency named.
Not everything divides by a hundred; the yen has no minor unit, and code that
assumes two decimal places is right by luck in most of the world and wrong in
the rest. A property has a currency; a multi-currency group carries exchange
rates and records which rate was used, because a price quoted yesterday is not
re-derived today.

## 13. The folio

A **folio** is the bill attached to a stay. Charges go on as lines — room, extras,
taxes, city levies — and payments and refunds come off. A folio can be **split**:
the company pays the room, the guest pays the bar. That is not an edge case; it
is how corporate travel works everywhere.

A stay is finished when its folio balances and closes.

**Numbers that mean something legally come from a sequence**, taken inside the
transaction that uses them. Reservation numbers, invoice numbers, receipt
numbers. Never a count of existing rows plus one — two clerks pressing the
button at the same instant get the same number, and a duplicated invoice number
is a finding at audit, not a bug report.

## 14. Distribution

The hotel does not only sell at its own desk. Booking sites, a channel manager,
a travel agency — each is a connection that must be told what is available and
must be listened to for bookings made there.

Two directions, and they are not symmetrical:

- **Out**: availability and rates, pushed as a difference against what the
  channel was last told. Sending everything every time is how rate limits are
  hit and how a busy afternoon falls behind.
- **In**: reservations, pulled and applied so that receiving the same one twice
  produces one booking. Networks retry; a system that cannot recognise a
  repeat double-books.

Room types and rate plans are **mapped** to the channel's own identifiers, which
is why the type's short code has to outlive its display name.

Synchronisation is not instant, so an **overbooking policy has to be written
down** rather than discovered: how many rooms of a type may be sold beyond the
count, and what happens at the desk when it bites. A hotel that never
overbooks leaves money on the table; one that overbooks without a policy walks
guests without a plan.

**The policy, written down.** It is a per-property setting with two values, and
the default is `NONE`: a property that has not thought about this does not
overbook. `FIXED` sells a stated number of rooms beyond the count, per type per
night. Two rules bound it:

- **It applies to what a channel is told, never to what the desk can sell.**
  The desk's availability is derived from stays and is the truth; overbooking is
  a deliberate lie told outward, and the moment it stops being a lie the desk has
  to walk somebody.
- **A sold-out night stays sold out.** Overbooking adds to what is free, not to
  what is gone. A policy that reopened a closed night would be the hotel walking
  a guest by arithmetic rather than by decision.

An intent to tell an outside system is recorded in the same transaction as the
thing it announces, then carried out afterwards. A booking and the message
announcing it commit together or not at all — otherwise a network failure
produces a booking nobody hears about, or an announcement of a booking that
rolled back.

## 15. Selling direct

A public booking flow on the hotel's own site: search dates, see types and
prices, book, pay. No account, ever — a guest reaching their booking through a
link they were sent is the flow every hotel guest already expects, and requiring
a password loses bookings.

Because it faces the public it needs rate limiting, and because it collects a
name, a card and eventually a document number it needs the legal surface —
privacy notice, terms, consent — **before** the first collection, not after.
That is a condition of operating, not marketing copy.

## 16. Compliance

The highest-risk area, and the reason a regional PMS can exist at all. Three
obligations, each jurisdiction-specific:

**Guest registration.** Many states require that a guest's identity be filed,
often within hours of arrival, in a prescribed format. This is the single
strongest reason a hotel cannot use a generic booking tool.

**Fiscal receipts.** Where payments must be registered with a tax authority, the
receipt is issued by them, not by us, and a payment without one is not a legal
sale. Filing must be repeatable without producing duplicates — the network
between here and a tax authority is not reliable, and neither is the answer.

**Retention.** Document data is kept as long as the law requires and **destroyed
when it no longer is**. Keeping a passport number forever is not caution; it is a
breach waiting for someone else's mistake. Sensitive fields are encrypted at
rest, and the purge is a scheduled obligation rather than a housekeeping
courtesy.

Beneath all three sits an **append-only trail**: who did what, to what, when.
Its actor is the person, so the record survives that person leaving the company
— a trail that disappears with a membership answers nothing at the moment it is
needed.

## 17. Keys and doors

Where the hotel has electronic locks, checking in issues a credential valid for
the stay and checking out ends it. A key that outlives its stay is a room a
stranger can open, which is why the credential's life is bound to the stay's and
not to a date somebody typed.

## 18. What the numbers have to say

Occupancy, average daily rate, revenue per available room, debt outstanding, and
the trail as something a person can read.

These are checked by hoteliers against their own arithmetic, and a definition
that disagrees will be found. The formulas are fixed and tested rather than
computed ad hoc per screen — "occupancy" must mean one thing in the dashboard,
the export and the year-end.

## 19. What the system refuses

The rules that hold everywhere, collected. Each is refused with a reason, and
each has a commercial consequence behind it.

1. **Two bookings that *hold* a room may not share a night in it.** Half-open,
   so same-day turnover is not an overlap. Confirmed, checked-in and
   checked-out hold; cancelled and no-show released what they held, and an
   enquiry never held it — so none of those three is constrained. This is the
   database's own `WHERE`, not a reading of it.

   The rule is about a **room**; the overbooking allowance in §14 is about a
   **type**. They do not conflict: a type may be sold beyond its count while no
   room holds two guests, and that gap is exactly what the unassigned band
   makes visible.
2. **A stay is at least one night.**
3. **A booking may not check in without an assigned room.**
4. **A booking may not check in before its arrival day, or after its last
   night.**
5. **No status returns to an earlier one.**
6. **A booking may not exceed its room type's occupancy.**
7. **A room out of order may not be sold.**
8. **Every row belongs to exactly one property**, and a booking's type, room and
   rate plan must all belong to the same one.
9. **Availability is never trusted from a cache.**
10. **A legal number is never reused**, and never derived from a count.
11. **Money is never a float**, and never divided by a hundred by assumption.
12. **Nothing is deleted — it is archived**, and archived rows leave every list.
    The exception is bytes: deleting a file deletes the file.
13. **A document is never reachable by guessing a URL.**
14. **Every write records who made it.**

## 20. What it deliberately does not do

Stated so that "we should add…" meets an answer rather than a shrug.

**Hourly and day-use booking.** The stay is a night-based interval, and hourly
rental is a different product with a different unit. It is not an extra field;
it is a second interval model, a second availability calculation and a second
grid. If it is ever wanted, it is wanted as a decision, not as a feature request.

**Accounting.** The system produces bills, payments and receipts, and hands them
to whatever the hotel already uses. A general ledger is somebody else's product.

**Marketing automation.** Guest profiles exist for service and compliance. A
campaign tool reads them through an integration.

**Its own identity provider for guests.** Staff sign in; guests never do. A
guest reaches their booking by a link.

**Revenue management.** Prices are set by a person in a calendar. A system that
sets them automatically is a separate product with a separate risk profile, and
a hotel that cannot see why a price changed will not trust it.
