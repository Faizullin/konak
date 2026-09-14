"use client";

import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
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

  const variant = state === "FAILED" ? "destructive" : state === "READY" ? "secondary" : "outline";

  return (
    <Badge
      variant={variant}
      title={label}
      className={cn("gap-1 font-medium", state === "PENDING" && "border-dashed", className)}
    >
      <Mark className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}
