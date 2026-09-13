/**
 * What the report photographs.
 *
 * Declared once and shot across every axis, so adding a screen is a row rather
 * than a procedure. The `title` and `description` are written for a person
 * reading the report, not for a test name — half the audience is a client who
 * has never seen the product.
 */

export type Screen = {
  /** Stable, and the basis of the file name. */
  shot: string;
  title: string;
  description: string;
  /** `:org`, `:property` and `:booking` are replaced from the seeded property. */
  path: string;
  /** Signed out, for the screens that only exist that way. */
  anonymous?: boolean;
};

export const SCREENS: Screen[] = [
  {
    shot: "landing",
    title: "Landing",
    description: "The public entry point, and the way in to an account.",
    path: "/",
    anonymous: true,
  },
  {
    shot: "sign-in",
    title: "Sign in",
    description: "Credentials against Better Auth. A wrong password stays on this screen.",
    path: "/sign-in",
    anonymous: true,
  },
  {
    shot: "dashboard",
    title: "Dashboard",
    description:
      "Where a signed-in person arrives: their account and the organization they work in.",
    path: "/dashboard",
  },
  {
    shot: "front-desk",
    title: "Front desk — the шахматка",
    description:
      "The desk's main screen. Rooms down, dates across, a booking drawn as a span. Above each category: how many rooms are sold and how many are free, per night. Beside the grid, the day a receptionist works down — who arrives, who leaves, who is staying.",
    path: "/dashboard/orgs/:org/front-desk/:property",
  },
  {
    shot: "bookings",
    title: "Bookings",
    description:
      "Every booking, found without knowing its dates — by guest, room number or reference. Three tabs partition the six states: asked for, sold, over.",
    path: "/dashboard/orgs/:org/front-desk/:property/bookings",
  },
  {
    shot: "housekeeping",
    title: "Housekeeping",
    description:
      "The floor's day, on a phone. Cards rather than a table, because this is read standing up by somebody moving between floors with one hand free. Every room appears, not only the ones with work owed on them.",
    path: "/dashboard/orgs/:org/front-desk/:property/housekeeping",
  },
  {
    shot: "property-setup",
    title: "Property setup",
    description:
      "What the hotel has to sell: room categories, the rooms behind them, and the rate plans a stay is quoted on. Manager-only.",
    path: "/dashboard/orgs/:org/front-desk/:property/setup",
  },
  {
    shot: "desk-grid",
    title: "Desk — the шахматка",
    description:
      "The same grid in the new shell: full width, sections down the left, and the day a receptionist works down beside it rather than above it. A stay that ends where another begins is drawn as one cell split on the diagonal — the room is neither free that day nor doubly sold.",
    path: "/desk/:org/:property",
  },
  {
    shot: "desk-today",
    title: "Desk — today",
    description:
      "Arrivals, departures and who is in house: the three questions a receptionist is asked all morning, as three lists.",
    path: "/desk/:org/:property/today",
  },
  {
    shot: "desk-bookings",
    title: "Desk — bookings",
    description:
      "Every booking, found without knowing its dates. The archive holds the two endings that occupy no room — a cancellation and a no-show — which is why neither appears on the grid.",
    path: "/desk/:org/:property/bookings",
  },
  {
    shot: "desk-booking",
    title: "Desk — a booking, as tabs",
    description:
      "The booking's own screen: status and what may be done to it, then the stays, the guests and what is owed. The tabs are URLs, so one receptionist can send another the exact half they mean.",
    path: "/desk/:org/:property/bookings/:booking",
  },
  {
    shot: "desk-booking-bill",
    title: "Desk — the bill",
    description:
      "The folio: what was charged, what was paid, what is left. Opened by the departure rather than by a button — the number is taken when there is something to number — and it closes only when it balances exactly.",
    path: "/desk/:org/:property/bookings/:booking/bill",
  },
  {
    shot: "desk-rooms",
    title: "Desk — rooms",
    description:
      "What there is to sell: categories and the rooms behind them. A room's state is derived — occupancy from stays, cleanliness from housekeeping — never stored, because a stored status is stale the moment somebody forgets it.",
    path: "/desk/:org/:property/rooms",
  },
  {
    shot: "desk-guests",
    title: "Desk — guests",
    description:
      "The directory from the desk's side. A returning guest is one person with a history, not three unrelated bookings.",
    path: "/desk/:org/:property/guests",
  },
  {
    shot: "directory",
    title: "Directory",
    description: "Guests, contacts and the companies they belong to.",
    path: "/dashboard/orgs/:org/directory",
  },
  {
    shot: "members",
    title: "Members",
    description: "Who has access to the organization, and what each of them may do.",
    path: "/dashboard/orgs/:org/members",
  },
  {
    shot: "settings",
    title: "Organization settings",
    description: "Name, address, the modules that are switched on, and the irreversible actions.",
    path: "/dashboard/orgs/:org/settings",
  },
];

/** Both languages, both themes. Desktop only: nothing here is mobile-first yet. */
export const LOCALES = ["en", "ru"] as const;
export const THEMES = ["light", "dark"] as const;
