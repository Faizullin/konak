import type { Locator, Page } from "@playwright/test";
import type { SeededProperty } from "../fixtures/property";
import reservations from "../../../messages/ru/reservations.json";
import shell from "../../../messages/ru/shell.json";

/**
 * What the client's report photographs, and how to get there.
 *
 * One row per picture. The row says where to go, what to do first, and what to
 * point the camera at; the Russian prose that surrounds it is in
 * `docs/reports/src/mvp-report.ru.md`, because a client-facing paragraph is
 * content and `architecture.md` keeps content out of code. The two are joined
 * by `id` and neither can drift: `scripts/mvp-report.mts` fails on a
 * placeholder naming a shot nobody took, and on a shot no placeholder uses.
 *
 * **Everything is located by what a person sees, in the language the shot is
 * taken in.** The strings come from `messages/ru/*.json`, so a renamed button
 * fails the run instead of photographing the wrong element. The two exceptions
 * are `unassigned-band`, which already carries a test id for exactly this
 * reason, and the date input, which is located by shape.
 *
 * The desk only. `report:ui` photographs everything else.
 */

export type Context = {
  page: Page;
  property: SeededProperty;
  /** Мария Иванова — the guest with three stays behind her. */
  regularPersonId: number;
};

/**
 * How a step is framed.
 *
 * `page` is the viewport. `element` is the one thing worth looking at — the
 * counts band, a dialog — and is what makes a crop legible where a 1440px page
 * scaled into a document is not. `around` is for what has no single element:
 * a bounding box, padded, which is how the open appearance menu is caught
 * together with the bar it hangs from.
 */
export type Frame =
  | { kind: "page" }
  | { kind: "element"; locate: (context: Context) => Locator }
  | {
      kind: "around";
      locate: (context: Context) => Locator;
      pad: { top?: number; right?: number; bottom?: number; left?: number };
    };

export type Step = {
  /** Stable. The file name, and what a placeholder in the prose names. */
  id: string;
  /** Where in the document it appears, and therefore the file's number. */
  order: number;
  /** The caption printed under the picture, in Russian. */
  caption: string;
  path: (context: Context) => string;
  /** Anything that has to happen before the shutter. */
  act?: (context: Context) => Promise<void>;
  frame: Frame;
};

/** The шахматка's own toolbar: the date input's row, located by shape. */
const gridToolbar = ({ page }: Context) => page.locator('input[type="date"]').locator("xpath=..");

/** A stay's bar on the grid, named by its guest — its only text content. */
const chip = ({ page }: Context, guest: string) =>
  page.getByRole("button", { name: guest, exact: true });

const desks = (context: Context) => context.property.surfacePath;

