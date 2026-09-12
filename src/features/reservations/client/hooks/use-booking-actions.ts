"use client";

import { useTranslations } from "next-intl";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { ReservationStatus } from "@/features/reservations";

/**
 * The buttons a booking offers, worded once.
 *
 * Three surfaces offer the same transitions — the grid, the day lists and the
 * booking card — and two views of one reservation may not disagree about what
 * they do. What is per-surface is only the wording: a day-list row already says
 * which booking it is, and a chip on the grid does not.
 *
 * **Keys are passed as literals, never built from a surface name.**
 * `message-keys.test.ts` reads an interpolated key as "every key in this
 * namespace is used", so a template here would quietly switch the orphan check
 * off for the whole namespace.
 */
export type BookingActionKeys = {
  /** Only where "Cancel" alone would not say what it cancels. */
  cancelAction?: string;
  cancelTitle: string;
  cancelDescription: string;
  noShowTitle: string;
  noShowDescription: string;
};

export function useBookingActions(keys: BookingActionKeys) {
  const t = useTranslations("reservations");

  /**
   * A status arrives from the server as a string, so the key is checked before
   * it is read — an unrecognised one renders as itself rather than throwing.
   */
  const label = (status: string) => {
    if (status === ReservationStatus.CANCELLED && keys.cancelAction) {
      return t(keys.cancelAction as never);
    }
    const key = `actions.${status}` as Parameters<typeof t.has>[0];
    return t.has(key) ? t(key) : status;
  };

  /** The two that end a booking, and are not undone by setting the column back. */
  const asksFirst = (status: string) =>
    status === ReservationStatus.CANCELLED || status === ReservationStatus.NO_SHOW;

  /** `true` to go ahead — everything that does not ask answers immediately. */
  const confirmed = async (status: string) => {
    if (!asksFirst(status)) return true;
    const cancelling = status === ReservationStatus.CANCELLED;
    return confirm({
      title: t((cancelling ? keys.cancelTitle : keys.noShowTitle) as never),
      description: t((cancelling ? keys.cancelDescription : keys.noShowDescription) as never),
      destructive: true,
      confirmLabel: label(status),
    });
  };

  return { label, asksFirst, confirmed };
}
