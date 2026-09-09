"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

/**
 * The words for an enum, in the current language.
 *
 * Returns a `Record` rather than a lookup function on purpose: the call sites
 * pass these straight to `items={…}` on a `Select`, index them by value, and
 * iterate them with `Object.entries`. A record keeps all three working, so
 * moving a table out of `model/` and into `messages/` costs one import and one
 * hook call per component rather than a rewrite.
 *
 * An unrecognised value answers with itself — the columns these describe are
 * strings, and a row written before a value was added should render as what it
 * says rather than as blank.
 */
export function useEnumLabels<T extends string>(
  group: "userRole" | "orgRole" | "roomStatus" | "mealPlan" | "dayRole" | "reservationStatus",
  values: readonly T[]
): Record<T, string> {
  const t = useTranslations("enums");

  return useMemo(() => {
    const labels = {} as Record<T, string>;
    for (const value of values) {
      // Typed to the literal keys of the JSON; an enum value is data here.
      const key = `${group}.${value}` as Parameters<typeof t.has>[0];
      labels[value] = t.has(key) ? t(key) : value;
    }
    return labels;
  }, [t, group, values]);
}
