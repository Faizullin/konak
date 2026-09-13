"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import {
  nextStatuses,
  refuseStatusChange,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  todayAt,
} from "@/features/reservations";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { useEnumLabels } from "@/lib/labels";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";
import { useBookingActions, type BookingActionKeys } from "./use-booking-actions";

/**
 * One booking, and what may be done to it — with no opinion about how any of it
 * is drawn.
 *
 * `booking-card.tsx` holds the same logic inside its markup, which was fine
 * while there was one screen. There are two now, and a third style is a stated
 * intention: a second presentation that re-derived "which buttons, and why the
 * rest are refused" would be a second chance to get it wrong, and the two would
 * drift the first time a rule changed.
 *
 * So the decisions live here and the components are thin. What a surface still
 * owns is wording — `keys` — because a chip on a grid and a card that names the
 * booking need different questions before a cancellation.
 */

export type Booking = GeneralRouterOutputs["reservation"]["byPublicId"];

export type BookingAction = {
  status: ReservationStatus;
  label: string;
  /** The sentence, when it may not be done. `undefined` when it may. */
  refusal: string | undefined;
  /** The two that end a booking, and are not undone by setting the column back. */
  destructive: boolean;
  run: () => void;
};

export function useBooking(args: {
  propertyId: number;
  publicId: string;
  timezone: string;
  keys: BookingActionKeys;
}) {
  const { propertyId, publicId, timezone } = args;

  const { label, confirmed } = useBookingActions(args.keys);
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const refusalText = useRefusalText();
  const { handleError } = useErrorHandlers();

  const input = useMemo(() => ({ propertyId, publicId }), [propertyId, publicId]);
  const { data: booking, isLoading } = trpc.reservation.byPublicId.useQuery(input);

  const utils = trpc.useUtils();
  const setStatus = trpc.reservation.setStatus.useMutation({
    onSuccess: (reservation) => {
      toast.success(`${label(reservation.status)} — ${reservation.reference}`);
    },
    onError: (error) => handleError(error),
    onSettled: () => {
      // The card, the grid and the day lists all draw this booking. A status
      // that moves on one and not the others is two screens disagreeing.
      utils.reservation.byPublicId.invalidate(input);
      utils.reservation.grid.invalidate();
      utils.reservation.day.invalidate();
    },
  });

  // The property's day, not the browser's: a booking arriving "today" in
  // Europe/Berlin is not today for a desk read from somewhere else.
  const today = useMemo(() => todayAt(timezone), [timezone]);

  const actions: BookingAction[] = (booking ? nextStatuses(booking.status) : []).map((status) => {
    const refusal = refuseStatusChange({
      from: booking!.status,
      to: status,
      // Every stay, which is the whole point: the server reads them all, so an
      // offer made about one is an offer the server then refuses.
      stays: booking!.stays,
      today,
    });

    return {
      status,
      label: label(status),
      refusal: refusalText(refusal),
      destructive: status === ReservationStatus.CANCELLED || status === ReservationStatus.NO_SHOW,
      run: async () => {
        if (!(await confirmed(status))) return;
        setStatus.mutate({ propertyId, id: booking!.id, status });
      },
    };
  });

  return {
    booking,
    isLoading,
    actions,
    /** Said once under the buttons rather than only in each disabled title. */
    reasons: [...new Set(actions.flatMap((action) => action.refusal ?? []))],
    statusLabel: (status: string) => statusLabels[status as ReservationStatus] ?? status,
    pending: setStatus.isPending,
  };
}
