"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WINDOW_NIGHTS, type GridWindowNights } from "@/features/reservations";

/**
 * How one desk likes its grid, remembered in that browser.
 *
 * Not a server setting: a forty-room property read on a 13" laptop wants a
 * tighter row than the same property on the manager's monitor, and the two are
 * the same user row. `localStorage` is the right size of durability for a
 * choice that belongs to a screen rather than to a person.
 *
 * Per property, because the collapsed categories are — density and window
 * length coming back to their defaults at a second property is the cheaper half
 * of that trade.
 */

export const DENSITY_VALUES = ["comfortable", "compact"] as const;

export type Density = (typeof DENSITY_VALUES)[number];

export type DeskPreferences = {
  density: Density;
  windowNights: GridWindowNights;
  /** Room type ids drawn as a heading with nothing under it. */
  collapsed: number[];
};

const DEFAULTS: DeskPreferences = {
  density: "comfortable",
  windowNights: DEFAULT_WINDOW_NIGHTS,
  collapsed: [],
};

const keyFor = (propertyId: number) => `konak.desk.${propertyId}`;

export function useDeskPreferences(propertyId: number) {
  // Defaults first and the stored value in an effect, never during render: the
  // server has no `localStorage`, and reading it while rendering makes the
  // first client pass disagree with the HTML it is hydrating.
  const [preferences, setPreferences] = useState<DeskPreferences>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(keyFor(propertyId));
      if (raw) setPreferences({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<DeskPreferences>) });
      else setPreferences(DEFAULTS);
    } catch {
      // Private windows, blocked site data, a hand-edited value — a preference
      // that cannot be read is a preference at its default, not an error.
      setPreferences(DEFAULTS);
    }
  }, [propertyId]);

  const update = useCallback(
    (change: Partial<DeskPreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...change };
        try {
          window.localStorage.setItem(keyFor(propertyId), JSON.stringify(next));
        } catch {
          // Same again: the screen still honours the choice for this session.
        }
        return next;
      });
    },
    [propertyId]
  );

  const toggleCollapsed = useCallback(
    (roomTypeId: number) =>
      setPreferences((current) => {
        const collapsed = current.collapsed.includes(roomTypeId)
          ? current.collapsed.filter((id) => id !== roomTypeId)
          : [...current.collapsed, roomTypeId];
        const next = { ...current, collapsed };
        try {
          window.localStorage.setItem(keyFor(propertyId), JSON.stringify(next));
        } catch {
          // As above.
        }
        return next;
      }),
    [propertyId]
  );

  return { preferences, update, toggleCollapsed };
}
