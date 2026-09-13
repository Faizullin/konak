import "server-only";
import {
  ConflictError,
  InvalidError,
  isUniqueViolation,
  NotFoundError,
  refused,
} from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { requirePropertyMember } from "@/features/properties/server";
import { nextSeriesNumber } from "@/features/reservations/server";
import {
  BillingError,
  closeFolioSchema,
  folioForReservationSchema,
  FolioStatus,
  PaymentStatus,
  postLineSchema,
  priceLine,
  refundPaymentSchema,
  refuseClose,
  refusePosting,
  splitFolioSchema,
  takePaymentSchema,
  voidLineSchema,
} from "../model";
import { lockFolio, openFolioFor } from "./service";

/**
 * The bill attached to a stay.
 *
 * Two disciplines run through everything here. **A number that means something
 * legally comes from a sequence, taken inside the transaction that uses it** —
 * never a count of rows plus one, because two clerks pressing the button at the
 * same instant would get the same number and a duplicated invoice number is a
 * finding at audit. And **nothing is edited**: a correction voids a line and
 * posts another, because a bill somebody has already seen is a record.
 */

/** Lines and payments, in the shape the rules read them. */
/**
 * Enough of a folio to decide about it: what it is, and the two lists the
 * balance is arithmetic on.
 *
 * **Deliberately not paged**, and it is the one place in this codebase where an
 * unbounded read is the correct answer. `refuseClose` sums these to decide
 * whether the bill balances, and `close` freezes that sum into
 * `closedTotalMinor` — a number that is never re-derived, on purpose. A `take`
 * here would not make a screen slow; it would close a bill at a total missing
 * the lines past the limit, silently and for ever.
 *
 * The bound that matters is on the other end: a folio belongs to one stay, and
 * `postLine` is a person typing.
 */
const FOLIO_STATE = {
  id: true,
  status: true,
  currencyCode: true,
  lines: { select: { id: true, amountMinor: true, voidedAt: true } },
  payments: { select: { id: true, amountMinor: true, status: true } },
} as const;

