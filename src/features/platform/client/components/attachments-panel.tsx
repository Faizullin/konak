"use client";

import { RotateCw, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileDropzone } from "@/components/common/file-dropzone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useErrorHandlers } from "@/lib/errors";
import { OrgRole } from "@/features/organizations";
import { canDeleteAttachments, canUploadAttachments } from "@/features/organizations";
import {
  acceptAttribute,
  subjectInput,
  type AttachmentKind,
  type SubjectRef,
} from "@/features/platform";
import { trpc } from "@/utils/trpc";
import { useAttachmentUpload } from "../hooks/use-attachment-upload";
import { AttachmentStatusBadge } from "./attachment-status-badge";
import { AttachmentTable } from "./attachment-table";

/**
 * Files on one subject: the quota, a drop target, what is in flight, and what
 * landed.
 *
 * The reuse seam — the only thing another feature imports. Its whole prop
 * surface is the shape `requestUploadSchema` already validates, so a feature
 * mounting it passes what it would have sent anyway rather than a prop per
 * subject.
 */
export function AttachmentsPanel({
  organizationId,
  subject,
  kind = "FILE",
  title,
  showUsage = true,
}: {
  organizationId: number;
  subject: SubjectRef;
  kind?: AttachmentKind;
  title?: string;
  /** Off for the second and third panel on a page — the quota is one number. */
  showUsage?: boolean;
}) {
  const t = useTranslations("platform");
  const format = useFormatter();
  const { handleError } = useErrorHandlers();
  const utils = trpc.useUtils();

  // The same query every other panel makes for the caller's role. A prop would
  // save a request; this keeps the rule in one place and matches `RatePlansPanel`.
  const { data: organization } = trpc.organization.getById.useQuery({ id: organizationId });
  const role = (organization?.currentUserRole as OrgRole | undefined) ?? null;
  const mayUpload = role ? canUploadAttachments(role) : false;
  const mayDelete = role ? canDeleteAttachments(role) : false;

  // Filtered by kind: a panel lists what it manages, so two on one person
  // do not show the same files twice.
  const listInput = { organizationId, ...subjectInput(subject), kind };
  const { data: rows, isLoading } = trpc.platform.listAttachments.useQuery(listInput);
  const { data: usage } = trpc.platform.storageUsage.useQuery(
    { organizationId },
    { enabled: showUsage }
  );

  const { items, upload, cancel, retry, clear, isUploading } = useAttachmentUpload({
    organizationId,
    subject,
    kind,
  });

  const remove = trpc.platform.deleteAttachment.useMutation({
    onSuccess: () => {
      toast.success(t("attachments.deleted"));
      utils.platform.listAttachments.invalidate();
      utils.platform.storageUsage.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const megabytes = (bytes: number) => format.number(Math.round(bytes / (1024 * 1024)));

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{title ?? t("attachments.title")}</h2>
        {showUsage && usage && (
          // Beside the dropzone, not only on failure: a person who can see the
          // bar fill does not need the refusal.
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("attachments.usage", {
              used: megabytes(usage.usedBytes),
              quota: megabytes(usage.quotaBytes),
            })}
          </p>
        )}
      </header>

      {mayUpload && (
        <FileDropzone
          accept={acceptAttribute(kind)}
          multiple
          disabled={isUploading}
          onFiles={upload}
          label={t("attachments.drop")}
          browseLabel={t("attachments.browse")}
        />
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{item.fileName}</span>
                  <AttachmentStatusBadge
                    state={
                      item.state === "done"
                        ? "READY"
                        : item.state === "failed" || item.state === "cancelled"
                          ? "FAILED"
                          : "PENDING"
                    }
                  />
                </div>

                {item.error ? (
                  <p className="text-destructive mt-1 text-xs">{item.error}</p>
                ) : (
                  // A bar rather than a shared primitive: one caller, and
                  // `architecture.md` wants the third before a component exists.
                  <div className="bg-muted mt-2 h-1 w-full overflow-hidden rounded">
                    <div
                      className="bg-primary h-full transition-[width]"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              {(item.state === "uploading" || item.state === "confirming") && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("attachments.cancel")}
                  onClick={() => cancel(item.id)}
                >
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">{t("attachments.cancel")}</span>
                </Button>
              )}

              {(item.state === "failed" || item.state === "cancelled") && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("attachments.retry")}
                  onClick={() => retry(item.id)}
                >
                  <RotateCw className="size-4" aria-hidden />
                  <span className="sr-only">{t("attachments.retry")}</span>
                </Button>
              )}
            </li>
          ))}

          {items.some((item) => item.state === "done") && (
            <li>
              <Button variant="ghost" size="sm" onClick={clear}>
                {t("attachments.clearFinished")}
              </Button>
            </li>
          )}
        </ul>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows && rows.length > 0 ? (
        <AttachmentTable
          rows={rows}
          canDelete={mayDelete}
          isDeleting={remove.isPending}
          onDelete={(id) => remove.mutate({ organizationId, id })}
        />
      ) : (
        // "Nothing yet", not "nothing matched" — the second is the one people
        // misread as breakage, and this panel has no filter to have matched.
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
          {t("attachments.empty")}
        </p>
      )}
    </section>
  );
}
