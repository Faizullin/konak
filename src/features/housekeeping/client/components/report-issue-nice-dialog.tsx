"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldError, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ISSUE_SEVERITY_VALUES,
  IssueSeverity,
  reportIssueFormSchema,
  takesRoomOutOfOrder,
  type ReportIssueFormInput,
} from "@/features/housekeeping";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { useEnumLabels } from "@/lib/labels";
import { trpc } from "@/utils/trpc";

/**
 * A fault, reported from the floor.
 *
 * The one thing this screen does that costs the hotel a sale, so the severity
 * says so out loud before it is sent: a blocking fault takes the room out of
 * order, and out of order is what removes it from what can be sold.
 */

export interface ReportIssueNiceDialogProps {
  propertyId: number;
  roomId: number;
  roomNumber: string;
}

const EMPTY: ReportIssueFormInput = {
  title: "",
  description: "",
  severity: IssueSeverity.MEDIUM,
};

export const ReportIssueNiceDialog = NiceModal.create(
  ({ propertyId, roomId, roomNumber }: ReportIssueNiceDialogProps) => {
    const t = useTranslations("housekeeping");
    const severityLabels = useEnumLabels("issueSeverity", ISSUE_SEVERITY_VALUES);
    const { handleFormError } = useErrorHandlers();
    const modal = useModal();
    const utils = trpc.useUtils();

    const resolver = useZodResolver<ReportIssueFormInput>(reportIssueFormSchema);
    const form = useForm<ReportIssueFormInput>({ resolver, defaultValues: EMPTY });

    // Re-seed on open, so a fault reported in one room never leaks into the next.
    useEffect(() => {
      if (modal.visible) form.reset(EMPTY);
    }, [modal.visible, form]);

    const severity = form.watch("severity");

    const report = trpc.housekeeping.reportIssue.useMutation({
      onSuccess: () => {
        toast.success(t("issue.reported"));
        utils.housekeeping.board.invalidate();
        // A blocking fault changed what can be sold, so the desk's grid and its
        // free counts cannot keep the old answer.
        utils.reservation.grid.invalidate();
        utils.reservation.availability.invalidate();
        modal.hide();
      },
      onError: (error) => handleFormError(form, error),
    });

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={`${t("issue.title")} — ${roomNumber}`}
        description={t("issue.description")}
        onSubmit={form.handleSubmit((values) => report.mutate({ ...values, propertyId, roomId }))}
        error={form.formState.errors.root?.message}
        isLoading={report.isPending}
        submitText={t("issue.submit")}
      >
        <FieldGroup>
          <Controller
            control={form.control}
            name="title"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="title">{t("issue.what")}</FieldLabel>
                <Input id="title" {...field} disabled={report.isPending} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="severity"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="severity">{t("issue.severity")}</FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={report.isPending}
                >
                  <SelectTrigger id="severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_SEVERITY_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {severityLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Said before it is sent, not discovered afterwards. */}
                {takesRoomOutOfOrder(severity) && (
                  <p className="text-destructive text-xs">{t("issue.blockingWarning")}</p>
                )}
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="description">{t("issue.detail")}</FieldLabel>
                <Textarea
                  id="description"
                  rows={3}
                  {...field}
                  value={field.value ?? ""}
                  disabled={report.isPending}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </FormDialog>
    );
  }
);
