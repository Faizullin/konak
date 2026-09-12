/**
 * Days from today, as `<input type="date">` spells them.
 *
 * The same UTC-midnight reading `model/stay.ts` uses: a stay date is a day, and
 * a browser input is `YYYY-MM-DD`. Inside the seed's ninety-night horizon, so a
 * date chosen here is one the hotel actually has inventory for.
 */
export function toDayInput(offsetDays: number): string {
  const now = new Date();
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)
  );
  return day.toISOString().slice(0, 10);
}
