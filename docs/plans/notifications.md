# Notifications

An in-app feed: what happened, who needs to know, and a bell that says how many
of them are still unread.

Nothing of this exists today — `grep -rni "notif" src prisma messages` is empty.
What *does* exist is the hole it fills:
`app/(app)/dashboard/layout.tsx:86` names "an inbox" as a thing the header
wants, and [dashboard-header.md](dashboard-header.md) § 3 sketches a bell with
demo data and a `useState` for read state. **This plan is the decision that
section defers**: the bell is going to be used, so the fake is a detour and the
row is the cheapest honest source.

It is one new feature, `features/notifications/`, one new Prisma file, one
router, one component mounted by both surfaces, and one page.

---

## The shape, in one paragraph

A **notification** is a fact that happened — *booking 4471 checked in*. A
**recipient row** is one person having been told about it. The fact is written
once, in the transaction that caused it; the fan-out is written beside it; read
state lives only on the recipient row. The bell counts unread recipient rows for
the signed-in user; the feed lists them newest first; the page is the same feed
without a popover around it.

Five rules carry the whole design, and each of them is an existing rule in this
codebase rather than a new one:

1. **Written in the transaction that caused it.** Exactly `enqueueChannelPush`
   (`features/channels/server/enqueue.ts:24`): a check-in and the message
   announcing it commit together or not at all.
2. **Store the decision, derive the consequence.** No `unreadCount` column
   anywhere — `architecture.md` § What is counted, never stored. The count is a
   `count()` over recipient rows, and a counter column would drift the first
   time two tabs mark the same row read.
3. **The payload is data; the sentence is a translation.** A row stores a `type`
   and its parameters, never rendered English. Same relationship as a domain
   code and `messages/en/errors.json` — `ui-patterns.md` § Strings.
4. **The rule before the router.** Who gets told is a pure function in `model/`
   over a list of members, so the audience is provable without a database.
5. **A component never writes the surface it lives on.** A notification's link
   goes through `store/surface-links.tsx:34`, or the desk's bell throws people
   into the dashboard — the exact bug that file was written for. § 1a leans on
   that contract harder than anything else in the product does, which is why
   widening it for surfaces that do not exist yet is
   [desk-generation.md](desk-generation.md) § 5 and not this plan.

**This is not the outbox.** `OutboxTask` is work owed to a *slow, failing
external system*; an in-app notification has no network in it, and the insert is
the delivery. Email and push are a later phase and are an outbox task enqueued
*from* a notification, never instead of one — § 6.

**This is not the audit log.** `AuditLog` is append-only, legal, and keyed on
"who read this passport". Notifications are ephemeral and swept. A row that
matters in a year is an audit row; a row that matters this shift is this.

---

## 1. The tables

`prisma/schema/notifications.prisma` — one file per domain, `architecture.md`
§ Table conventions 13.

```prisma
model Notification {
  id             Int      @id @default(autoincrement())
  organizationId Int
  // Scope, not a subject: which hotel this happened at. Null for something
  // organisation-wide, like a dead-lettered task.
  propertyId     Int?
  type           String   // the registry id — ARRIVAL, DEPARTURE, …
  // The parameters the sentence interpolates: a booking reference, a room
  // number, an amount. JSON, because every type interpolates different things.
  paramsJson     String
  // Who caused it. Null when nobody did — a sweep, a channel, the clock.
  actorUserId    String?
  // Makes a retry safe, and is the whole reason a handler may run twice.
  // `enqueueOutbox` is the worked example (platform/server/outbox.ts:81).
  eventKey       String?  @unique
  createdAt      DateTime @default(now())

  // What it is about — polymorphic, and § 1a is the argument for it. A closed
  // vocabulary in `model/`, not a free string. Both null is legal: an outbox
  // dead letter is real news about nothing in particular.
  targetType String?  // RESERVATION, HOUSEKEEPING_TASK, ISSUE, FOLIO, PERSON
  targetId   Int?
  // The half a person may be shown and a URL may be built from, copied at write
  // time. § 1a.3 — this is what makes the missing foreign key safe.
  targetRef  String?

  recipients NotificationRecipient[]
  …relations…

  @@index([organizationId, createdAt])
  @@index([propertyId, createdAt])
  // "Everything that happened to booking 7." Exactly `AuditLog`'s index.
  @@index([targetType, targetId])
  @@map("notifications")
}

model NotificationRecipient {
  id             Int       @id @default(autoincrement())
  notificationId Int
  // The *user* id, not the membership id — so the trail survives a membership
  // being deleted, exactly as `AuditLog.actorUserId` does.
  userId         String
  readAt         DateTime?
  createdAt      DateTime  @default(now())

  @@unique([notificationId, userId])
  // The bell's only query: my unread, newest first. Tenant first.
  @@index([userId, readAt, createdAt])
  @@map("notification_recipients")
}
```

