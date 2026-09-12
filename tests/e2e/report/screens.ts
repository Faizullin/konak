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
  /** `:org` and `:property` are replaced with the seeded slugs. */
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
    shot: "property-setup",
    title: "Property setup",
    description:
      "What the hotel has to sell: room categories, the rooms behind them, and the rate plans a stay is quoted on. Manager-only.",
    path: "/dashboard/orgs/:org/front-desk/:property/setup",
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
