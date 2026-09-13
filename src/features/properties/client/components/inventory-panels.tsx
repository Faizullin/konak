"use client";

import { useEnumLabels } from "@/lib/labels";
import { useTranslations } from "next-intl";
import NiceModal from "@ebay/nice-modal-react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useState } from "react";
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
import { cn } from "@/lib/utils";
import { OrgRole } from "@/features/organizations";
import {
  canArchiveRoomTypes,
  canManageRooms,
  canManageRoomTypes,
  ROOM_SALE_STATE_VALUES,
  ROOM_STATUS_VALUES,
  RoomSaleState,
  RoomStatus,
  type RoomSaleState as RoomSaleStateValue,
  type RoomStatus as RoomStatusValue,
} from "@/features/properties";
import { trpc } from "@/utils/trpc";
import { RoomFormNiceDialog } from "./room-form-nice-dialog";
import { RoomTypeFormNiceDialog } from "./room-type-form-nice-dialog";

/**
 * Setting a property up: the types a guest books, and the rooms behind them.
 *
 * A plain `Table` rather than the `DataTable` stack — a hotel has a handful of
 * types and tens of rooms, and URL state, a toolbar and pagination would be
 * machinery for a list that fits on one screen. See ui-patterns.md § Naming.
 *
 * The buttons hide on role as a courtesy; the router re-checks every one.
 */

function useOrgRole(organizationId: number): OrgRole | null {
  const { data } = trpc.organization.getById.useQuery({ id: organizationId });
  return (data?.currentUserRole as OrgRole | undefined) ?? null;
}

function ArchiveToggle({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (next: boolean) => void;
}) {
  const t = useTranslations("properties");

  return (
    <Button variant="ghost" size="sm" onClick={() => onChange(!archived)}>
      {archived ? t("archive.hide") : t("archive.show")}
    </Button>
  );
}

