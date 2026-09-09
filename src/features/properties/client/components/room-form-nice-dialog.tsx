"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROOM_STATUS_LABELS,
  roomFormSchema,
  RoomStatus,
  type RoomFormInput,
} from "@/features/properties";
import { handleFormError } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * Add or edit one room — the physical door, and the grid's vertical axis.
 *
 * The type is a field rather than a fixed prop: moving a room between types is
 * an ordinary correction, and the server refuses it only once the room is sold.
 */

export interface RoomFormNiceDialogProps {
  propertyId: number;
  /** Absent creates; present edits that room. */
  roomId?: number;
  /** Preselected when adding from inside a type's section. */
  roomTypeId?: number;
}

export const RoomFormNiceDialog = NiceModal.create(
  ({ propertyId, roomId, roomTypeId }: RoomFormNiceDialogProps) => {
    const isEdit = roomId !== undefined;
    const modal = useModal();
    const utils = trpc.useUtils();

    const empty: RoomFormInput = {
      roomTypeId: roomTypeId ?? 0,
      number: "",
      floor: "",
      status: RoomStatus.CLEAN,
      notes: "",
    };

    const form = useForm<RoomFormInput>({
      resolver: zodResolver(roomFormSchema),
      defaultValues: empty,
    });

    const { data: types } = trpc.property.listRoomTypes.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: rooms } = trpc.property.listRooms.useQuery(
      { propertyId, includeArchived: true },
      { enabled: modal.visible && isEdit }
    );
    const existing = rooms?.find((room) => room.id === roomId);

    useEffect(() => {
      if (!modal.visible) return;
      form.reset(
        existing
          ? {
              roomTypeId: existing.roomTypeId,
              number: existing.number,
              floor: existing.floor ?? "",
              status: existing.status as RoomStatus,
              notes: "",
            }
          : empty
      );
      // `empty` is rebuilt each render; the dialog's identity is what matters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modal.visible, existing, form]);

    const done = (verb: string) => {
      toast.success(`Room ${verb}`);
      utils.property.listRooms.invalidate();
      utils.reservation.grid.invalidate();
      modal.hide();
    };

    const create = trpc.property.createRoom.useMutation({
      onSuccess: () => done("added"),
      onError: (error) => handleFormError(form, error),
    });
    const update = trpc.property.updateRoom.useMutation({
      onSuccess: () => done("saved"),
      onError: (error) => handleFormError(form, error),
    });
    const pending = create.isPending || update.isPending;

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? "Edit room" : "New room"}
        onSubmit={form.handleSubmit((values) =>
          isEdit
            ? update.mutate({ ...values, propertyId, id: roomId })
            : create.mutate({ ...values, propertyId })
        )}
        error={form.formState.errors.root?.message}
        isLoading={pending}
        submitText={isEdit ? "Save" : "Add room"}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="number"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="number">Number</FieldLabel>
                  <Input id="number" {...field} disabled={pending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="floor"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="floor">Floor</FieldLabel>
                  <Input id="floor" {...field} value={field.value ?? ""} disabled={pending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>

          <Controller
            control={form.control}
            name="roomTypeId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>Room type</FieldLabel>
                <Select
                  items={Object.fromEntries((types ?? []).map((t) => [String(t.id), t.name]))}
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => field.onChange(Number(value))}
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(types ?? []).map((type) => (
                      <SelectItem key={type.id} value={String(type.id)}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="status"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>Housekeeping</FieldLabel>
                <Select
                  items={ROOM_STATUS_LABELS}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROOM_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </FormDialog>
    );
  }
);
