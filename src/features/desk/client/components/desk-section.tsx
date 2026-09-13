import type { ReactNode } from "react";
import { DeskBar } from "./desk-bar";

/**
 * The frame every desk section fills: a bar, then everything else.
 *
 * `min-h-0` on the body is what lets a section scroll inside the shell rather
 * than growing the page — the grid and the board both want their own scroll,
 * and a page-level one would take the bar with it.
 */
export function DeskSection({
  property,
  section,
  actions,
  dashboardHref,
  children,
}: {
  property: string;
  section: string;
  actions?: ReactNode;
  dashboardHref?: string;
  children: ReactNode;
}) {
  return (
    <>
      <DeskBar
        property={property}
        section={section}
        actions={actions}
        dashboardHref={dashboardHref}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </>
  );
}