export function RoomTypesPanel({
  propertyId,
  organizationId,
}: {
  propertyId: number;
  organizationId: number;
}) {
  const t = useTranslations("properties");
  const { handleError } = useErrorHandlers();
  const [includeArchived, setIncludeArchived] = useState(false);
  const role = useOrgRole(organizationId);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.property.listRoomTypes.useQuery({ propertyId, includeArchived });

  const archive = trpc.property.archiveRoomType.useMutation({
    onSuccess: (type) => {
      toast.success(type.archivedAt ? t("types.archived") : t("types.restored"));
      utils.property.listRoomTypes.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const mayEdit = role !== null && canManageRoomTypes(role);
  const mayArchive = role !== null && canArchiveRoomTypes(role);

  const toggleArchive = async (id: number, name: string, archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: t("types.archiveTitle", { name }),
        description: t("types.archiveDescription"),
        confirmLabel: t("archive.confirm"),
      }))
    ) {
      return;
    }
    archive.mutate({ propertyId, id, archived });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{t("types.heading")}</h2>
        <span className="text-muted-foreground text-sm">{t("types.subtitle")}</span>
        <div className="ml-auto flex items-center gap-2">
          <ArchiveToggle archived={includeArchived} onChange={setIncludeArchived} />
          {mayEdit && (
            <Button
              size="sm"
              onClick={() => NiceModal.show(RoomTypeFormNiceDialog, { propertyId })}
            >
              <Plus />
              {t("types.new")}
            </Button>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("types.name")}</TableHead>
              <TableHead>{t("types.code")}</TableHead>
              <TableHead>{t("types.sleeps")}</TableHead>
              <TableHead>{t("types.base")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t("types.empty")}
                </TableCell>
              </TableRow>
            )}
            {(data ?? []).map((type) => (
              <TableRow key={type.id} className={type.archivedAt ? "opacity-60" : undefined}>
                <TableCell className="font-medium">
                  {type.name}
                  {type.archivedAt && (
                    <Badge variant="outline" className="ml-2">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{type.code}</TableCell>
                <TableCell>{type.maxOccupancy}</TableCell>
                <TableCell>{type.baseOccupancy}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mayEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("types.editLabel", { name: type.name })}
                        onClick={() =>
                          NiceModal.show(RoomTypeFormNiceDialog, {
                            propertyId,
                            roomTypeId: type.id,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                    )}
                    {mayArchive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          type.archivedAt ? `Restore ${type.name}` : `Archive ${type.name}`
                        }
                        disabled={archive.isPending}
                        onClick={() => toggleArchive(type.id, type.name, !type.archivedAt)}
                      >
                        {type.archivedAt ? <ArchiveRestore /> : <Archive />}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function RoomsPanel({
  propertyId,
  organizationId,
}: {
  propertyId: number;
  organizationId: number;
}) {
  const labels = useEnumLabels("roomStatus", ROOM_STATUS_VALUES);
  const saleLabels = useEnumLabels("roomSaleState", ROOM_SALE_STATE_VALUES);
  const t = useTranslations("properties");
  const { handleError } = useErrorHandlers();
  const [includeArchived, setIncludeArchived] = useState(false);
  const role = useOrgRole(organizationId);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.property.listRooms.useQuery({ propertyId, includeArchived });
  const { data: types } = trpc.property.listRoomTypes.useQuery({
    propertyId,
    includeArchived: true,
  });

  const archive = trpc.property.archiveRoom.useMutation({
    onSuccess: (room) => {
      toast.success(room.archivedAt ? t("rooms.archived") : t("rooms.restored"));
      utils.property.listRooms.invalidate();
      utils.reservation.grid.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const mayEdit = role !== null && canManageRooms(role);
  const typeName = (id: number) => types?.find((type) => type.id === id)?.name ?? "—";

  const toggleArchive = async (id: number, number: string, archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: t("rooms.archiveTitle", { number }),
        description: t("rooms.archiveDescription"),
        confirmLabel: t("archive.confirm"),
      }))
    ) {
      return;
    }
    archive.mutate({ propertyId, id, archived });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{t("rooms.heading")}</h2>
        <span className="text-muted-foreground text-sm">{t("rooms.subtitle")}</span>
        <div className="ml-auto flex items-center gap-2">
          <ArchiveToggle archived={includeArchived} onChange={setIncludeArchived} />
          {mayEdit && (
            <Button size="sm" onClick={() => NiceModal.show(RoomFormNiceDialog, { propertyId })}>
              <Plus />
              {t("rooms.new")}
            </Button>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rooms.number")}</TableHead>
              <TableHead>{t("rooms.type")}</TableHead>
              <TableHead>{t("rooms.floor")}</TableHead>
              {/* Two different questions about one room, and a screen that
                  answered only the second was answering the wrong half: this
                  one is *can I sell it tonight*, that one is *is it clean*. */}
              <TableHead>{t("rooms.tonight")}</TableHead>
              <TableHead>{t("rooms.housekeeping")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t("rooms.empty")}
                </TableCell>
              </TableRow>
            )}
            {(data ?? []).map((room) => (
              <TableRow key={room.id} className={room.archivedAt ? "opacity-60" : undefined}>
                <TableCell className="font-medium">
                  {room.number}
                  {room.archivedAt && (
                    <Badge variant="outline" className="ml-2">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{typeName(room.roomTypeId)}</TableCell>
                <TableCell>{room.floor ?? "—"}</TableCell>
                <TableCell>
                  {/* Derived from tonight's stay, never stored — a column would
                      be wrong between a booking moving and somebody updating
                      it. Shape as well as hue, because colour is never the only
                      cue: `ui-patterns.md` § Colour as data. */}
                  <Badge
                    variant={room.saleState === RoomSaleState.OCCUPIED ? "default" : "outline"}
                    className={cn(
                      room.saleState === RoomSaleState.BOOKED &&
                        "border-stay-confirmed-border bg-stay-confirmed text-stay-confirmed-foreground"
                    )}
                  >
                    {saleLabels[room.saleState as RoomSaleStateValue] ?? room.saleState}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={room.status === RoomStatus.OUT_OF_ORDER ? "destructive" : "outline"}
                  >
                    {labels[room.status as RoomStatusValue] ?? room.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mayEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("rooms.editLabel", { number: room.number })}
                          onClick={() =>
                            NiceModal.show(RoomFormNiceDialog, { propertyId, roomId: room.id })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={
                            room.archivedAt
                              ? `Restore room ${room.number}`
                              : `Archive room ${room.number}`
                          }
                          disabled={archive.isPending}
                          onClick={() => toggleArchive(room.id, room.number, !room.archivedAt)}
                        >
                          {room.archivedAt ? <ArchiveRestore /> : <Archive />}
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
