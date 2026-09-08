/**
 * Cross-reference integrity: rows that hold two foreign keys which could point
 * at different properties.
 *
 * `RoomStay` names a reservation, a room type, a room and a rate plan — all
 * four property-scoped, and nothing in the database stops them disagreeing.
 * Postgres cannot express it either; it is a check before the write.
 */

/** True when every value that is set is the same. Unset values are not a conflict. */
export function sameScope(...scopes: Array<number | null | undefined>): boolean {
  const present = scopes.filter((s): s is number => s != null);
  return present.length === 0 || present.every((s) => s === present[0]);
}

/** The distinct scopes found, for an error message that says which ones clashed. */
export function conflictingScopes(...scopes: Array<number | null | undefined>): number[] {
  return [...new Set(scopes.filter((s): s is number => s != null))];
}