export const STEPS: Step[] = [
  {
    id: "grid",
    order: 1,
    caption: "Шахматка: номера сверху вниз, даты слева направо, бронь — одна полоса.",
    path: desks,
    frame: { kind: "page" },
  },
  {
    id: "grid-counts",
    order: 2,
    caption: "Занято и свободно на каждую ночь, по категориям — а не одним числом на гостиницу.",
    path: desks,
    frame: {
      kind: "around",
      // The label column carries the two words, one per lane; the numbers sit
      // to its right across every night in the window.
      locate: ({ page }) => page.getByText(reservations.grid.sold, { exact: true }).first(),
      pad: { top: 34, bottom: 22, left: 150, right: 1400 },
    },
  },
  {
    id: "grid-unassigned",
    order: 3,
    caption: "«Не выбран номер»: гость купил категорию. Полосу перетаскивают на строку номера.",
    path: desks,
    frame: {
      kind: "element",
      // One band per room type that has one, so name the booking: Игорь
      // Лебедев arrives today without a room, which is the case worth showing.
      locate: ({ page }) =>
        page.getByTestId("unassigned-band").filter({ hasText: "Игорь Лебедев" }),
    },
  },
  {
    id: "grid-turnover",
    order: 4,
    caption: "Один выезжает, другой заезжает в тот же день: ячейка делится по диагонали.",
    path: desks,
    frame: {
      kind: "around",
      locate: (context) => chip(context, "Наталья Орлова"),
      pad: { top: 26, bottom: 26, left: 400, right: 200 },
    },
  },
  {
    id: "grid-dates",
    order: 5,
    caption: "Навигация по датам: день, неделя, любая дата, длина окна и плотность.",
    path: desks,
    frame: { kind: "element", locate: gridToolbar },
  },
  {
    id: "booking-new",
    order: 6,
    caption:
      "Новое бронирование: свободные номера показаны по ночам, стоимость складывается из них.",
    path: desks,
    act: async ({ page }) => {
      await page.getByRole("button", { name: reservations.booking.title }).click();
    },
    frame: { kind: "element", locate: ({ page }) => page.getByRole("dialog") },
  },
  {
    id: "booking-walk-in",
    order: 7,
    caption: "Заезд без брони: бронь, номер и заселение одним действием.",
    path: desks,
    act: async ({ page }) => {
      await page.getByRole("button", { name: reservations.day.walkIn }).click();
    },
    frame: { kind: "element", locate: ({ page }) => page.getByRole("dialog") },
  },
  {
    id: "today",
    order: 8,
    caption: "Актуальные: заезды, выезды и проживающие на выбранный день.",
    path: (context) => `${desks(context)}/today`,
    frame: { kind: "page" },
  },
  {
    id: "booking",
    order: 9,
    caption: "Карточка бронирования, вкладка «Основное» — статус, даты, гости, суммы.",
    path: (context) => `${desks(context)}/bookings/${context.property.bookingPublicId}`,
    frame: { kind: "page" },
  },
  {
    id: "booking-refusal",
    order: 10,
    caption:
      "«Заселить» недоступно до дня заезда — и причина написана рядом, словами, " +
      "а не оставлена на догадку.",
    path: desks,
    // A booking six nights out, selected on the grid: the check-in it refuses
    // is the date rule, and the refusal is visible as a disabled button.
    // The card's own actions are the same component with the same rules; this
    // is simply where a refused one can be found without arranging data.
    act: async (context) => {
      await chip(context, "Артём Новиков").click();
      await context.page.getByTestId("stay-actions").waitFor();
    },
    frame: { kind: "element", locate: ({ page }) => page.getByTestId("stay-actions") },
  },
  {
    id: "bill",
    order: 11,
    caption: "Вкладка «Оплата»: начисления, оплаты, остаток. Вкладки — это адреса.",
    path: (context) => `${desks(context)}/bookings/${context.property.bookingPublicId}/bill`,
    frame: { kind: "page" },
  },
  {
    id: "rooms",
    order: 12,
    caption: "Номера: категории, номера, и два разных вопроса — «Сегодня» и «Уборка».",
    path: (context) => `${desks(context)}/rooms`,
    frame: { kind: "page" },
  },
  {
    id: "housekeeping",
    order: 13,
    caption: "Уборка: состояние этажа. Выселение само делает номер грязным.",
    path: (context) => `${desks(context)}/housekeeping`,
    frame: { kind: "page" },
  },
  {
    id: "guest",
    order: 14,
    caption: "Карточка гостя: контакты, теги, документы и история проживаний.",
    path: (context) => `${desks(context)}/guests/${context.regularPersonId}`,
    frame: { kind: "page" },
  },
  {
    id: "appearance",
    order: 15,
    caption: "Язык и оформление в верхней панели: светлая, тёмная, высокий контраст.",
    path: desks,
    act: async ({ page }) => {
      await page.getByRole("button", { name: shell.appearance.label }).click();
      await page.getByRole("menu").waitFor();
    },
    frame: {
      kind: "around",
      // The menu is portalled to the body, so it is not inside the bar — the
      // padding below is what catches both in one picture.
      locate: ({ page }) => page.getByRole("banner").or(page.locator("header")).first(),
      pad: { bottom: 300 },
    },
  },
];