**Why two tables.** One table with a `userId` on it repeats the title and the
parameters once per recipient, so a hotel with twelve staff writes twelve copies
of one sentence and a wording fix rewrites history. Two tables also make *mark
all read* a write that touches nothing but read state.

**No `seenAt`.** A badge that clears on open and a badge that counts unread are
different products, and only one of them has been asked for. Do not build the
column speculatively — the dashboard's second palette is the precedent
(`todo.md`).

## 1a. Why the target is polymorphic, when the rule says it must not be

`architecture.md` and `platform.prisma` both forbid a `subjectType`/`subjectId`
pair in as many words: *"never a `subjectType`/`subjectId` pair, which throws
away referential integrity and lets a row outlive its subject."* An earlier draft
of this plan obeyed it — five nullable foreign keys and an *at most one* check.
This section is the argument for the other choice, written out so it is a
decision on the record rather than a rule quietly broken.

**The rule already has this exception in the tree.** `AuditLog`
(`platform.prisma:165`) is `entityType String` + `entityId String` with
`@@index([entityType, entityId])` and no foreign key at all. Two tables, one
rule, opposite answers — so the real rule is not "never", it is **a subject the
row cannot outlive gets a foreign key; a record of something that happened does
not.** An `Attachment` without its person is an orphan file. An audit row whose
subject was purged is the most important row in the table.

A notification is the second kind, and four properties say so:

1. **The feed never joins.** `feed` returns `{ type, params, at, read, target }`
   and renders a sentence from `messages/`. The target exists to build one URL.
   A foreign key that is never joined through has bought nothing and charged a
   migration.
2. **Cascade delete is the wrong behaviour here.** `onDelete: Cascade` would
   erase *"booking 4471 was cancelled"* the moment the booking is erased —
   deleting the only remaining evidence of the thing worth remembering. The
   retention sweep in § 4 is the correct lifecycle, and it is time-based, not
   subject-based.
3. **The sentence must not depend on a join, and does not.** `paramsJson`
   already carries the booking reference, the room number, the amount — written
   at the moment it was true. `targetRef` carries the `publicId` beside it. So a
   dangling target degrades to *a true sentence with no link*, never a 404 and
   never a crash. **This is the whole safety argument**; if a type ever needs to
   read the live row to render its sentence, that type is modelled wrong.
4. **The subject list is open and the table is not.** Eight types today, and
   every future feature adds one. A nullable column per kind is a migration per
   notification type and a `Notification` row of mostly nulls — thirteen columns
   to say one thing.

**What replaces the foreign key.** The integrity a database column would have
given is bought back in four places, and the plan is not honest without all
four:

- **`targetType` is a closed union in `model/`**, `NOTIFICATION_TARGETS`, not a
  free string. Each entry declares how to build its href and which icon it
  wears. A typo is a type error, and an unrecognised value read back from an old
  row renders unlinked rather than throwing — the same forgiving read
  `toTheme()` does with a cookie.
- **One link builder, and it is surface-aware.** `targetHref(target, links)`
  resolves through `store/surface-links.tsx`, never a template literal. A
  notification opened on the desk must stay on the desk, and the *only* reason
  that works for an open target vocabulary is that the vocabulary is closed in
  `model/` — see [desk-generation.md](desk-generation.md) § 5, which is where
  that contract is widened for surfaces that do not exist yet.
- **A test per target kind** asserting `targetHref` returns a route the app
  actually serves. That is the check the foreign key was doing, moved to the
  layer that cares.
- **The sweep, not the cascade.** § 4.

