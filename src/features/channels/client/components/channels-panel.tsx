"use client";

import { useEnumLabels } from "@/lib/labels";
import { useFormatter, useTranslations } from "next-intl";
import NiceModal from "@ebay/nice-modal-react";
import { Pencil, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useErrorHandlers } from "@/lib/errors";
import { CHANNEL_STATUS_VALUES, ChannelStatus } from "@/features/channels";
import { OrgRole } from "@/features/organizations";
import { canManageProperties } from "@/features/properties";
import { trpc } from "@/utils/trpc";
import { ChannelConnectionFormNiceDialog } from "./channel-connection-form-nice-dialog";
import { ChannelMappingFormNiceDialog } from "./channel-mapping-form-nice-dialog";

/** Property channel connections, credential status, and room type mappings. */

const STATUS_BADGE: Record<ChannelStatus, "default" | "secondary" | "destructive"> = {
  [ChannelStatus.ACTIVE]: "default",
  [ChannelStatus.PAUSED]: "secondary",
  [ChannelStatus.ERROR]: "destructive",
};

export function ChannelsPanel({
  propertyId,
  organizationId,
}: {
  propertyId: number;
  organizationId: number;
}) {
  const statusLabels = useEnumLabels("channelStatus", CHANNEL_STATUS_VALUES);
  const t = useTranslations("channels");
  const format = useFormatter();
  const { handleError } = useErrorHandlers();
  const utils = trpc.useUtils();

  const { data: organization } = trpc.organization.getById.useQuery({ id: organizationId });
  const role = (organization?.currentUserRole as OrgRole | undefined) ?? null;
  const mayEdit = role !== null && canManageProperties(role);

  const { data, isLoading } = trpc.channel.list.useQuery({ propertyId });
  const { data: plans } = trpc.rate.listPlans.useQuery({ propertyId, includeArchived: true });

  // `channelCode` and `status` are columns of strings rather than Postgres
  // enums, so the literal keys are asserted here rather than known.
  const channelName = (code: string) => t(`codes.${code}` as Parameters<typeof t>[0]);
  const statusOf = (status: string) => status as ChannelStatus;

  const setStatus = trpc.channel.setStatus.useMutation({
    onSuccess: (connection) => {
      toast.success(
        connection.status === ChannelStatus.ACTIVE ? t("panel.resumed") : t("panel.paused")
      );
      utils.channel.list.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const unmap = trpc.channel.unmap.useMutation({
    onSuccess: () => {
      toast.success(t("panel.unmapDone"));
      utils.channel.list.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const planName = (ratePlanId: number | null) =>
    ratePlanId === null
      ? t("panel.everyRatePlan")
      : (plans?.find((plan) => plan.id === ratePlanId)?.name ?? "—");

  const pause = async (id: number, channel: string) => {
    if (
      !(await confirm({
        title: t("panel.pauseTitle", { name: channel }),
        description: t("panel.pauseDescription"),
        confirmLabel: t("panel.pauseConfirm"),
      }))
    ) {
      return;
    }
    setStatus.mutate({ propertyId, id, status: ChannelStatus.PAUSED });
  };

  const drop = async (id: number, name: string) => {
    if (
      !(await confirm({
        title: t("panel.unmapTitle", { name }),
        description: t("panel.unmapDescription"),
        confirmLabel: t("panel.unmapConfirm"),
        destructive: true,
      }))
    ) {
      return;
    }
    unmap.mutate({ propertyId, id });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{t("panel.heading")}</h2>
        <span className="text-muted-foreground text-sm">{t("panel.subtitle")}</span>
        {mayEdit && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => NiceModal.show(ChannelConnectionFormNiceDialog, { propertyId })}
          >
            <Plus />
            {t("panel.connect")}
          </Button>
        )}
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("panel.empty")}</p>
      ) : (
        <div className="space-y-4">
          {(data ?? []).map((connection) => {
            const channel = channelName(connection.channelCode);
            const status = statusOf(connection.status);
            const active = status === ChannelStatus.ACTIVE;

            return (
              <div key={connection.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{channel}</span>
                  <Badge variant={STATUS_BADGE[status]}>
                    {statusLabels[status] ?? connection.status}
                  </Badge>
                  <Badge variant={connection.credentialsPresent ? "outline" : "destructive"}>
                    {connection.credentialsPresent
                      ? t("panel.credentialsOk")
                      : t("panel.credentialsMissing")}
                  </Badge>

                  {mayEdit && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          active
                            ? pause(connection.id, channel)
                            : setStatus.mutate({
                                propertyId,
                                id: connection.id,
                                status: ChannelStatus.ACTIVE,
                              })
                        }
                      >
                        {active ? t("panel.pause") : t("panel.resume")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("panel.editLabel", { name: channel })}
                        onClick={() =>
                          NiceModal.show(ChannelConnectionFormNiceDialog, {
                            propertyId,
                            connectionId: connection.id,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                    </div>
                  )}
                </div>

                <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-1.5">
                    <dt>{t("panel.via")}</dt>
                    <dd className="text-foreground">{connection.provider}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>{t("panel.credentials")}</dt>
                    <dd className="text-foreground font-mono text-xs">
                      {connection.credentialsRef ?? "—"}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>{t("panel.lastSync")}</dt>
                    <dd className="text-foreground">
                      {connection.lastSyncedAt
                        ? format.dateTime(connection.lastSyncedAt, { dateStyle: "medium" })
                        : t("panel.never")}
                    </dd>
                  </div>
                </dl>

                {/* The channel's own words, not ours — a rejection reads as the
                    vendor wrote it, because that is what makes it searchable in
                    their support ticket. */}
                {connection.lastError && (
                  <p className="text-destructive text-sm">{connection.lastError}</p>
                )}

                {mayEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      NiceModal.show(ChannelMappingFormNiceDialog, {
                        propertyId,
                        connectionId: connection.id,
                      })
                    }
                  >
                    <Plus />
                    {t("panel.mapType")}
                  </Button>
                )}

                {connection.mappings.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("panel.mappingsEmpty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("panel.roomType")}</TableHead>
                        <TableHead>{t("panel.ratePlan")}</TableHead>
                        <TableHead>{t("panel.theirRoomType")}</TableHead>
                        <TableHead>{t("panel.theirRatePlan")}</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connection.mappings.map((mapping) => (
                        <TableRow
                          key={mapping.id}
                          className={mapping.isActive ? undefined : "opacity-60"}
                        >
                          <TableCell className="font-medium">
                            {mapping.roomType.name}
                            {!mapping.isActive && (
                              <Badge variant="outline" className="ml-2">
                                {t("panel.unmapped")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{planName(mapping.ratePlanId)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {mapping.externalRoomTypeId}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {mapping.externalRatePlanId ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {mayEdit && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("panel.editMappingLabel", {
                                    name: mapping.roomType.name,
                                  })}
                                  onClick={() =>
                                    NiceModal.show(ChannelMappingFormNiceDialog, {
                                      propertyId,
                                      connectionId: connection.id,
                                      mapping: {
                                        roomTypeId: mapping.roomTypeId,
                                        ratePlanId: mapping.ratePlanId,
                                        externalRoomTypeId: mapping.externalRoomTypeId,
                                        externalRatePlanId: mapping.externalRatePlanId,
                                      },
                                    })
                                  }
                                >
                                  <Pencil />
                                </Button>
                              )}
                              {mayEdit && mapping.isActive && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("panel.unmapLabel", {
                                    name: mapping.roomType.name,
                                  })}
                                  disabled={unmap.isPending}
                                  onClick={() => drop(mapping.id, mapping.roomType.name)}
                                >
                                  <Unlink />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
