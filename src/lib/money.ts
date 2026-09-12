/**
 * Money for the eye. Storage is an integer of the currency's smallest unit plus
 * the code that says which currency it is; this is the one place that pairing
 * becomes a string.
 *
 * **The exponent comes from `Intl`, never from a constant.** The yen has no
 * minor unit and the dinar has three, so dividing by a hundred is right by luck
 * in most of the world and wrong in the rest.
 */
export function formatMoney(minor: number, currencyCode: string, locale: string): string {
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 0;
    return format.format(minor / 10 ** digits);
  } catch {
    // A code `Intl` will not take is bad data, not a reason to blank a total —
    // show the number that is actually stored and let it look wrong.
    return `${minor} ${currencyCode}`;
  }
}
