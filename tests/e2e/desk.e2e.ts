import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";

/**
 * The desk as a **shell**, which is the half nothing else tests.
 *
 * Every other spec drives `deskPath` — the dashboard's front desk — and asserts
 * the product: a stay checks in, a bill balances, a chip lands in a lane. Those
 * are right where they are. What they cannot see is the surface the same
 * components are mounted in, and that is where both of this week's escaped bugs
 * lived:
 *
 * - a server layout calling a function exported from a `"use client"` module,
 *   which 500'd **every** desk route while the suite stayed green;
 * - a component building `/dashboard/orgs/…` inline, so a chip clicked on the
 *   desk threw the user back into the dashboard.
 *
 * Neither is a domain bug and neither could fail a domain test. A screenshot
 * caught them both. So the rule this file follows: **assert that you are still
 * on the desk.** Almost every check below ends in a URL.
 */

test.use({ storageState: storageStateFor("admin") });

test("a chip opens its booking without leaving the desk", async ({
  deskGrid,
  bookings,
  page,
  property,
}) => {
  const booking = await bookings.create({ arrivesIn: 1, roomId: "free" });

  await deskGrid.open();
  await deskGrid.select(booking.guestName);
  await deskGrid.openCard.click();

  // The whole point. This link was `/dashboard/orgs/…` for a week.
  await expect(page).toHaveURL(`${property.surfacePath}/bookings/${booking.publicId}`);
  await expect(page.getByText(booking.reference)).toBeVisible();

  // And the shell is still around it: the sections are still down the left.
  // `exact`, because the booking's own tab strip is also a nav and its label
  // contains this word.
  await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toBeVisible();
});

test("the booking's tabs are URLs, so half of it can be sent to somebody", async ({
  bookings,
  page,
  property,
}) => {
  const booking = await bookings.create({ arrivesIn: 2, roomId: "free" });
  const base = `${property.surfacePath}/bookings/${booking.publicId}`;

  await page.goto(base);
  await page.getByRole("link", { name: "Bill" }).click();
  await expect(page).toHaveURL(`${base}/bill`);

  // A tab held in component state could not do this: opening the URL directly
  // is the thing that makes it sendable.
  await page.goto(`${base}/bill`);
  await expect(page.getByRole("link", { name: "Bill" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Details", exact: true }).click();
  await expect(page).toHaveURL(base);
});

test("a guest opens from the desk's own list, with their history behind them", async ({
  page,
  property,
  bookings,
}) => {
  // A booking is what gives the guest a history worth opening.
  const booking = await bookings.create({ arrivesIn: 3, roomId: "free" });

  await page.goto(`${property.surfacePath}/guests`);

  await page.getByRole("link", { name: booking.guestName }).click();
  await expect(page).toHaveURL(new RegExp(`^.*${property.surfacePath}/guests/\\d+$`));

  /**
   * The two halves of the product join here, and the stay links back into the
   * desk rather than into the dashboard — a history crosses properties, so that
   * link names the property it is going to.
   *
   * Located by its href rather than its name: a history row is labelled by its
   * dates, and the href is the assertion anyway.
   */
  await expect(
    page.locator(`a[href="${property.surfacePath}/bookings/${booking.publicId}"]`)
  ).toBeVisible();
});

test("the floor's board is a section of the desk, not a trip to the dashboard", async ({
  page,
  property,
}) => {
  await page.goto(property.surfacePath);

  await page
    .getByRole("navigation", { name: "Sections", exact: true })
    .getByText("Housekeeping")
    .click();
  await expect(page).toHaveURL(`${property.surfacePath}/housekeeping`);

  // Every room appears, not only the ones with work owed on them: the floor
  // walks the building.
  await expect(page.getByRole("listitem").first()).toBeVisible();
});

test("the theme is a choice, and the product is what sets the class", async ({
  page,
  property,
}) => {
  await page.goto(property.surfacePath);

  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();

  // `next-themes` writes the class; the screenshot report used to write it
  // itself, which proved the tokens and not the feature.
  await expect(html).toHaveClass(/dark/);

  // It follows the person between surfaces, because it is about the room they
  // are sitting in rather than about the screen.
  await page.goto(property.deskPath);
  await expect(html).toHaveClass(/dark/);
});

test("a palette is the surface's own, and the server is what stamps it", async ({
  page,
  property,
}) => {
  await page.goto(property.surfacePath);

  const shell = page.locator('[data-surface="desk"]');
  await expect(shell).toHaveAttribute("data-theme", "default");

  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: "High contrast" }).click();

  await expect(shell).toHaveAttribute("data-theme", "contrast");

  /**
   * And it survives a reload without a flash, which is the whole reason it is a
   * cookie rather than `localStorage`: the layout resolves it and the first
   * frame is already right. A client-side theme would paint the default and
   * correct itself afterwards.
   */
  await page.reload();
  await expect(shell).toHaveAttribute("data-theme", "contrast");

  // The dashboard has one palette, so it is never stamped with another's.
  await page.goto(property.deskPath);
  await expect(page.locator('[data-surface="basic"]')).not.toHaveAttribute(
    "data-theme",
    "contrast"
  );
});
