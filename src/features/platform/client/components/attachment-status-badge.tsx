"use client";

import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AttachmentStatus } from "@/features/platform";

/**
 * What state a file is in.
 *
 * Three values, not two: `AttachmentStatus` is `PENDING | READY` on the row,
 * and *failed* is a client-side fact that never reaches the database — a
 * transfer that was refused leaves a PENDING row for the sweep, not a column.
 *
 * Per `ui-patterns.md` § Colour as data, hue is never the only cue: each value
 * carries a glyph as well. The glyph is `aria-hidden` because the `title`
 * already says it in words.
 */

export type AttachmentBadgeState = AttachmentStatus | "FAILED";

const STYLE: Record<AttachmentBadgeState, string> = {
  PENDING:
    "border-dashed border-amber-500/60 text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
  READY:
    "border-emerald-500/60 text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
  FAILED:
    "border-destructive/60 text-destructive bg-destructive/10 dark:text-red-300 dark:bg-red-950/40",
};

const MARK: Record<AttachmentBadgeState, typeof Check> = {
  PENDING: CircleDashed,
  READY: Check,
  FAILED: TriangleAlert,
};

export function AttachmentStatusBadge({
  state,
  className,
}: {
  state: AttachmentBadgeState;
  className?: string;
}) {
  const t = useTranslations("platform");
  const Mark = MARK[state];
  const label = t(`attachments.state.${state}` as "attachments.state.READY");

  return (
    <span
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        STYLE[state],
        className
      )}
    >
      <Mark className="size-3" aria-hidden />
      {label}
    </span>
  );
}
