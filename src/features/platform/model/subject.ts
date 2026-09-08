/**
 * Activities, tags and attachments hang off exactly one subject, as one
 * nullable foreign key each. SQLite has no CHECK constraint, so this is where
 * "exactly one" is enforced — before the write, not after.
 */

export const SUBJECT_KINDS = ["person", "company", "property"] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type SubjectRef = {
  personId?: number | null;
  companyId?: number | null;
  propertyId?: number | null;
};

export type Subject = { kind: SubjectKind; id: number };

/** The subjects actually set. Length is the whole invariant. */
export function subjectsOf(ref: SubjectRef): Subject[] {
  const found: Subject[] = [];
  if (ref.personId != null) found.push({ kind: "person", id: ref.personId });
  if (ref.companyId != null) found.push({ kind: "company", id: ref.companyId });
  if (ref.propertyId != null) found.push({ kind: "property", id: ref.propertyId });
  return found;
}

/** Zero is an orphan, two is ambiguous; both are refused before the insert. */
export function hasExactlyOneSubject(ref: SubjectRef): boolean {
  return subjectsOf(ref).length === 1;
}

export function subjectOf(ref: SubjectRef): Subject | null {
  const found = subjectsOf(ref);
  return found.length === 1 ? found[0]! : null;
}