export const billingRouter = createTRPCRouter({
  /**
   * The reservation's folio, opened if it has none.
   *
   * Opened lazily rather than with the booking: most bookings are made months
   * ahead and a folio number taken then is a number burnt on a stay that may
   * never happen.
   */
  folioForReservation: protectedProcedure
    .input(folioForReservationSchema)
    .mutation(async ({ ctx, input }) => {
      const { property, user } = await requirePropertyMember(ctx, input.propertyId);

      const reservation = await ctx.db.reservation.findFirst({
        where: { id: input.reservationId, propertyId: input.propertyId },
        select: { id: true, currencyCode: true },
      });
      if (!reservation) {
        throw new NotFoundError("reservation.not_found", "Reservation not found");
      }

      /**
       * The service, not a second implementation of it.
       *
       * This procedure and `openFolioFor` were two readings of one sentence —
       * "the reservation's folio, opened if it has none" — including the same
       * `status: { not: VOID }` reasoning written out twice. One of them now
       * knows how to lose the race to the other, and a copy would not have.
       */
      const { id } = await ctx.db.$transaction((tx) =>
        openFolioFor(tx, {
          organizationId: property.organizationId,
          propertyId: property.id,
          reservationId: reservation.id,
          currencyCode: reservation.currencyCode,
          userId: user.id,
        })
      );

      return ctx.db.folio.findUniqueOrThrow({ where: { id }, select: FOLIO_STATE });
    }),

  /**
   * The folio this reservation already has, or `null`.
   *
   * A read, because a screen has to tell "no bill yet" from "a bill the
   * departure opened". Without it the only way to learn a folio id is the
   * mutation above — and a bill created by check-out then stays invisible
   * behind a button offering to open one, which is both wrong and alarming.
   */
  currentFolio: protectedProcedure
    .input(folioForReservationSchema)
    .query(async ({ ctx, input }) => {
      await requirePropertyMember(ctx, input.propertyId);

      return ctx.db.folio.findFirst({
        where: {
          reservationId: input.reservationId,
          propertyId: input.propertyId,
          status: { not: FolioStatus.VOID },
        },
        select: { id: true },
      });
    }),

  get: protectedProcedure.input(closeFolioSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const folio = await ctx.db.folio.findFirst({
      where: { id: input.id, propertyId: input.propertyId },
      select: {
        id: true,
        number: true,
        status: true,
        currencyCode: true,
        closedTotalMinor: true,
        closedAt: true,
        company: { select: { id: true, name: true } },
        lines: {
          select: {
            id: true,
            type: true,
            description: true,
            quantity: true,
            unitPriceMinor: true,
            taxRateBp: true,
            taxAmountMinor: true,
            amountMinor: true,
            serviceDate: true,
            postedAt: true,
            voidedAt: true,
          },
          orderBy: { postedAt: "asc" },
        },
        payments: {
          select: {
            id: true,
            method: true,
            status: true,
            amountMinor: true,
            capturedAt: true,
            refundedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!folio) {
      throw new NotFoundError(BillingError.FOLIO_NOT_FOUND, "Folio not found");
    }
    return folio;
  }),

  postLine: protectedProcedure.input(postLineSchema).mutation(async ({ ctx, input }) => {
    const { user } = await requirePropertyMember(ctx, input.propertyId);

    // The parts are computed rather than accepted, so a line cannot exist whose
    // tax disagrees with its own quantity and price.
    const amounts = priceLine(input);

    return ctx.db.$transaction(async (tx) => {
      await lockFolio(tx, input.folioId);

      const folio = await tx.folio.findFirst({
        where: { id: input.folioId, propertyId: input.propertyId },
        select: { id: true, status: true, reservationId: true },
      });
      if (!folio) {
        throw new NotFoundError(BillingError.FOLIO_NOT_FOUND, "Folio not found");
      }

      // Read under the lock, so a folio closed a moment ago cannot still be
      // posted to. Before, the status was read and then written against, and
      // the gap between was enough.
      const closed = refusePosting(folio.status);
      if (closed) throw refused(closed);

      /**
       * A room line names the stay it is for, and that stay has to be on the
       * booking this bill is billing.
       *
       * It was accepted as a bare number with no check at all, so a line could
       * be bound to **another tenant's** stay — which also poisons
       * `postRoomCharges`, whose idempotency is "does this stay already have a
       * line". The id is the caller's claim; this is the question.
       */
      if (input.roomStayId !== undefined && input.roomStayId !== null) {
        const stay = await tx.roomStay.count({
          where: { id: input.roomStayId, reservationId: folio.reservationId ?? -1 },
        });
        if (stay === 0) {
          // Invalid rather than not-found: the row may well exist, and saying
          // so would confirm another tenant's id to somebody guessing.
          throw new InvalidError(
            BillingError.LINE_STAY_FOREIGN,
            "That stay is not on this bill's booking",
            "roomStayId"
          );
        }
      }

      return tx.folioLine.create({
        data: {
          folioId: folio.id,
          type: input.type,
          description: input.description,
          quantity: input.quantity,
          unitPriceMinor: input.unitPriceMinor,
          taxRateBp: input.taxRateBp,
          taxAmountMinor: amounts.taxAmountMinor,
          amountMinor: amounts.amountMinor,
          roomStayId: input.roomStayId,
          serviceDate: input.serviceDate,
          postedById: user.id,
        },
      });
    });
  }),

  /** A correction voids and re-posts; nothing is edited and nothing is deleted. */
  voidLine: protectedProcedure.input(voidLineSchema).mutation(async ({ ctx, input }) => {
    const { user } = await requirePropertyMember(ctx, input.propertyId);

    const line = await ctx.db.folioLine.findFirst({
      where: { id: input.id, folio: { propertyId: input.propertyId } },
      select: { id: true, voidedAt: true, folio: { select: { status: true } } },
    });
    if (!line) {
      throw new NotFoundError(BillingError.LINE_NOT_FOUND, "Line not found");
    }
    if (line.voidedAt) {
      throw new ConflictError(BillingError.LINE_ALREADY_VOID, "That line is already void");
    }

    const closed = refusePosting(line.folio.status);
    if (closed) throw refused(closed);

    return ctx.db.folioLine.update({
      where: { id: line.id },
      data: { voidedAt: new Date(), voidedById: user.id },
    });
  }),

  takePayment: protectedProcedure.input(takePaymentSchema).mutation(async ({ ctx, input }) => {
    const { user } = await requirePropertyMember(ctx, input.propertyId);

    return ctx.db.$transaction(async (tx) => {
      await lockFolio(tx, input.folioId);

      const folio = await tx.folio.findFirst({
        where: { id: input.folioId, propertyId: input.propertyId },
        select: { id: true, status: true, currencyCode: true, reservationId: true },
      });
      if (!folio) {
        throw new NotFoundError(BillingError.FOLIO_NOT_FOUND, "Folio not found");
      }

      const closed = refusePosting(folio.status);
      if (closed) throw refused(closed);

      /**
       * A double-click must not take the money twice.
       *
       * The old comment here said the key is unique in the schema "so the
       * second attempt reads the first rather than racing it". It raced it: a
       * read and a create are two statements, and the loser got a raw
       * duplicate-key **500** — at somebody who pressed a button once and saw
       * nothing happen, which is the one moment they will press it again.
       */
      if (input.idempotencyKey) {
        const already = await tx.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (already) return already;
      }

      try {
        return await tx.payment.create({
          data: {
            propertyId: input.propertyId,
            folioId: folio.id,
            reservationId: folio.reservationId,
            method: input.method,
            status: PaymentStatus.CAPTURED,
            amountMinor: input.amountMinor,
            currencyCode: folio.currencyCode,
            externalRef: input.externalRef,
            idempotencyKey: input.idempotencyKey,
            capturedAt: new Date(),
            createdById: user.id,
          },
        });
      } catch (error) {
        // The folio lock serialises two clicks on *this* bill; the key is
        // unique across all of them, so a key reused on another folio still
        // arrives here. Taken means taken.
        if (!input.idempotencyKey || !isUniqueViolation(error)) throw error;

        return tx.payment.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
      }
    });
  }),

  /**
   * A refund is a state on the payment, not a negative one beside it.
   *
   * The money went out the way it came in, and `paidMinor` stops counting a
   * `REFUNDED` payment by itself — so the balance moves without a second row
   * that could disagree with the first.
   */
  refundPayment: protectedProcedure.input(refundPaymentSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const payment = await ctx.db.payment.findFirst({
      where: { id: input.id, propertyId: input.propertyId },
      select: { id: true, status: true },
    });
    if (!payment) {
      throw new NotFoundError(BillingError.PAYMENT_NOT_FOUND, "Payment not found");
    }
    if (payment.status !== PaymentStatus.CAPTURED) {
      throw new ConflictError(
        BillingError.PAYMENT_NOT_CAPTURED,
        "Only a captured payment can be refunded"
      );
    }

    return ctx.db.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAt: new Date(),
        failureReason: input.reason,
      },
    });
  }),

  /**
   * Close it, and freeze the total.
   *
   * The frozen number is why a closed bill reads the same for ever even if a
   * line is later voided by a correction on another folio.
   */
  close: protectedProcedure.input(closeFolioSchema).mutation(async ({ ctx, input }) => {
    const { user } = await requirePropertyMember(ctx, input.propertyId);

    /**
     * Read the lines and freeze their total in one act.
     *
     * `closedTotalMinor` is deliberately not re-derivable — that is the point
     * of freezing it — so a line posted between the read and the write was
     * excluded from the number for ever, and nothing downstream could notice.
     * The lock is what makes "balanced" and "closed at this total" the same
     * instant.
     */
    return ctx.db.$transaction(async (tx) => {
      await lockFolio(tx, input.id);

      const folio = await tx.folio.findFirst({
        where: { id: input.id, propertyId: input.propertyId },
        select: FOLIO_STATE,
      });
      if (!folio) {
        throw new NotFoundError(BillingError.FOLIO_NOT_FOUND, "Folio not found");
      }

      const refusal = refuseClose(folio);
      if (refusal) throw refused(refusal);

      return tx.folio.update({
        where: { id: folio.id },
        data: {
          status: FolioStatus.CLOSED,
          closedAt: new Date(),
          closedTotalMinor: folio.lines.reduce(
            (total, line) => (line.voidedAt ? total : total + line.amountMinor),
            0
          ),
          updatedById: user.id,
        },
      });
    });
  }),

  /**
   * The company pays the room, the guest pays the bar.
   *
   * Lines **move** rather than being copied: a charge exists once, and two
   * folios that each hold a version of it is how a hotel bills something twice.
   */
  split: protectedProcedure.input(splitFolioSchema).mutation(async ({ ctx, input }) => {
    const { property, user } = await requirePropertyMember(ctx, input.propertyId);

    const folio = await ctx.db.folio.findFirst({
      where: { id: input.id, propertyId: input.propertyId },
      select: {
        id: true,
        status: true,
        currencyCode: true,
        reservationId: true,
        lines: { select: { id: true } },
      },
    });
    if (!folio) {
      throw new NotFoundError(BillingError.FOLIO_NOT_FOUND, "Folio not found");
    }

    const closed = refusePosting(folio.status);
    if (closed) throw refused(closed);

    const mine = new Set(folio.lines.map((line) => line.id));
    const moving = input.lineIds.filter((id) => mine.has(id));
    if (moving.length !== input.lineIds.length) {
      throw new NotFoundError(
        BillingError.LINE_NOT_FOUND,
        "Some of those lines are not on this folio"
      );
    }

    return ctx.db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, {
        organizationId: property.organizationId,
        propertyId: property.id,
        kind: "FOLIO",
      });

      const second = await tx.folio.create({
        data: {
          propertyId: input.propertyId,
          reservationId: folio.reservationId,
          companyId: input.companyId,
          number,
          currencyCode: folio.currencyCode,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await tx.folioLine.updateMany({
        where: { id: { in: moving } },
        data: { folioId: second.id },
      });

      return second;
    });
  }),
});
