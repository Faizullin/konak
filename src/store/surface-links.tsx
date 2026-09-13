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
 * the context carries paths and the shapes below them are built here.
 *
 * **Two scopes, not one**, because the product has two. A booking belongs to a
 * property and a person belongs to the organisation — a guest of one hotel in a
 * group is a guest of the group. Folding them into one hook would have forced
 * the directory table, which has no property, to invent one.
 *
 * **Additive on purpose.** With no provider both hooks return exactly the paths
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

type SurfaceShape = {
  /** `<stem>/<propertySlug>` is a property's home on this surface. */
  stem: string;
  /**
   * Where people live, absolute — because a surface may keep them outside the
   * property. The dashboard does (`/directory`); the desk does not (`/guests`
   * under the property it has open).
   */
  directory: string;
};

const SurfaceContext = createContext<SurfaceShape | null>(null);

export function SurfaceLinksProvider({
  stem,
  directory,
  children,
}: SurfaceShape & { children: ReactNode }) {
  // Memoised, or every render below re-reads a new object and re-memoises with
  // it — which is the whole saving this context exists to make.
  const value = useMemo(() => ({ stem, directory }), [stem, directory]);
  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
}

/**
 * The property-scoped links: the grid, the bookings list, a booking.
 *
 * Callers still pass their slugs, because the fallback needs them and because a
 * component that cannot build its own links is a component that cannot be
 * rendered without a provider.
 */
export function useSurfaceLinks(args: { orgSlug: string; propertySlug: string }): SurfaceLinks {
  const surface = useContext(SurfaceContext);
  const bookingAt = useBookingLink(args.orgSlug);
  const { orgSlug, propertySlug } = args;

  return useMemo(() => {
    const base = `${surface?.stem ?? `/dashboard/orgs/${orgSlug}/front-desk`}/${propertySlug}`;

    return {
      grid: () => base,
      bookings: () => `${base}/bookings`,
      booking: (publicId: string) => bookingAt(propertySlug, publicId),
    };
  }, [surface, orgSlug, propertySlug, bookingAt]);
}

/**
 * One booking, at a property named rather than assumed.
 *
 * The primitive the two above are built from, and its own hook because its
 * callers are not property-scoped: a guest's stay history crosses properties —
 * a guest of one hotel in a group is a guest of the group — so it knows each
 * stay's property and has no "current" one. A hook that demanded one would have
 * been a hook that lied.
 *
 * It is also why the context carries a *stem* rather than a finished base: the
 * two surfaces differ only in the segment being swapped.
 */
export function useBookingLink(
  orgSlug: string
): (propertySlug: string, publicId: string) => string {
  const surface = useContext(SurfaceContext);

  return useMemo(() => {
    const stem = surface?.stem ?? `/dashboard/orgs/${orgSlug}/front-desk`;
    return (propertySlug: string, publicId: string) =>
      `${stem}/${propertySlug}/bookings/${publicId}`;
  }, [surface, orgSlug]);
}

/**
 * One person, on whichever surface is asking.
 *
 * Its own hook rather than a fifth entry above: the directory is
 * organisation-wide, and `PeopleTableView` is rendered by a dashboard route
 * that has no property at all. A hook that demanded one would have been a hook
 * that lied.
 */
export function usePersonLink(orgSlug: string): (personId: number) => string {
  const surface = useContext(SurfaceContext);

  return useMemo(() => {
    const directory = surface?.directory ?? `/dashboard/orgs/${orgSlug}/directory`;
    return (personId: number) => `${directory}/${personId}`;
  }, [surface, orgSlug]);
}
