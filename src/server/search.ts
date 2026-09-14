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

export const SEARCH_TERM_LIMIT = 4;

/**
 * A typed search, split into the words that must all match something.
 */
export function searchTerms(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_TERM_LIMIT);
}

/**
 * Generates ё/е variants for Cyrillic search terms so that typing either
 * matches stored records regardless of orthography.
 */
export function searchTermVariants(term: string): string[] {
  if (!term) return [term];

  let variants: string[] = [""];

  for (const char of term) {
    if ((char === "е" || char === "ё") && variants.length < 32) {
      variants = variants.flatMap((v) => [v + "е", v + "ё"]);
    } else if ((char === "Е" || char === "Ё") && variants.length < 32) {
      variants = variants.flatMap((v) => [v + "Е", v + "Ё"]);
    } else {
      variants = variants.map((v) => v + char);
    }
  }

  const set = new Set<string>();
  set.add(term);
  for (const v of variants) {
    set.add(v);
  }
  return Array.from(set);
}

export function like(term: string) {
  return { contains: term, mode: "insensitive" } as const;
}
