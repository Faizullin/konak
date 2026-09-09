/**
 * Why a rule said no, as a code rather than a sentence.
 *
 * The rules in `model/` are pure — `refuseStatusChange` and its siblings answer
 * without a database and without a request — so they have no translator to
 * reach. Returning the words meant those refusals were the one part of the app
 * that could not be translated. Returning a code moves the wording to
 * `messages/en/errors.json`, where every other refusal already lives.
 *
 * `message` stays because `architecture.md` requires every throw to carry one:
 * it is the last resort when a code has no key, and `error-messages.test.ts`
 * makes sure that does not happen. It is deliberately plainer than the message
 * a person actually sees — the precise wording is the translation's job now.
 *
 * In `lib/` because three features' `model/` directories share it, and `model/`
 * may not import from `src/server/`.
 */
export type Refusal = {
  /** A key in `messages/en/errors.json`. */
  code: string;
  /** What the message interpolates, if anything. */
  values?: Record<string, string | number>;
  /** The last resort, in English. Never the sentence a person should read. */
  message: string;
};

/** A rule answers `null` when it has nothing to refuse. */
export type Refused = Refusal | null;
