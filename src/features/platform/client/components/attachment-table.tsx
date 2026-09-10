"use client";

import { Download, FileText, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isThumbnailable } from "@/features/platform";
import { AttachmentStatusBadge } from "./attachment-status-badge";

/**
 * The files on one subject.
 *
 * A plain `Table`, not the `DataTable` stack: a person has a handful of
 * documents, and URL state, a toolbar and pagination would be machinery for a
 * list that fits on one screen. Same call `inventory-panels.tsx` made for rooms
 * — `*Table`, not `*TableView`.
 */

export type AttachmentRow = {
  id: number;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string;
  createdAt: Date;
};

export function AttachmentTable({
  rows,
  canDelete,
  onDelete,
  isDeleting,
}: {
  rows: AttachmentRow[];
  canDelete: boolean;
  onDelete: (id: number) => void;
  isDeleting?: boolean;
}) {
  const t = useTranslations("platform");
  const format = useFormatter();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("attachments.columns.file")}</TableHead>
          <TableHead>{t("attachments.columns.size")}</TableHead>
          <TableHead>{t("attachments.columns.added")}</TableHead>
          <TableHead className="sr-only w-24 text-right">
            {t("attachments.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => {
          const href = `/api/uploads/${row.storageKey}`;

          return (
            <TableRow key={row.id}>
              <TableCell className="flex items-center gap-2 font-medium">
                {/* A thumbnail where a browser can show one — HEIC cannot be,
                    which is why `isThumbnailable` decides rather than the
                    `image/` prefix. */}
                {isThumbnailable(row.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private route, not an optimisable asset
                  <img
                    src={href}
                    alt=""
                    className="size-8 rounded border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="bg-muted flex size-8 items-center justify-center rounded border">
                    <FileText className="text-muted-foreground size-4" aria-hidden />
                  </span>
                )}
                <span className="truncate">{row.fileName}</span>
                <AttachmentStatusBadge state="READY" className="ml-1" />
              </TableCell>

              <TableCell className="text-muted-foreground tabular-nums">
                {row.sizeBytes == null
                  ? "—"
                  : format.number(Math.max(1, Math.round(row.sizeBytes / 1024))) + " kB"}
              </TableCell>

              <TableCell className="text-muted-foreground">
                {format.dateTime(row.createdAt, { dateStyle: "medium" })}
              </TableCell>

              <TableCell className="text-right whitespace-nowrap">
                {/* `?download` forces the save; without it an image or a PDF
                    opens inline — see the route's `Content-Disposition`. */}
                <Button
                  nativeButton={false}
                  render={<a href={`${href}?download`} download={row.fileName} />}
                  variant="ghost"
                  size="icon"
                  title={t("attachments.download")}
                >
                  <Download className="size-4" aria-hidden />
                  <span className="sr-only">{t("attachments.download")}</span>
                </Button>

                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isDeleting}
                    title={t("attachments.delete")}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t("attachments.confirmDelete", { name: row.fileName }),
                        description: t("attachments.confirmDeleteHint"),
                        destructive: true,
                      });
                      if (ok) onDelete(row.id);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    <span className="sr-only">{t("attachments.delete")}</span>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
