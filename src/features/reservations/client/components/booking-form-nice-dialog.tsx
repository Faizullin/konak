"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bookingFormSchema,
  fromDayInput,
  shiftStayDays,
  toDayInput,
  todayAt,
  type BookingFormInput,
} from "@/features/reservations";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

/**
 * A booking for a date that is not tonight.
 *
 * The walk-in beside it books, assigns and checks in at once, which is the
 * right shape for a guest already standing at the desk and the wrong one for
 * every other booking — it cannot sell next month at all. This asks the
 * question the other way round: pick the nights, see what is actually free,
 * then take it.
 *
 * The room is deliberately not a field. A booking made for March has a type and
 * no door; choosing one is `assignRoom`, later, on the grid.
 */

export interface BookingFormNiceDialogProps {
  propertyId: number;
  timezone: string;
}

/** A hold key per dialog opening, so two desks searching do not share a claim. */
const newHoldKey = () => `desk-${crypto.randomUUID()}`;

export const BookingFormNiceDialog = NiceModal.create(
  ({ propertyId, timezone }: BookingFormNiceDialogProps) => {
    const t = useTranslations("reservations");
    const locale = useLocale();
    const { handleFormError } = useErrorHandlers();
    const modal = useModal();
    const utils = trpc.useUtils();

    const today = useMemo(() => todayAt(timezone), [timezone]);
    const empty = useMemo<BookingFormInput>(
      () => ({
        roomTypeId: 0,
        checkIn: shiftStayDays(today, 1),
        checkOut: shiftStayDays(today, 2),
        adults: 1,
        children: 0,
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
      }),
      [today]
    );

    const resolver = useZodResolver<BookingFormInput>(bookingFormSchema);
    const form = useForm<BookingFormInput>({ resolver, defaultValues: empty });

    /**
     * The claim, taken when a type is chosen rather than when the search runs.
     *
     * A search is a question and a hold is a promise. Holding on every keystroke
     * would take the last room off sale for anyone who merely looked at it.
     */
    const [holdKey, setHoldKey] = useState<string | null>(null);

    const checkIn = form.watch("checkIn");
    const checkOut = form.watch("checkOut");
    const roomTypeId = form.watch("roomTypeId");
    const ratePlanId = form.watch("ratePlanId");
    const adults = form.watch("adults");
    const children = form.watch("children");

    const hold = trpc.reservation.hold.useMutation();
    const release = trpc.reservation.releaseHold.useMutation();

    // Re-seed on open, so an abandoned search never leaks into the next one.
    useEffect(() => {
      if (modal.visible) {
        form.reset(empty);
        setHoldKey(null);
      }
    }, [modal.visible, form, empty]);

    const searchable = checkIn instanceof Date && checkOut instanceof Date && checkOut > checkIn;

    const { data: roomTypes } = trpc.property.listRoomTypes.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: plans } = trpc.rate.listPlans.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: nights, isFetching } = trpc.reservation.availability.useQuery(
      { propertyId, from: checkIn, to: checkOut },
      { enabled: modal.visible && searchable }
    );

    const { data: quote } = trpc.rate.quote.useQuery(
      {
        propertyId,
        roomTypeId,
        ratePlanId: ratePlanId ?? 0,
        checkIn,
        checkOut,
        adults,
        children,
      },
      { enabled: modal.visible && searchable && roomTypeId > 0 && Boolean(ratePlanId) }
    );

    /**
     * What is free is the *worst* night, not the first.
     *
     * A type with three rooms free on four nights and none on the fifth cannot
     * be sold for the stay, and showing the three would be a promise the
     * booking then breaks.
     */
    const freeByType = useMemo(() => {
      const worst = new Map<number, number>();
      for (const night of nights ?? []) {
        const seen = worst.get(night.roomTypeId);
        worst.set(
          night.roomTypeId,
          seen === undefined ? night.available : Math.min(seen, night.available)
        );
      }
      return worst;
    }, [nights]);

    const create = trpc.reservation.create.useMutation({
      onSuccess: (reservation) => {
        toast.success(`${t("booking.booked")} — ${reservation.reference}`);
        utils.reservation.grid.invalidate();
        utils.reservation.day.invalidate();
        utils.reservation.list.invalidate();
        modal.hide();
      },
      onError: (error) => handleFormError(form, error),
    });

    /** Choosing a type is the moment the search becomes a booking. */
    const choose = (id: number) => {
      form.setValue("roomTypeId", id);
      if (!searchable) return;

      const key = holdKey ?? newHoldKey();
      setHoldKey(key);
      // Re-using the key moves the existing hold rather than taking a second
      // room, so changing your mind about the type costs nothing.
      hold.mutate({
        propertyId,
        roomTypeId: id,
        checkIn,
        checkOut,
        quantity: 1,
        holdKey: key,
        minutes: 15,
      });
    };

    const close = () => {
      // An abandoned search must not keep a room off sale for fifteen minutes.
      if (holdKey) release.mutate({ propertyId, holdKey });
      modal.hide();
    };

    const dateField = (name: "checkIn" | "checkOut", label: string) => (
      <Controller
        control={form.control}
        name={name}
        render={({ field, fieldState }) => (
          <Field data-invalid={!!fieldState.error}>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <Input
              id={name}
              type="date"
              value={field.value instanceof Date ? toDayInput(field.value) : ""}
              onChange={(event) => field.onChange(fromDayInput(event.target.value) ?? undefined)}
              disabled={create.isPending}
            />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
    );

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && close()}
        title={t("booking.title")}
        description={t("booking.description")}
        onSubmit={form.handleSubmit((values) =>
          create.mutate({
            ...values,
            propertyId,
            source: "DIRECT",
            holdKey: holdKey ?? undefined,
          })
        )}
        error={form.formState.errors.root?.message}
        isLoading={create.isPending}
        submitText={t("booking.submit")}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            {dateField("checkIn", t("booking.checkIn"))}
            {dateField("checkOut", t("booking.checkOut"))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={form.control} name="adults" label={t("booking.adults")} min={1} />
            <NumberField
              control={form.control}
              name="children"
              label={t("booking.children")}
              min={0}
            />
          </div>

          <Field>
            <FieldLabel>{t("booking.whatIsFree")}</FieldLabel>
            {!searchable ? (
              <p className="text-muted-foreground text-sm">{t("booking.pickDates")}</p>
            ) : isFetching && !nights ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <ul className="divide-y rounded border">
                {(roomTypes ?? [])
                  .filter((type) => !type.archivedAt)
                  .map((type) => {
                    const free = freeByType.get(type.id) ?? 0;
                    return (
                      <li key={type.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-sm font-medium">{type.name}</span>
                        <span
                          className={cn(
                            "text-xs",
                            free === 0 ? "text-destructive font-medium" : "text-muted-foreground"
                          )}
                        >
                          {t("booking.freeCount", { free })}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant={roomTypeId === type.id ? "default" : "outline"}
                          className="ml-auto"
                          disabled={free === 0 || hold.isPending || create.isPending}
                          onClick={() => choose(type.id)}
                        >
                          {roomTypeId === type.id ? t("booking.held") : t("booking.choose")}
                        </Button>
                      </li>
                    );
                  })}
              </ul>
            )}
            <FieldError errors={[form.formState.errors.roomTypeId]} />
          </Field>

          <Controller
            control={form.control}
            name="ratePlanId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="ratePlanId">{t("booking.ratePlan")}</FieldLabel>
                <Select
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => field.onChange(value ? Number(value) : undefined)}
                  disabled={create.isPending}
                >
                  <SelectTrigger id="ratePlanId">
                    <SelectValue placeholder={t("booking.noPlan")}>
                      {(v: string) => plans?.find((p) => String(p.id) === v)?.name ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(plans ?? [])
                      .filter((plan) => !plan.archivedAt)
                      .map((plan) => (
                        <SelectItem key={plan.id} value={String(plan.id)}>
                          {plan.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {/* The quote is the server's, not arithmetic done here: the
                    total shown has to be the total written. */}
                <p className="text-muted-foreground text-sm">
                  {quote?.totalMinor != null
                    ? formatMoney(quote.totalMinor, quote.currencyCode, locale)
                    : t("booking.noPriceYet")}
                </p>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="firstName" label={t("booking.firstName")} />
            <TextField control={form.control} name="lastName" label={t("booking.lastName")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="email"
              label={t("booking.email")}
              type="email"
            />
            <TextField control={form.control} name="phone" label={t("booking.phone")} />
          </div>
        </FieldGroup>
      </FormDialog>
    );
  }
);

function TextField({
  control,
  name,
  label,
  type,
}: {
  control: ReturnType<typeof useForm<BookingFormInput>>["control"];
  name: "firstName" | "lastName" | "email" | "phone";
  label: string;
  type?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input id={name} type={type} {...field} value={field.value ?? ""} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function NumberField({
  control,
  name,
  label,
  min,
}: {
  control: ReturnType<typeof useForm<BookingFormInput>>["control"];
  name: "adults" | "children";
  label: string;
  min: number;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            min={min}
            value={field.value ?? min}
            onChange={(event) => field.onChange(Number(event.target.value))}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
