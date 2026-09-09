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
import { isRoomSellable, ROOM_STATUS_LABELS, type RoomStatus } from "@/features/properties";
import { walkInFormSchema, type WalkInFormInput } from "@/features/reservations";
import { handleFormError } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * A guest at the desk: booked, given a room and checked in, in one action.
 *
 * The dates are not fields. A walk-in arrives on the property's own day, which
 * the server knows and the browser does not, so the form asks how many nights
 * and the server decides which ones. Validation is `walkInFormSchema` from
 * `model/` — the same object the router validates, minus the property the
 * route already carries.
 */

export interface WalkInFormNiceDialogProps {
  propertyId: number;
}

/** Nothing here carries a schema `.default()`, so these are the only defaults. */
const EMPTY: WalkInFormInput = {
  roomTypeId: 0,
  roomId: 0,
  nights: 1,
  adults: 1,
  children: 0,
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

export const WalkInFormNiceDialog = NiceModal.create(
  ({ propertyId }: WalkInFormNiceDialogProps) => {
    const modal = useModal();
    const utils = trpc.useUtils();

    const form = useForm<WalkInFormInput>({
      resolver: zodResolver(walkInFormSchema),
      defaultValues: EMPTY,
    });

    // Re-seed on open, so a cancelled walk-in never leaks into the next guest.
    useEffect(() => {
      if (modal.visible) form.reset(EMPTY);
    }, [modal.visible, form]);

    const roomTypeId = form.watch("roomTypeId");

    const { data: roomTypes } = trpc.property.listRoomTypes.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: rooms } = trpc.property.listRooms.useQuery(
      { propertyId, roomTypeId: roomTypeId || undefined },
      { enabled: modal.visible && roomTypeId > 0 }
    );

    const walkIn = trpc.reservation.walkIn.useMutation({
      onSuccess: (reservation) => {
        toast.success(`Checked in — ${reservation.reference}`);
        // Both surfaces read the same booking; neither may keep the old answer.
        utils.reservation.grid.invalidate();
        utils.reservation.day.invalidate();
        modal.hide();
      },
      onError: (error) => handleFormError(form, error),
    });

    // Sellable only: an out-of-order room is refused by the server, and offering
    // it is asking someone to find that out the hard way.
    const sellable = (rooms ?? []).filter((room) => isRoomSellable(room.status));

    const typeItems = Object.fromEntries(
      (roomTypes ?? [])
        .filter((type) => !type.archivedAt)
        .map((type) => [String(type.id), type.name])
    );
    const roomItems = Object.fromEntries(
      sellable.map((room) => [
        String(room.id),
        `${room.number} · ${ROOM_STATUS_LABELS[room.status as RoomStatus] ?? room.status}`,
      ])
    );

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title="Walk-in"
        description="Books tonight, assigns the room and checks the guest in."
        onSubmit={form.handleSubmit((values) => walkIn.mutate({ ...values, propertyId }))}
        error={form.formState.errors.root?.message}
        isLoading={walkIn.isPending}
        submitText="Book and check in"
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="firstName"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="firstName">First name</FieldLabel>
                  <Input id="firstName" {...field} disabled={walkIn.isPending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="lastName"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                  <Input id="lastName" {...field} disabled={walkIn.isPending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    {...field}
                    value={field.value ?? ""}
                    disabled={walkIn.isPending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="phone"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input
                    id="phone"
                    {...field}
                    value={field.value ?? ""}
                    disabled={walkIn.isPending}
                  />
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
                  items={typeItems}
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => {
                    field.onChange(Number(value));
                    // The room belongs to the old type; keeping it would submit a
                    // pair the server refuses.
                    form.setValue("roomId", 0);
                  }}
                  disabled={walkIn.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roomTypes ?? [])
                      .filter((type) => !type.archivedAt)
                      .map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          {type.name} · sleeps {type.maxOccupancy}
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
            name="roomId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>Room</FieldLabel>
                <Select
                  items={roomItems}
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => field.onChange(Number(value))}
                  disabled={walkIn.isPending || roomTypeId < 1}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={roomTypeId < 1 ? "Choose a type first" : "Choose a room"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sellable.map((room) => (
                      <SelectItem key={room.id} value={String(room.id)}>
                        {room.number} ·{" "}
                        {ROOM_STATUS_LABELS[room.status as RoomStatus] ?? room.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
                {roomTypeId > 0 && sellable.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    No sellable room of that type. Another type, or free one first.
                  </p>
                )}
              </Field>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            {(["nights", "adults", "children"] as const).map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor={name} className="capitalize">
                      {name}
                    </FieldLabel>
                    <Input
                      id={name}
                      type="number"
                      min={name === "children" ? 0 : 1}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      disabled={walkIn.isPending}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ))}
          </div>
        </FieldGroup>
      </FormDialog>
    );
  }
);
