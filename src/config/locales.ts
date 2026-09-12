/**
 * The languages the app speaks, as data.
 *
 * Isomorphic and dependency-free, like `nav-items.ts`: a language switcher, a
 * request-config file and a validation of the cookie all read this rather than
 * each keeping its own list.
 */

export const LOCALES = ["en", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** In the language itself, which is how a person finds their own. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
};

/** The cookie a person's choice is remembered in. */
export const LOCALE_COOKIE = "konak.locale";

/** An unrecognised value reads as the default rather than throwing: it is a cookie. */
export function toLocale(value: string | undefined | null): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}
