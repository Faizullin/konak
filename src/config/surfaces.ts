/**
 * The surfaces this product draws, as data.
 *
 * A **surface** is a shell with its own layout: `basic` is the dashboard,
 * `desk` is the front desk. Each names itself in the
 * DOM with `data-surface`, and `styles/*.css` scopes a block of tokens to that
 * name — which is why a second palette is a CSS block rather than a second set
 * of components. No component names a colour.
 *
 * Three axes, kept apart deliberately (`plans/dashboard-header.md` § 2):
 *
 * - **Surface** — where you navigated to. Not a choice.
 * - **Colour scheme** — light or dark. One choice per person, whole install,
 *   because it is about the room they are sitting in and should follow them
 *   between surfaces. `next-themes` owns it.
 * - **Theme** — which palette a surface wears. One choice *per surface*.
 *
 * Today every surface declares exactly one theme, so no theme control is drawn
 * anywhere. The row appears the day a surface has two, from the same code —
 * which is what makes this file worth having before there is a second palette
 * to put in it.
 */

export interface Surface {
  /** The `data-surface` value its layout stamps. */
  id: string;
  /**
   * Every palette it can wear, as `data-theme` values. The first is its
   * default and stamps nothing. One entry means no theme control is drawn.
   *
   * `labelKey` is absent while a surface has one theme, because a control that
   * would list a single option is not drawn and an unread message is a test
   * failure (`message-keys.test.ts`). Labels arrive with the second palette,
   * which is the same commit that makes them visible.
   */
  themes: { id: string; labelKey?: string }[];
  /**
   * The CSS base its components are written against.
   *
   * One legal value today, and the field exists anyway: it is what makes the
   * rule checkable rather than a paragraph nobody reads — **a surface with its
   * own base owns its own components**. A `desk2` on Bootstrap does not re-skin
   * `components/ui/*`; it has `features/desk2/client/components/` written
   * against its own base. No component is written to serve two bases.
   */
  base: "shadcn";
}

export const SURFACES = {
  basic: {
    id: "basic",
    themes: [{ id: "default" }],
    base: "shadcn",
  },
  desk: {
    id: "desk",
    themes: [{ id: "default" }],
    base: "shadcn",
  },
} satisfies Record<string, Surface>;

export type SurfaceId = keyof typeof SURFACES;

/** The colour schemes offered, in the order the control lists them. */
export const COLOUR_SCHEMES = ["system", "light", "dark"] as const;

export type ColourScheme = (typeof COLOUR_SCHEMES)[number];

/**
 * Named like `konak.locale` and `konak.desk.*` rather than the library's bare
 * `theme`, so everything this product stores in a browser reads as ours.
 */
export const THEME_STORAGE_KEY = "konak.theme";
