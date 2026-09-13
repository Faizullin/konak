"use client";

import { FrontDeskDay } from "@/features/reservations/client/components/front-desk-day";
import { ReservationGrid } from "@/features/reservations/client/components/reservation-grid";

/**
 * The grid and today, side by side.
 *
 * **Composition, not a rewrite.** `ReservationGrid` is over 1200 lines of
 * proven arithmetic — spans, lanes, optimistic drags, the keyboard path — and
 * copying it to change a layout would be the worst trade available. What is
 * wrong today is *where these two sit*, and that is fixed here without touching
 * either.
 *
 * Splitting the grid's logic from its markup, so a second visual treatment is a
 * stylesheet rather than a copy, is P3 in `plans/mvp-roadmap.md` — and the
 * right order: prove the layout first, then earn the refactor.
 *
 * The breakpoint is `2xl` rather than `lg`: the grid is 88rem at comfortable
 * density, so anything narrower than about 1536px cannot hold both columns
 * without the grid scrolling horizontally — which is the problem, not the fix.
 */
export function DeskGrid({
  propertyId,
  timezone,
  orgSlug,
  propertySlug,
}: {
  propertyId: number;
  timezone: string;
  orgSlug: string;
  propertySlug: string;
}) {
  return (
    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
      {/* `min-w-0` so the grid scrolls inside its own column instead of
          stretching the row and pushing today off the screen. */}
      <div className="min-w-0 flex-1">
        <ReservationGrid
          propertyId={propertyId}
          timezone={timezone}
          orgSlug={orgSlug}
          propertySlug={propertySlug}
        />
      </div>

      {/* Sticky, because the grid is taller than the viewport and today's work
          is what a receptionist looks back at between drags. */}
      <aside className="2xl:sticky 2xl:top-0 2xl:w-80 2xl:shrink-0">
        <FrontDeskDay
          propertyId={propertyId}
          timezone={timezone}
          orgSlug={orgSlug}
          propertySlug={propertySlug}
        />
      </aside>
    </div>
  );
}
