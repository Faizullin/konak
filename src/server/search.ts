/**
 * What a typed search term matches.
 *
 * **Always through here.** Prisma's bare `contains` compiles to `LIKE` on
 * Postgres, which is case-sensitive, so a receptionist typing `иванова` found
 * nothing at all unless they capitalised exactly as the row was stored. Three
 * searches shipped that way — the directory's people and companies, and the
 * install's user list — because each was written separately and each had to
 * remember the same thing. This is that thing, written once.
 *
 * It is not a performance helper. Measured on this schema at 25k people in a
 * tenant, `ILIKE` behind the `(organizationId, …)` index the tables already
 * carry answers in 18-27 ms; a trigram index changes the `findMany` by nothing,
 * because `ORDER BY lastName` keeps the planner on the btree either way. Index
 * work waits for a tenant that is two orders of magnitude larger.
 */
export function like(term: string) {
  return { contains: term, mode: "insensitive" } as const;
}
