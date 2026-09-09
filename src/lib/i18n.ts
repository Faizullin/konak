import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, toLocale, type Locale } from "@/config/locales";
import en from "../../messages/en/index";

/**
 * Which language a request is answered in, and the strings for it.
 *
 * **No locale routing.** The URL carries no language segment, so
 * `/dashboard/orgs/acme` stays the link a person can share, and no proxy is
 * needed to rewrite it — `architecture.md` says the absence of a middleware is
 * the design, and a language should not be what reverses that.
 *
 * The locale comes from a cookie, which means a route reading it is dynamic.
 * That costs nothing today: every route but `/_not-found` is already
 * server-rendered on demand. It is the thing to re-examine when Phase 8 wants
 * a prerendered public booking page.
 *
 * In `lib/` by the architecture's own test — this knows no business rule and
 * would be swapped wholesale for another library.
 */

const MESSAGES = { en } satisfies Record<Locale, unknown>;

export type Messages = typeof en;

declare module "next-intl" {
  /**
   * Makes `t("signIn.title")` autocomplete and a typo a compile error, from the
   * JSON itself — there is no second list of keys to keep in step.
   */
  interface AppConfig {
    Messages: Messages;
    Locale: Locale;
  }
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = toLocale(store.get(LOCALE_COOKIE)?.value);

  return { locale, messages: MESSAGES[locale] };
});