**Two things this does not license.** It is not permission to re-model
`Attachment` or `Activity` — those must die with their subject, which is why
they have the keys. And `targetId` is deliberately `Int?` rather than `String`:
every id in this product is an integer autoincrement
(`architecture.md` § Table conventions 2), and a string column would invite
`publicId`s, slugs and composite keys into a field that is meant to be one row's
primary key. `targetRef` is where the readable half goes.

## 2. The registry, and one write path

`features/notifications/model/registry.ts`, shaped like
`organizations/model/registry.ts`: a type declares itself once and the rest
follows — who hears it, which icon, whether it links anywhere.

```ts
export interface NotificationType {
  /** `notifications.<id>.title` and `.body` in messages/. */
  id: string;
  /** Who is told. See § 3. */
  audience: Audience;
  /** A Lucide icon name, mapped in the component — never a component here. */
  icon: string;
  /** A token name in `styles/status.css`, never a colour. */
  tone: "info" | "attention" | "problem";
  /** Managers only, where the news is theirs — money, dead letters. */
  roles?: OrgRole[];
}
```

| Type | Raised at | Audience |
|---|---|---|
| `ARRIVAL` / `DEPARTURE` | `reservations/server/router.ts:420` `setStatus` | property watchers |
| `BOOKING_CREATED` | `router.ts:163` `create`, `:621` `walkIn` | property watchers |
| `BOOKING_CANCELLED` / `NO_SHOW` | `setStatus`, same branch as the channel push at `:554` | property watchers |
| `CHANNEL_BOOKING` | `channels/server/inbound.ts` | property watchers |
| `TASK_ASSIGNED` | `housekeeping/server/router.ts:159` | the assignee, and only them |
| `ISSUE_REPORTED` | `housekeeping/server/router.ts:254` | property watchers |
| `PAYMENT_TAKEN` / `FOLIO_CLOSED` | `billing/server/` | managers |
| `DELIVERY_FAILED` | `outcomeOfFailure` dead-lettering (`platform/model/outbox.ts:86`) | managers, organisation-wide |

One function, and it is the only way a row is written:

```ts
// features/notifications/server/notify.ts
export async function notify(tx: Tx, input: NotifyInput): Promise<number>;

type NotifyInput = {
  type: NotificationTypeId;
  organizationId: number;
  propertyId?: number;
  actorUserId?: string | null;
  params: Record<string, string | number>;
  /** § 1a. `type` is closed; `ref` is the readable half, copied at write time. */
  target?: { type: NotificationTargetId; id: number; ref?: string };
  eventKey?: string;
};
```

`tx` is `Pick<Prisma.TransactionClient, …>`, so a caller hands in the
transaction it is already inside — the signature is what makes rule 1
unavoidable rather than remembered. The return is how many people were told,
which is what a test asserts.

**Two enqueues with one `eventKey` are one notification.** The unique index is
the invariant and `isUniqueViolation` (`server/errors.ts:203`) is the recovery:
a key already taken is what the key *means*, and a raised P2002 must not take
the booking down with it. That exact bug is documented at `outbox.ts:81` and
this is the second table to inherit it.

## 3. Who is told — the pure part

`features/notifications/model/audience.ts`, tested with no database:

```ts
export function resolveRecipients(
  type: NotificationType,
  event: { actorUserId?: string | null },
  members: Array<{ userId: string; role: OrgRole }>,
  target?: string | null
): string[];
```

Three audiences and nothing else, because the user-facing question is only ever
which of these three:

- **`TARGET`** — the one person the event names, and the only case where the
  notification is *addressed* rather than broadcast. A housekeeping task
  assignment is this. `target` is required for it; a `TARGET` type raised with
  no target is a programming error and throws, not a silent broadcast.
- **`WATCHERS`** — every member of the organisation, narrowed by
  `type.roles` when the news is a manager's. The desk is small and everyone on
  it cares that a guest arrived.
- **`ACTOR_ONLY`** — the outcome of something the caller started that finished
  later. Nothing uses it in § 5; it is declared because the alternative is
  discovering the fourth case as a special-case `if`.

**The actor is never a recipient**, in every audience but `ACTOR_ONLY`. A
receptionist who just pressed *Check in* does not need to be told that a guest
checked in, and a feed that says so is a feed people stop reading. It is one
filter in `resolveRecipients` and it is the single most load-bearing line in the
file.

