"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Where a link goes, decided by the surface rather than by the component.
 *
 * The grid, the day lists and the bookings table all built
 * `/dashboard/orgs/…/front-desk/…/bookings/<publicId>` inline. That was fine
 * while there was one surface. It is not fine now: the desk renders the same
 * components, and every link out of it landed back in the dashboard — a
 * receptionist clicking a chip left the shell they were working in.
 *
 * The alternative was threading an `hrefs` prop through three components and
 * their children. This is the honest shape instead: a link's destination is
 * ambient information about *where the tree is mounted*, which is what a
 * context is for.
 *
 * **What crosses the boundary is a string, not a function.** A server layout
 * cannot call a function exported from a `"use client"` module — React refuses
 * with "attempted to call it from the server", and the whole surface 500s. So
 * the context carries the base path and the shapes below it are built here.
 * That they *are* the same shape on both surfaces is the useful fact:
 * `/desk/:org/:prop` and `/dashboard/orgs/:org/front-desk/:prop` differ only in
 * their stem.
 *
 * **Additive on purpose.** With no provider the hook returns exactly the paths
 * that were written inline, so a component rendered anywhere else behaves as it
 * did. The dashboard mounts nothing; the desk mounts its own.
 */

export type SurfaceLinks = {
  /** The шахматка. */
  grid: () => string;
  /** Every booking, searchable — the screen the grid's window cannot answer. */
  bookings: () => string;
  /** One booking, by the id that may be said out loud. */
  booking: (publicId: string) => string;
};

function linksUnder(base: string): SurfaceLinks {
  return {
    grid: () => base,
    bookings: () => `${base}/bookings`,
    booking: (publicId: string) => `${base}/bookings/${publicId}`,
  };
}

const SurfaceBaseContext = createContext<string | null>(null);

export function SurfaceLinksProvider({ base, children }: { base: string; children: ReactNode }) {
  return <SurfaceBaseContext.Provider value={base}>{children}</SurfaceBaseContext.Provider>;
}

/**
 * The surface's links, or the dashboard's.
 *
 * Callers still pass their slugs, because the fallback needs them and because a
 * component that cannot build its own links is a component that cannot be
 * rendered without a provider.
 */
export function useSurfaceLinks(args: { orgSlug: string; propertySlug: string }): SurfaceLinks {
  const base = useContext(SurfaceBaseContext);
  const { orgSlug, propertySlug } = args;

  return useMemo(
    () => linksUnder(base ?? `/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`),
    [base, orgSlug, propertySlug]
  );
}
