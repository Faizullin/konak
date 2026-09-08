"use client";

import { cn } from "@/lib/utils";

/**
 * The form-level counterpart to `FieldError`, for the `root` error
 * `handleFormError` sets. Omit it and those failures are invisible.
 */
export function FormError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      data-slot="form-error"
      className={cn(
        "border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm",
        className
      )}
    >
      {message}
    </div>
  );
}
