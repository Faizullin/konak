import "server-only";
import prisma from "@/server/db";
import { createGuestPerson } from "@/features/directory/server";
import { nextSeriesNumber } from "@/features/reservations/server";
import { ChannelError } from "../model";
import type { InboundReservation } from "./adapter";

/**
 * A booking made somewhere else, applied here.
 *
 * **Receiving the same one twice produces one booking.** Networks retry, a
 * channel re-sends, a worker is restarted mid-batch — so the only safe design
 * is one where applying twice is indistinguishable from applying once. That is
 * `@@unique([propertyId, channelCode, externalRef])` in the schema: the
 * *database* refuses the duplicate, rather than a check here racing another
 * copy of this function.
 *
 * **It lands in the unassigned band, never in a room.** The channel sold a room
 * *type*; choosing a door is the desk's decision and belongs to whoever is
 * standing there — `product-shape.md` § 4.
 */

export type AppliedInbound = {
  reservationId: number;
  reference: string;
  created: boolean;
  cancelled: boolean;
};

export async function applyInboundReservation(
  connection: { id: number; propertyId: number; channelCode: string; organizationId: number },
  inbound: InboundReservation
): Promise<AppliedInbound> {
  // What this channel calls the type, translated back. Absent means the channel
  // sold something this property no longer maps — loud rather than guessed at,
  // because guessing puts a guest in the wrong category.
  const mapping = await prisma.channelMapping.findFirst({
    where: {
      connectionId: connection.id,
      externalRoomTypeId: inbound.externalRoomTypeId,
      isActive: true,
    },
    select: { roomTypeId: true, ratePlanId: true },
  });
  if (!mapping) {
    throw new Error(
      `${ChannelError.MAPPING_UNKNOWN}: "${inbound.externalRoomTypeId}" on connection ${connection.id}`
    );
  }

  const existing = await prisma.reservation.findFirst({
    where: {
      propertyId: connection.propertyId,
      channelCode: connection.channelCode,
      externalRef: inbound.externalRef,
    },
    select: { id: true, reference: true, status: true },
  });

  // Cancelled there is cancelled here, and cancelling twice is not an error —
  // the desk may already have heard, and a channel re-sends.
  if (inbound.cancelled) {
    if (!existing) {
      return { reservationId: 0, reference: "", created: false, cancelled: true };
    }
    if (existing.status !== "CANCELLED") {
      await prisma.$transaction(async (tx) => {
        await tx.roomStay.updateMany({
          where: { reservationId: existing.id },
          data: { status: "CANCELLED" },
        });
        await tx.reservation.update({
          where: { id: existing.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "CHANNEL" },
        });
      });
    }
    return {
      reservationId: existing.id,
      reference: existing.reference,
      created: false,
      cancelled: true,
    };
  }

  if (existing) {
    // Already here. Not updated: a channel's later message about a booking it
    // already told us about is a modification, which is its own decision with
    // its own price consequences — and silently rewriting dates underneath a
    // desk that has already assigned a room is worse than not knowing.
    return {
      reservationId: existing.id,
      reference: existing.reference,
      created: false,
      cancelled: false,
    };
  }

  return prisma.$transaction(async (tx) => {
    const reference = await nextSeriesNumber(tx, {
      organizationId: connection.organizationId,
      propertyId: connection.propertyId,
      kind: "RESERVATION",
    });

    const booker = await createGuestPerson(
      tx,
      {
        organizationId: connection.organizationId,
        firstName: inbound.guest.firstName,
        lastName: inbound.guest.lastName,
        email: inbound.guest.email,
      },
      // No author: nobody clicked. The columns are nullable for exactly this.
      undefined
    );

    const reservation = await tx.reservation.create({
      data: {
        propertyId: connection.propertyId,
        reference,
        status: "CONFIRMED",
        source: "OTA",
        channelCode: connection.channelCode,
        externalRef: inbound.externalRef,
        bookerPersonId: booker.id,
        currencyCode: inbound.currencyCode,
        totalMinor: inbound.totalMinor,
        stays: {
          create: [
            {
              roomTypeId: mapping.roomTypeId,
              ratePlanId: mapping.ratePlanId,
              // No room. The channel sold a type; the door is the desk's.
              roomId: null,
              status: "CONFIRMED",
              checkIn: inbound.checkIn,
              checkOut: inbound.checkOut,
              adults: inbound.adults,
              children: inbound.children,
              currencyCode: inbound.currencyCode,
              totalMinor: inbound.totalMinor,
            },
          ],
        },
      },
      select: { id: true, reference: true },
    });

    return {
      reservationId: reservation.id,
      reference: reservation.reference,
      created: true,
      cancelled: false,
    };
  });
}
