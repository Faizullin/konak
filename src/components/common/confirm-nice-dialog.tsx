"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One confirmation dialog for the whole app, reached as a function.
 *
 * Every destructive action needs the same three things — a question, a way
 * out, and the answer — and none of them belong in the calling component's
 * state. `confirm()` returns a promise, so an event handler reads top to
 * bottom:
 *
 * ```ts
 * if (!(await confirm({ title: "Delete organization?", destructive: true }))) return;
 * deleteMutation.mutate({ id });
 * ```
 */

export interface ConfirmNiceDialogProps {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive colour. */
  destructive?: boolean;
}

export const ConfirmNiceDialog = NiceModal.create(
  ({
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
  }: ConfirmNiceDialogProps) => {
    const modal = useModal();

    const close = (answer: boolean) => {
      modal.resolve(answer);
      modal.hide();
    };

    return (
      <AlertDialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={cn(destructive && buttonVariants({ variant: "destructive" }))}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

/** Ask, and wait for the answer. Resolves `false` on cancel or dismiss. */
export function confirm(props: ConfirmNiceDialogProps): Promise<boolean> {
  return NiceModal.show(ConfirmNiceDialog, props) as Promise<boolean>;
}