**Property watchers are organisation members today.** There is no per-property
membership table — `requireOrgMember` resolves a property to its organisation
and stops there — so narrowing further would be inventing a model. Say so in the
code, because the day a management company runs four hotels it is the first
thing that needs to change.

## 4. The router

`features/notifications/server/router.ts`, mounted in `server/root.ts` as
`notification`. Four procedures, and **every one of them filters on
`ctx.session.user.id`** — a recipient id never arrives from a client.

| Procedure | Shape |
|---|---|
| `unreadCount` | `{ organizationId, propertyId? }` → `number`. One indexed `count()`. |
| `feed` | `{ organizationId, propertyId?, unreadOnly?, cursor?, take }` → `{ items, nextCursor }`. Cursor on `createdAt,id`, not `skip` — a feed grows at the head and an offset re-reads rows it already showed. |
| `markRead` | `{ ids: number[] }` → `{ count }`. Scoped by `userId`; ids that are not the caller's silently match nothing, which is the correct answer and not an error. |
| `markAllRead` | `{ organizationId, propertyId? }` → `{ count }`. The same filter the badge counts with, so what the person saw is exactly what is cleared. |

`requireOrgMember` on all four, so somebody removed from an organisation stops
reading its feed on the next request rather than when their rows expire.

**The feed returns data, not sentences.** `{ id, type, params, at, read,
target }` — the client resolves the wording from `messages/` and the link from
`surface-links`. A server that returns a rendered string is a server that has
picked the reader's language, and a server that returns an href is a server that
has picked their surface.

**Retention is a sweep, not a cron.** `sweepReadNotifications` beside
`sweepExpiredRetention` (`platform/server/storage-sweep.ts:90`), composed into
the same pass so `npm run outbox` runs it and `-- --commit` is still what makes
it real. Read and older than 30 days, unread and older than 90.

## 5. The bell, and the two surfaces

`features/notifications/client/components/notification-bell.tsx` — a feature
component, not shell chrome, because it knows our domain (`architecture.md`,
test 2). Both surfaces mount it; neither owns it:

- the dashboard header, which is where `dashboard-header.md` § 3 already put it
  — that section's `INBOX_DEMO` constant is never written;
- `desk-bar.tsx:42`, in the `actions` slot that already exists, before the
  locale and appearance controls.

**Two queries, not one, and they behave differently.**

```ts
// Always mounted, on every screen. Cheap, and the only thing the badge reads.
trpc.notification.unreadCount.useQuery(scope, {
  refetchInterval: 30_000,   // the desk's number: reservation-grid.tsx:90
  staleTime: 30_000,         // ui-patterns.md § General — the shell asks on every navigation
});

// Only while the popover is open. `enabled: open`, the ComboBox's rule:
// a control that fetches what nobody opened is six queries on mount.
trpc.notification.feed.useQuery({ ...scope, take: 20 }, { enabled: open });
```

Real-time stays **polling**, as Phase 4 decided for the grid and for the same
reason: a Next route handler holds no socket. Thirty seconds is the number
already in three files; a fourth number would be a fourth thing to reconcile.

**What it looks like, and why.**

- A bell with a badge. The badge shows the count up to 9, then `9+` — a
  three-digit badge is a number nobody acts on.
- A popover about 380px, as § 3 of the header plan specified. A `Mark all read`
  in its header, disabled at zero.
- Grouped **Today** / **Earlier**, times through `useFormatter()`. Grouping is
  what makes a feed skimmable; a flat list of forty timestamps is not.
- One row is icon · title · body · time, two lines, and **a link when the row
  carries a target**. `targetHref` (§ 1a) resolves it through
  `useBookingLink` / `usePersonLink` / `useSurfaceLinks` — never a template
  literal in this component. A target whose kind this build does not recognise
  renders as plain text, which is the degradation § 1a.3 pays for.
- Unread differs by **a dot and weight, not by hue alone**. `ui-patterns.md`
  § Colour as data is binding, and read/unread is exactly the pair that gets
  written as a background tint and disappears at night.
- Tone comes from tokens in `styles/status.css` (`--notice-info`,
  `--notice-attention`, `--notice-problem`), overridable per surface. **No
  component names a colour.**
