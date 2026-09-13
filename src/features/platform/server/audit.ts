import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { auditDiff, type AuditAction } from "../model";

/**
 * Record that somebody did something, in the transaction that did it.
 *
 * Twinned with `enqueueOutbox`, deliberately and down to the type: it takes the
 * caller's transaction client, so the audit row and the change it records
 * commit together or not at all. A mutation that rolls back leaves no trail of
 * having happened, and one that succeeds cannot lose its trail to a failure
 * afterwards.
 *
 * That is the one thing this has over the two alternatives. A trigger is
 * transactional but cannot see *who* — under a connection pool the database
 * only knows the role every request shares — and cannot see a read at all.
 * `pgaudit` sees reads but writes to the log file rather than a table, and says
 * in its own README that there is no guarantee a committed transaction has a
 * corresponding entry. Neither can answer "who made this person an owner".
 *
 * **No Prisma middleware and no `$extends`**: `architecture.md` convention 4
 * says audit columns are passed explicitly, and the same argument applies here.
 * A call site that must be written is a call site a reader can find.
 */

type Auditor = Pick<Prisma.TransactionClient, "auditLog">;

export type AuditEntry = {
  /** Absent for an install-wide act, which belongs to no tenant. */
  organizationId?: number | null;
  /** The user, not their membership — the trail outlives being removed. */
  actorUserId?: string;
  action: AuditAction;
  entityType: string;
  /** A string because entity ids are not all integers; `User.id` is not. */
  entityId: string;
  summary?: string;
  ipAddress?: string | null;
  /**
   * Passed as rows, not as a diff. The allowlist in `model/audit.ts` decides
   * what may be kept, so a caller cannot accidentally record a field nobody
   * agreed to store.
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function writeAudit(tx: Auditor, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary ?? null,
      diffJson: auditDiff(entry.entityType, entry.before ?? null, entry.after ?? null),
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
