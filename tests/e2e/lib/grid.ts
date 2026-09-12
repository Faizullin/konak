import type { Page } from "@playwright/test";

/**
 * The шахматка, as a test drives it.
 *
 * The one page object here, because it is the one screen genuinely re-driven —
 * everything else is visited once and read. It holds **locators and the
 * smallest verbs, never assertions**: a page object that asserts reports its
 * failure in a file that does not say what was being attempted.
 *
 * Locators are roles and labels rather than test ids. That is affordable
 * because every control on this screen already carries an `aria-label` from the
 * message files — `grid.previousWeek`, `grid.jumpToDate`, `grid.close` — which
 * is the accessibility guarantee and the test handle at once.
 */
export class GridPage {
  constructor(
    private readonly page: Page,
    private readonly deskPath: string
  ) {}

  async open(on?: string) {
    await this.page.goto(on ? `${this.deskPath}?on=${on}` : this.deskPath);
    // The grid renders behind a skeleton; the date input is the first thing
    // that exists only once it has drawn.
    await this.jumpToDate.waitFor();
  }

  get jumpToDate() {
    return this.page.getByLabel("Jump to a date");
  }

  get newBooking() {
    return this.page.getByRole("button", { name: "New booking" });
  }

  get findBooking() {
    return this.page.getByRole("link", { name: "Find a booking" });
  }

  /**
   * A chip is named by its guest — `guestName ?? reference` is its only text,
   * and the `title` that also carries the reference, status and dates is not
   * the accessible name when there is text content.
   */
  chip(guestName: string) {
    return this.page.getByRole("button", { name: guestName, exact: true });
  }

  /**
   * The bar above the grid, which exists only once a chip is selected.
   *
   * Everything below is scoped to it, because the day lists on the same page
   * offer the same four buttons — an unscoped `Check in` finds whichever the
   * DOM happens to put first, and the test then asserts about a booking it
   * never made.
   */
  get actions() {
    return this.page.getByRole("group", { name: "Selected booking" });
  }

  action(name: string) {
    return this.actions.getByRole("button", { name, exact: true });
  }

  /** Rendered as a button, not a link: `Button` keeps its own role. */
  get openCard() {
    return this.actions.getByRole("button", { name: "Open" });
  }

  async select(guestName: string) {
    await this.chip(guestName).click();
  }

  async goTo(date: string) {
    await this.jumpToDate.fill(date);
  }
}
