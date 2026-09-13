/**
 * What the audit trail records, and — more importantly — what it must not.
 *
 * `architecture.md` table convention 5 has required this table since it was
 * written, and nothing wrote to it. That is the gap this closes: not
 * everything, but the acts that cannot be reconstructed from `createdById` and
 * `updatedById` on the row itself. Who was made an owner, who was removed, who
 * took a payment, who deleted a tenant.
 *
 * **Not every mutation.** Auditing all fifty-nine would be a volume problem and
 * a maintenance one, and it is not what anybody does: OWASP's logging guidance
 * names *"access to sensitive data"* and privilege changes rather than "all
 * writes", and CloudTrail splits management events from data events for the
 * same reason. The list here is the management plane.
 */

export const AuditAction = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  ARCHIVE: "ARCHIVE",
  DELETE: "DELETE",
  /** A read that is itself an event — a passport opened, a report exported. */
  VIEW: "VIEW",
  EXPORT: "EXPORT",
  SIGN: "SIGN",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AUDIT_ACTION_VALUES = Object.values(AuditAction);

/**
 * The fields a diff may carry, per entity.
 *
 * **An allowlist, never `JSON.stringify(row)`.** A diff built from whatever the
 * row happens to hold would write a passport number in clear into an
 * unencrypted column — recreating precisely the failure `numberEncrypted`
 * exists to prevent, in the table that is hardest to redact afterwards because
 * nothing is supposed to delete from it.
 *
 * An entity absent from this table records **no diff at all**, which is the
 * safe default: a new entity is silent until somebody decides what about it is
 * safe to keep.
 */
export const AUDITED_FIELDS: Record<string, readonly string[]> = {
  Organization: ["name", "slug", "description"],
  OrganizationMember: ["role"],
  User: ["role", "email"],
};

/**
 * What changed, as JSON, limited to the fields that entity is allowed to
 * record — or `null` when nothing did.
 *
 * `null` rather than `{}` so a row with no diff reads as "this act had no field
 * changes" (a deletion, a view) rather than "somebody forgot".
 */
export function auditDiff(
  entityType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string | null {
  const allowed = AUDITED_FIELDS[entityType];
  if (!allowed) return null;

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of allowed) {
    /**
     * A missing *side* and a field missing from a present side are different
     * facts, and conflating them made the trail lie. A creation has no `before`
     * at all, so every field is genuinely new; a removal has no `after`, so
     * every field is genuinely gone. But when a side is there and the field is
     * not, the caller passed a partial row — and reading that as `null` had the
     * log reporting that an admin cleared somebody's email address during a
     * role change that never touched it. The trail may only speak about what it
     * was shown.
     */
    if (before && !(field in before)) continue;
    if (after && !(field in after)) continue;

    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    // `Object.is` rather than `!==` so two `NaN`s are not a change; dates and
    // objects are compared by identity, which is right for the scalar fields
    // this list is allowed to name.
    if (!Object.is(from, to)) changes[field] = { from, to };
  }

  return Object.keys(changes).length > 0 ? JSON.stringify(changes) : null;
}
