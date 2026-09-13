import { test as base } from "@playwright/test";
import { createBookingsFixture } from "../fixtures/booking";
import { seededProperty, type SeededProperty } from "../fixtures/property";
import { GridPage } from "./grid";

/**
 * The `test` every spec imports — **never `@playwright/test` directly**.
 *
 * A spec that needs a booking asks for one; how it is made and that it is
 * removed are the fixture's problem. This is the shape cal.com settled on: the
 * tutorials propose a `pages/` directory of page objects, and the large
 * codebases build fixtures instead, folding the few page objects that earn
 * themselves into the same mechanism.
 */

export type Fixtures = {
  property: SeededProperty;
  bookings: ReturnType<typeof createBookingsFixture>;
  grid: GridPage;
  /** The same шахматка, in the desk's shell rather than the dashboard's. */
  deskGrid: GridPage;
};

export const test = base.extend<Fixtures>({
  property: async ({}, use) => {
    await use(await seededProperty());
  },

  bookings: async ({ property }, use) => {
    const fixture = createBookingsFixture({
      propertyId: property.propertyId,
      organizationId: property.organizationId,
      roomTypeId: property.roomTypeId,
    });

    await use(fixture);

    // After the test, whether it passed or not: a leftover booking is a room
    // the next test finds sold.
    await fixture.deleteAll();
  },

  grid: async ({ page, property }, use) => {
    await use(new GridPage(page, property.deskPath));
  },

  // The same page object: the grid is one component and the point of the desk
  // is that it is the *shell* that differs. A second page object here would be
  // a second chance for the two to disagree.
  deskGrid: async ({ page, property }, use) => {
    await use(new GridPage(page, property.surfacePath));
  },
});

export { expect } from "@playwright/test";
