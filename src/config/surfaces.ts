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

/**
 * How a surface is built — and therefore **how a theme is applied to it**.
 *
 * Not a label. `shadcn` means Tailwind and CSS custom properties, so a theme is
 * a `data-theme` value and a block of variables, and switching one is an
 * attribute on an element that is already rendered.
 *
 * A vendor base would not work that way. Bootstrap and Ant ship *compiled*
 * stylesheets per theme, so switching there means choosing which stylesheet
 * loads — a different mechanism, decided at build or by the layout, not by an
 * attribute. `AppearanceToggle` draws the theme row only for bases it knows how
 * to switch, which is why this is a union and not a string.
 *
 * It is also what makes the other half of the rule checkable rather than a
 * paragraph nobody reads: **a surface with its own base owns its own
 * components.** A `desk2` on Bootstrap does not re-skin `components/ui/*`; it
 * has `features/desk2/client/components/` written against its own base. No
 * component is written to serve two bases.
 */
export type SurfaceBase = "shadcn";

/** The bases whose themes are a `data-theme` attribute this product can set. */
export const ATTRIBUTE_THEMED: SurfaceBase[] = ["shadcn"];

export interface Surface {
  /** The `data-surface` value its layout stamps. */
  id: string;
  /**
   * Every palette it can wear, as `data-theme` values, the first being the
   * default. One entry means no theme control is drawn.
   *
   * A theme's label is `shell.theme.<id>` by convention rather than a field:
   * the control reads it as a template, which is what lets `message-keys.test`
   * see the whole prefix as used. A registry entry with a label field would
   * have been a second place to forget.
   */
  themes: { id: string }[];
  base: SurfaceBase;
}

export const SURFACES = {
  basic: {
    id: "basic",
    // Stock shadcn, and deliberately only that: the dashboard holds forms and
    // settings, and a second palette for it is a want nobody has expressed.
    themes: [{ id: "default" }],
    base: "shadcn",
  },
  desk: {
    id: "desk",
    /**
     * Two, and the second has a reason rather than being a demonstration.
     *
     * A front desk is read for eight hours in a lobby nobody chose the lighting
     * of. Dark answers the dim end. `contrast` answers the other: a sunlit
     * counter, a screen at an angle, or an operator who simply cannot separate
     * the two greys a dense grid is drawn in.
     */
    themes: [{ id: "default" }, { id: "contrast" }],
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

/** The id every surface's list starts with, and what an unreadable cookie means. */
export const DEFAULT_THEME = "default";

/**
 * Where a surface's theme choice is remembered — **a cookie, not
 * `localStorage`**, and the difference is not taste.
 *
 * A theme needs no resolving against the machine, so the server can know it and
 * paint the first frame right. The colour scheme is the exception in the other
 * direction: `system` is only knowable in a browser, which is why
 * `next-themes` owns that one and accepts a flash-avoiding inline script to do
 * it. A preference that *can* be resolved on the server should be, and
 * `konak.locale` and `sidebar_state` are the precedent.
 *
 * One per surface, because the choice is per surface.
 */
export const themeCookie = (surface: SurfaceId) => `konak.theme.${surface}`;

/**
 * A theme id the surface actually has.
 *
 * An unrecognised value reads as the default rather than throwing: it is a
 * cookie, and a cookie is whatever the last version of this app wrote there.
 */
export function toTheme(surface: SurfaceId, value: string | undefined | null): string {
  return SURFACES[surface].themes.some((theme) => theme.id === value) ? value! : DEFAULT_THEME;
}