- `DataTableSkeleton`'s sibling, not a spinner, and an empty state that says
  nothing has happened rather than looking broken — § Empty states, where the
  guide warns this is the one people misread as breakage.
- Clicking a row marks it read and navigates. `Mark all read` is optimistic:
  set the badge to zero, invalidate on settle, `handleError` from
  `useErrorHandlers` on failure. **Never `toast.error(e.message)`** —
  `CLAUDE.md` § Traps.
- The footer is one link: *All notifications*.

## 6. The page

`/dashboard/orgs/<orgSlug>/notifications`, and on the desk
`/desk/<org>/<property>/notifications` — the same component, given a different
scope by the route. `page.tsx` reads params and renders; the queries are in the
feature, per `architecture.md` § `app/` holds routing and nothing else.

**A list, not a `DataTable`.** A deliberate departure from § Lists and tables,
stated here so it is a decision rather than a drift: a notification is a
sentence, and a three-column table whose widest column is prose reads worse than
the popover it is supposed to expand. What it keeps from that stack is the half
that matters — **the URL is the state**, via `nuqs`: `?unread=1&type=ARRIVAL`
reopens exactly that view, and the filter controls write those params.

- Filter chips: unread only, and by type.
- `Load more` on the same cursor the popover uses, so there is one paging rule.
- Select rows to mark a batch read, or `Mark all read` for the filter in view.
- Two empty states, and they say different things: *nothing matched this filter*
  and *nothing has happened yet*.

No sidebar entry at first. `ORG_MODULE_REGISTRY` describes modules that can be
switched off, and this cannot be; the bell's footer is how people get here.

## 7. The strings

`messages/{en,ru}/notifications.json`, one namespace, added to both layouts'
`NextIntlClientProvider` — the dashboard's list at
`app/(app)/dashboard/layout.tsx`, and the desk's. Keys are
`<type>.title` / `<type>.body`, interpolating `params`.

`message-keys.test.ts` fails on the first key added and not read, which is why
this is its own step rather than something done while writing components.

## 8. What is deliberately not here

- **Email, push and SMS.** A delivery outside the browser is slow and fails,
  which is what `OutboxTask` is for: a later phase enqueues one *from* `notify`,
  inside the same transaction. Nothing about the tables above changes when it
  arrives, which is the test of whether they are right.
- **Per-user preferences.** "Mute departures" is a table and a settings screen,
  and it is worth building the day somebody mutes something by closing the
  popover in frustration — not before.
- **Per-property membership.** § 3 says why, and where.
- **A `seenAt` column.** § 1.
- **Websockets.** Phase 4 decided polling for the grid; nothing here is more
  urgent than the grid.

---

## The order to build it in

Each step is shippable and leaves the tree passing.

1. **The schema, the target vocabulary and the audience rule.**
   `notifications.prisma`, a migration, `model/registry.ts`,
   `model/targets.ts` and `model/audience.ts` with their tests.
   **Done when** `npm test` proves every registry type resolves an audience,
   that an actor is never their own recipient, and that every target kind builds
   a route the app serves.
2. **`notify()` and one caller.** The service, plus `setStatus`'s arrival and
   departure — the two events the desk already watches for.
   **Done when** `tests/server/notifications.test.ts` shows a check-in telling
   everyone but the person who pressed the button, a rollback leaving no row,
   and the same `eventKey` written twice leaving one.
3. **The router.** Four procedures, scoped to the caller.
   **Done when** a member of another organisation reads nothing, and
   `markAllRead` clears exactly what `unreadCount` counted.
4. **The bell.** Mounted in both surfaces, every link through `surface-links`.
   **Done when** a notification opened from the desk stays on the desk — the
   regression `surface-links.tsx` exists to prevent, and worth an e2e assertion
   in `desk.e2e.ts`.
5. **The rest of the callers**, § 2's table, and the retention sweep in
   `npm run outbox`.
6. **The page**, its filters, and the strings.

Then the pass a phase ends with — `roadmap.md` § How a phase ends. The thing to
measure here is `unreadCount`: it runs on every navigation on both surfaces, and
it is the query that will be wrong at scale if the index in § 1 is wrong.
