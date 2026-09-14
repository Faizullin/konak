"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, CreditCard, LogIn, LogOut, Radio, Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The bell. `docs/plans/dashboard-header.md` § 3 decides this stays here while
 * it is fake: a `features/notifications/` with no router and no rows agreed on
 * by both sides would assert a feature that does not exist. Read state is
 * `useState` because it is demo data, not a cache of anything real.
 *
 * What replaces `INBOX_DEMO`, item by kind: `arrival`/`departure` from the
 * `reservation.day` query the grid already runs, `channel` from a booking
 * landing through `channels/server/inbound.ts`, and `payment` from a
 * dead-lettered outbox row. `housekeeping` has no source yet.
 */

type InboxKind = "arrival" | "departure" | "channel" | "housekeeping" | "payment";

interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body?: string;
  at: Date;
  read: boolean;
}

const KIND_ICONS: Record<InboxKind, LucideIcon> = {
  arrival: LogIn,
  departure: LogOut,
  channel: Radio,
  housekeeping: Sparkles,
  payment: CreditCard,
};

const INBOX_DEMO: InboxItem[] = [
  {
    id: "1",
    kind: "arrival",
    title: "Aigerim Bekova arrives today",
    body: "Room 204 · 2 nights",
    at: new Date(Date.now() - 20 * 60_000),
    read: false,
  },
  {
    id: "2",
    kind: "channel",
    title: "New booking from Booking.com",
    body: "3 nights, arriving Friday",
    at: new Date(Date.now() - 3 * 60 * 60_000),
    read: false,
  },
  {
    id: "3",
    kind: "housekeeping",
    title: "Room 108 marked clean",
    at: new Date(Date.now() - 5 * 60 * 60_000),
    read: true,
  },
  {
    id: "4",
    kind: "departure",
    title: "Nurlan Seitkali departs today",
    body: "Room 301",
    at: new Date(Date.now() - 26 * 60 * 60_000),
    read: true,
  },
];

function isToday(date: Date) {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

export function HeaderInbox() {
  const t = useTranslations("shell");
  const format = useFormatter();
  const [items, setItems] = useState(INBOX_DEMO);

  const unread = items.filter((item) => !item.read).length;
  const today = items.filter((item) => isToday(item.at));
  const earlier = items.filter((item) => !isToday(item.at));

  const markAllRead = () => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  };

  const renderGroup = (label: string, group: InboxItem[]) => {
    if (group.length === 0) return null;
    return (
      <div key={label} className="flex flex-col gap-1">
        <span className="text-muted-foreground px-1 text-xs font-medium">{label}</span>
        {group.map((item) => {
          const Icon = KIND_ICONS[item.kind];
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm",
                !item.read && "bg-accent/50"
              )}
            >
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.title}</span>
                {item.body && (
                  <span className="text-muted-foreground truncate text-xs">{item.body}</span>
                )}
                <span className="text-muted-foreground text-xs">
                  {format.relativeTime(item.at, new Date())}
                </span>
              </div>
              {!item.read && (
                <span className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={t("inbox.label")} className="relative">
            <Bell className="size-4" />
            {unread > 0 && (
              <Badge
                variant="destructive"
                className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full p-0 text-[10px]"
              >
                {unread}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96">
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{t("inbox.label")}</PopoverTitle>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={markAllRead}>
              {t("inbox.markAllRead")}
            </Button>
          )}
        </PopoverHeader>
        {items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("inbox.empty")}</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {renderGroup(t("inbox.today"), today)}
            {renderGroup(t("inbox.earlier"), earlier)}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
