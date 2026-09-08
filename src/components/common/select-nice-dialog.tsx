"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useState, type ReactNode } from "react";
import { ComboBox } from "@/components/common/combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The confirmation dialog's sibling: ask *which one*, not *are you sure*.
 *
 * Same shape — a function that returns a promise — over the same paginated
 * `searchFn` contract [ComboBox] already speaks, so "pick a member", "pick an
 * organization" and "pick a document" are one component rather than three
 * near-identical dialogs. Resolves `null` when dismissed.
 */

export interface SelectNiceDialogProps<T extends object> {
  title: ReactNode;
  description?: ReactNode;
  /** The field that identifies an option, e.g. `"id"`. */
  valueKey: keyof T;
  renderText: (value: T) => string;
  searchFn: (search: string, offset: number, size: number) => Promise<T[]>;
  placeholder?: string;
  confirmLabel?: string;
  initialValue?: T | null;
}

function SelectNiceDialogImpl<T extends object>({
  title,
  description,
  valueKey,
  renderText,
  searchFn,
  placeholder = "Select…",
  confirmLabel = "Select",
  initialValue = null,
}: SelectNiceDialogProps<T>) {
  const modal = useModal();
  const [selected, setSelected] = useState<T | null>(initialValue);

  const close = (value: T | null) => {
    modal.resolve(value);
    modal.hide();
  };

  return (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && close(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <ComboBox<T>
          title={placeholder}
          valueKey={valueKey}
          renderText={renderText}
          searchFn={searchFn}
          value={selected}
          onChange={setSelected}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => close(selected)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// `NiceModal.create` erases the generic, so the cast is reinstated by
// `selectOne` below — callers keep full inference, the registry stays untyped.
export const SelectNiceDialog = NiceModal.create(
  SelectNiceDialogImpl as unknown as (props: SelectNiceDialogProps<object>) => ReactNode
);

/** Ask which one, and wait. Resolves `null` when dismissed. */
export function selectOne<T extends object>(props: SelectNiceDialogProps<T>): Promise<T | null> {
  return NiceModal.show(
    SelectNiceDialog,
    props as unknown as SelectNiceDialogProps<object>
  ) as Promise<T | null>;
}
