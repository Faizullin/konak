"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslations } from "next-intl";
import { BaseDialog } from "@/components/common/base-dialog";
import { Button } from "@/components/ui/button";
import type { AttachmentKind, SubjectRef } from "@/features/platform";
import { AttachmentsPanel } from "./attachments-panel";

/**
 * Attaching a file to a subject, from anywhere.
 *
 * Global rather than owned by a screen because of *ownership*, not call-site
 * count — `ui-patterns.md` § Which tier: any feature attaches a file to a
 * person, a company or a property, so it belongs to none of them.
 *
 * It renders `AttachmentsPanel` rather than a second copy of the same
 * mechanism, so the dialog and an inline panel cannot drift. There is no form
 * and no submit: the dropzone starts the work, and the hook inside the panel
 * owns everything after that. Closing mid-upload aborts, and the reservation
 * lapses on its own.
 */

export interface AttachmentUploadNiceDialogProps {
  organizationId: number;
  subject: SubjectRef;
  kind?: AttachmentKind;
  title?: string;
}

export const AttachmentUploadNiceDialog = NiceModal.create(
  ({ organizationId, subject, kind = "FILE", title }: AttachmentUploadNiceDialogProps) => {
    const modal = useModal();
    const t = useTranslations("platform");

    return (
      <BaseDialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) {
            modal.resolve();
            modal.hide();
          }
        }}
        title={title ?? t("attachments.title")}
        description={t("attachments.dialogHint")}
        footer={
          <Button
            variant="outline"
            onClick={() => {
              modal.resolve();
              modal.hide();
            }}
          >
            {t("attachments.done")}
          </Button>
        }
      >
        <AttachmentsPanel organizationId={organizationId} subject={subject} kind={kind} />
      </BaseDialog>
    );
  }
);

/** Open it and wait for the person to close it. */
export function uploadAttachment(props: AttachmentUploadNiceDialogProps): Promise<void> {
  return NiceModal.show(AttachmentUploadNiceDialog, props) as Promise<void>;
}
