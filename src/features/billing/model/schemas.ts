import { z } from "zod";
import { paymentMethodSchema } from "./folio";
import { lineTypeSchema } from "./line";

export const folioForReservationSchema = z.object({
  propertyId: z.number(),
  reservationId: z.number(),
});

export type FolioForReservationInput = z.infer<typeof folioForReservationSchema>;

export const postLineSchema = z.object({
  propertyId: z.number(),
  folioId: z.number(),
  type: lineTypeSchema,
  description: z.string().min(1, "name_required").max(200),
  quantity: z.number().int().min(1).max(999).default(1),
  /** Negative is a discount. There is no second code path for one. */
  unitPriceMinor: z.number().int(),
  taxRateBp: z.number().int().min(0).max(10_000).default(0),
  roomStayId: z.number().optional(),
  serviceDate: z.coerce.date().optional(),
});

export type PostLineInput = z.infer<typeof postLineSchema>;

export const voidLineSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
});

export type VoidLineInput = z.infer<typeof voidLineSchema>;

export const takePaymentSchema = z.object({
  propertyId: z.number(),
  folioId: z.number(),
  method: paymentMethodSchema,
  /** Always positive. Money going the other way is a refund, which is its own act. */
  amountMinor: z.number().int().positive(),
  externalRef: z.string().max(200).optional(),
  /**
   * A double-click on "charge" must not take the money twice. Unique in the
   * schema, so this is the database refusing rather than a check racing it.
   */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type TakePaymentInput = z.infer<typeof takePaymentSchema>;

export const refundPaymentSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  reason: z.string().max(500).optional(),
});

export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const closeFolioSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
});

export type CloseFolioInput = z.infer<typeof closeFolioSchema>;

/**
 * Moving lines onto a second folio: the company pays the room, the guest pays
 * the bar. Not an edge case — it is how corporate travel works everywhere.
 */
export const splitFolioSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  lineIds: z.array(z.number()).min(1),
  /** Who the new folio is for, when it is not the guest. */
  companyId: z.number().optional(),
});

export type SplitFolioInput = z.infer<typeof splitFolioSchema>;
