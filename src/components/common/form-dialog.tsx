"use client";

import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";
import { BaseDialog } from "./base-dialog";

/**
 * `BaseDialog` plus what every dialog with a form repeats: the `<form>`, the
 * form-level error, and a Cancel/Submit footer that spins on `isLoading`.
 *
 * Always pass `form.formState.errors.root?.message` as `error` —
 * `handleFormError` puts what it could not place under a field there, and an
 * unrendered root error fails silently. See ui-patterns.md § Dialogs.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  error,
  isLoading = false,
  submitText = "Save",
  cancelText = "Cancel",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  /** Form-level message, usually `form.formState.errors.root?.message`. */
  error?: string;
  isLoading?: boolean;
  submitText?: ReactNode;
  cancelText?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className={className}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />

        {children}

        {/* Inside the form: the submit button must descend from what it submits. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <LoaderIcon className="size-4 animate-spin" />}
            {submitText}
          </Button>
        </div>
      </form>
    </BaseDialog>
  );
}
