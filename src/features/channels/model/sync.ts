/**
 * What has changed since the channel was last told.
 *
 * **Out is a difference, never a full re-send** — `product-shape.md` § 14.
 * Sending everything every time is how rate limits are hit and how a busy
 * afternoon falls behind, and a channel manager's quota is counted in messages
 * rather than in changes.
 *
 * `ChannelSyncState` is a *cache of an external system's belief*, never a
 * source of truth for our own availability. Everything here reads it that way.
 */

export type NightState = {
  roomTypeId: number;
  /** UTC midnight of the property's day, like every other date-only value. */
  date: Date;
  availability: number;
  priceMinor: number | null;
  /** The restrictions as they were serialised. Compared as text, not parsed. */
  restrictions: string | null;
};

export type PushedState = NightState & {
  /** Set when the channel rejected the last push; cleared on success. */
  lastError: string | null;
};

const key = (roomTypeId: number, date: Date) => `${roomTypeId}:${date.getTime()}`;

/**
 * The nights worth sending.
 *
 * Three reasons a night is included, and the third is the one that is easy to
 * miss:
 *
 * 1. **Never told.** No mirror row, so the channel does not have it.
 * 2. **Changed.** Availability, price or restrictions differ from what was
 *    last accepted.
 * 3. **Last push failed.** The mirror records what the channel *accepted*, so
 *    a row carrying an error is a night the channel does not have even though
 *    the numbers match. Skipping it would leave the disagreement for ever.
 */
export function nightsToPush(
  current: readonly NightState[],
  pushed: readonly PushedState[]
): NightState[] {
  const mirror = new Map(pushed.map((row) => [key(row.roomTypeId, row.date), row]));

  return current.filter((night) => {
    const last = mirror.get(key(night.roomTypeId, night.date));
    if (!last) return true;
    if (last.lastError) return true;

    return (
      last.availability !== night.availability ||
      last.priceMinor !== night.priceMinor ||
      last.restrictions !== night.restrictions
    );
  });
}

/**
 * Nights the channel holds that we no longer have anything to say about.
 *
 * A room type withdrawn from sale, or a window that moved past. Left alone they
 * are a channel still selling something the hotel stopped offering, which is
 * the expensive direction of this whole problem.
 */
export function nightsToClose(
  current: readonly NightState[],
  pushed: readonly PushedState[]
): PushedState[] {
  const known = new Set(current.map((night) => key(night.roomTypeId, night.date)));
  return pushed.filter(
    (row) => !known.has(key(row.roomTypeId, row.date)) && (row.availability ?? 0) > 0
  );
}
