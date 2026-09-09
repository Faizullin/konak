import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { blankToNull, normalizeEmail } from "../model";

/**
 * Writing a person, for the callers that are not directory management.
 *
 * This has a service because a booking creates its guest inside the booking's
 * own transaction — the threshold `architecture.md` states — and a half-written
 * guest attached to no reservation is worse than no guest at all.
 */

export type GuestPersonInput = {
  organizationId: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
};

/**
 * The guest a booking names, created inside the caller's transaction.
 *
 * Deliberately not `directory.createPerson`: that is a management action, gated
 * on the DIRECTORY module and on `canManagePeople`. A hotel running no
 * directory still takes walk-ins, and the person behind a reservation is a
 * booking artifact rather than a directory entry someone chose to file.
 *
 * An existing person with the same email is reused rather than duplicated. The
 * router refuses that as a conflict because a human is filing a record; here
 * the guest is simply already known.
 */
export async function createGuestPerson(
  tx: Pick<Prisma.TransactionClient, "person">,
  input: GuestPersonInput,
  userId: string
) {
  const email = normalizeEmail(input.email);

  if (email) {
    const existing = await tx.person.findFirst({
      where: { organizationId: input.organizationId, email },
      select: { id: true },
    });
    if (existing) return existing;
  }

  return tx.person.create({
    data: {
      organization: { connect: { id: input.organizationId } },
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      phone: blankToNull(input.phone),
      createdById: userId,
      updatedById: userId,
    },
    select: { id: true },
  });
}
