"use client";

import NiceModal from "@ebay/nice-modal-react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ISSUE_SEVERITY_VALUES,
  TASK_STATUS_VALUES,
  TASK_TYPE_VALUES,
  TaskStatus,
  TaskType,
  type IssueSeverity,
} from "@/features/housekeeping";
import { ROOM_STATUS_VALUES, RoomStatus } from "@/features/properties";
import { shiftStayDays, toDayInput, todayAt } from "@/features/reservations";
import { useErrorHandlers } from "@/lib/errors";
import { useEnumLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";
import { ReportIssueNiceDialog } from "./report-issue-nice-dialog";

type Board = GeneralRouterOutputs["housekeeping"]["board"];
type BoardRoom = Board["rooms"][number];

/**
 * The floor's day, on a phone.
 *
 * **Cards rather than a table, and that is a statement about a person.** This
 * is read standing up, on a small screen, by someone moving between floors with
 * one hand free — the grid's density is for a receptionist sitting at a desk.
 * The actions are the size of a thumb and there is one decision per card.
 *
 * Every room appears, not only the ones with work: the floor walks the
 * building, and a clean room with nothing owed is still a room to know about.
 */

/** What a room's own state says, before any task is read. */
const ROOM_TONE: Record<string, string> = {
  [RoomStatus.CLEAN]: "border-room-clean-border bg-room-clean",
  [RoomStatus.INSPECTED]: "border-room-inspected-border bg-room-inspected",
  [RoomStatus.DIRTY]: "border-room-dirty-border bg-room-dirty",
  [RoomStatus.IN_PROGRESS]: "border-room-in-progress-border bg-room-in-progress",
  // The one that stays `destructive`: a room out of order is the one room state
  // that genuinely is a problem, and `--destructive` is already the token for
  // "something is wrong" on every surface.
  [RoomStatus.OUT_OF_ORDER]: "border-destructive/50 bg-destructive/10",
};

export function HousekeepingBoard({
  propertyId,
  organizationId,
  timezone,
}: {
  propertyId: number;
  organizationId: number;
  timezone: string;
}) {
  const t = useTranslations("housekeeping");
  const roomLabels = useEnumLabels("roomStatus", ROOM_STATUS_VALUES);
  const taskLabels = useEnumLabels("taskType", TASK_TYPE_VALUES);
  const statusLabels = useEnumLabels("taskStatus", TASK_STATUS_VALUES);
  const severityLabels = useEnumLabels("issueSeverity", ISSUE_SEVERITY_VALUES);
  const { handleError } = useErrorHandlers();

  const today = useMemo(() => todayAt(timezone), [timezone]);
  const [day, setDay] = useState(today);

  const utils = trpc.useUtils();
  const input = { propertyId, day };
  const { data, isLoading } = trpc.housekeeping.board.useQuery(input, {
    // The floor and the desk read the same rooms; a board that is a minute
    // stale sends somebody to a room that is already done.
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    utils.housekeeping.board.invalidate();
    // The desk draws room status on the grid, so it cannot keep the old answer.
    utils.reservation.grid.invalidate();
  };

  const advance = trpc.housekeeping.advanceTask.useMutation({
    onSuccess: () => toast.success(t("board.moved")),
    onError: (error) => handleError(error),
    onSettled: invalidate,
  });

  const createTask = trpc.housekeeping.createTask.useMutation({
    onSuccess: () => toast.success(t("board.taskAdded")),
    onError: (error) => handleError(error),
    onSettled: invalidate,
  });

  // Who can be given work. Membership of the organization is what makes
  // somebody assignable, so this is the list and there is no second one.
  const { data: members } = trpc.organization.listMembers.useQuery({ organizationId });

  const assign = trpc.housekeeping.assignTask.useMutation({
    onError: (error) => handleError(error),
    onSettled: invalidate,
  });

  const resolve = trpc.housekeeping.resolveIssue.useMutation({
    onSuccess: () => toast.success(t("issue.resolved")),
    onError: (error) => handleError(error),
    onSettled: invalidate,
  });

  const pending =
    advance.isPending || createTask.isPending || resolve.isPending || assign.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("board.previousDay")}
          onClick={() => setDay((current) => shiftStayDays(current, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button variant="ghost" onClick={() => setDay(today)}>
          {t("board.today")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("board.nextDay")}
          onClick={() => setDay((current) => shiftStayDays(current, 1))}
        >
          <ChevronRight />
        </Button>
        <span className="text-muted-foreground text-sm">{toDayInput(day)}</span>
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-96 w-full" />
      ) : data && data.rooms.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("board.empty")}</p>
      ) : (
        // One column on a phone, two once there is room. Never a table: a table
        // on a 5" screen is a horizontal scroll with a thumb in the way.
        <ul className="grid gap-3 sm:grid-cols-2">
          {data?.rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              pending={pending}
              roomLabel={roomLabels[room.status as RoomStatus] ?? room.status}
              taskLabels={taskLabels}
              statusLabels={statusLabels}
              severityLabels={severityLabels}
              members={members ?? []}
              onAssign={(id, assignedMemberId) =>
                assign.mutate({ propertyId, id, assignedMemberId })
              }
              onAdvance={(id, status) => advance.mutate({ propertyId, id, status })}
              onAddTask={() =>
                createTask.mutate({
                  propertyId,
                  roomId: room.id,
                  type: TaskType.DEPARTURE_CLEAN,
                  day,
                })
              }
              onResolve={(id) => resolve.mutate({ propertyId, id, status: "RESOLVED" })}
              onReport={() =>
                NiceModal.show(ReportIssueNiceDialog, {
                  propertyId,
                  roomId: room.id,
                  roomNumber: room.number,
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoomCard({
  room,
  pending,
  roomLabel,
  taskLabels,
  statusLabels,
  severityLabels,
  members,
  onAssign,
  onAdvance,
  onAddTask,
  onResolve,
  onReport,
}: {
  room: BoardRoom;
  pending: boolean;
  roomLabel: string;
  taskLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  severityLabels: Record<string, string>;
  members: { id: number; user: { name: string | null; email: string } }[];
  onAssign: (id: number, assignedMemberId: number | null) => void;
  onAdvance: (id: number, status: TaskStatus) => void;
  onAddTask: () => void;
  onResolve: (id: number) => void;
  onReport: () => void;
}) {
  const t = useTranslations("housekeeping");
  const open = room.tasks.filter((task) => task.status !== TaskStatus.DONE);

  return (
    <li className={cn("rounded-lg border p-3", ROOM_TONE[room.status] ?? "bg-card")}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-lg font-semibold">{room.number}</span>
        <Badge variant="outline">{roomLabel}</Badge>
        <span className="text-muted-foreground text-xs">{room.roomType.name}</span>
        {room.floor && (
          <span className="text-muted-foreground ml-auto text-xs">
            {t("board.floor", { floor: room.floor })}
          </span>
        )}
      </div>

      {room.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {room.issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-center gap-2 text-sm">
              <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden />
              <span className="truncate">{issue.title}</span>
              <Badge variant="outline" className="text-xs">
                {severityLabels[issue.severity as IssueSeverity] ?? issue.severity}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={pending}
                onClick={() => onResolve(issue.id)}
              >
                {t("issue.resolve")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-2">
        {open.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("board.nothingOwed")}</p>
        ) : (
          open.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{taskLabels[task.type] ?? task.type}</span>
              <Badge variant="secondary" className="text-xs">
                {statusLabels[task.status] ?? task.status}
              </Badge>

              {/* Who is doing it. `unassigned` is a value rather than an
                  absence — putting work back in the pool is a decision. */}
              <Select
                value={task.assignedMemberId ? String(task.assignedMemberId) : "unassigned"}
                onValueChange={(value) =>
                  onAssign(task.id, value === "unassigned" ? null : Number(value))
                }
                disabled={pending}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue>
                    {(v: string) =>
                      v === "unassigned"
                        ? t("board.unassigned")
                        : members.find((m) => String(m.id) === v)?.user.name ||
                          members.find((m) => String(m.id) === v)?.user.email ||
                          v
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">{t("board.unassigned")}</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.user.name || member.user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* One decision per row, and the buttons are the size of a thumb. */}
              <div className="ml-auto flex gap-2">
                {task.status === TaskStatus.PENDING && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onAdvance(task.id, TaskStatus.IN_PROGRESS)}
                  >
                    {t("board.start")}
                  </Button>
                )}
                {task.status === TaskStatus.BLOCKED && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onAdvance(task.id, TaskStatus.PENDING)}
                  >
                    {t("board.resume")}
                  </Button>
                )}
                {task.status !== TaskStatus.BLOCKED && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onAdvance(task.id, TaskStatus.BLOCKED)}
                  >
                    {t("board.block")}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => onAdvance(task.id, TaskStatus.DONE)}
                >
                  {t("board.done")}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={onAddTask}>
          {t("board.addTask")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onReport}>
          {t("issue.report")}
        </Button>
      </div>
    </li>
  );
}
