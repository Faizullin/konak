"use client";

import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { normaliseTagName, subjectInput, type SubjectRef } from "@/features/platform";
import { useErrorHandlers } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * The hotel's own vocabulary, on one subject.
 *
 * "VIP", "allergic to feathers" and "always wants a high floor" are not things
 * a vendor can enumerate in advance — `product-shape.md` § 11 — so the list is
 * the organization's and a person can add to it from here rather than being
 * sent to a settings screen to define a word first.
 */
export function EntityTags({
  organizationId,
  subject,
}: {
  organizationId: number;
  subject: SubjectRef;
}) {
  const t = useTranslations("platform");
  const { handleError } = useErrorHandlers();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const utils = trpc.useUtils();
  // Through `subjectInput`, not spread raw: a `null` id reads as *set* and
  // fails the exactly-one rule, which is the conversion that helper exists for.
  const on = { organizationId, ...subjectInput(subject) };

  const { data: mine, isLoading } = trpc.platform.listSubjectTags.useQuery(on);
  const { data: all } = trpc.platform.listTags.useQuery({ organizationId }, { enabled: open });

  const settled = {
    onError: (error: unknown) => handleError(error),
    onSettled: () => {
      utils.platform.listSubjectTags.invalidate(on);
      utils.platform.listTags.invalidate({ organizationId });
    },
  };

  const attach = trpc.platform.attachTag.useMutation(settled);
  const detach = trpc.platform.detachTag.useMutation(settled);
  const create = trpc.platform.createTag.useMutation({
    ...settled,
    onSuccess: (tag) => {
      // Created and attached are one act here: nobody opens this to define a
      // word and walk away.
      attach.mutate({ ...on, tagId: tag.id });
      setDraft("");
    },
  });

  const pending = attach.isPending || detach.isPending || create.isPending;
  const taken = new Set((mine ?? []).map((tag) => tag.id));
  const wanted = normaliseTagName(draft);
  const unused = (all ?? []).filter((tag) => !taken.has(tag.id));
  const exists = (all ?? []).some((tag) => tag.name === wanted);

  if (isLoading) return <Skeleton className="h-8 w-48" />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(mine ?? []).map((tag) => (
        <Badge key={tag.id} variant="secondary" className="gap-1">
          {tag.name}
          <button
            type="button"
            aria-label={t("tags.remove", { name: tag.name })}
            disabled={pending}
            onClick={() => detach.mutate({ ...on, tagId: tag.id })}
            className="hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <Plus />
          {t("tags.add")}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          <Input
            value={draft}
            placeholder={t("tags.placeholder")}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !wanted || exists) return;
              event.preventDefault();
              create.mutate({ organizationId, name: wanted });
            }}
          />

          {wanted && !exists && (
            <Button
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() => create.mutate({ organizationId, name: wanted })}
            >
              {t("tags.create", { name: wanted })}
            </Button>
          )}

          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {unused
              .filter((tag) => !wanted || tag.name.toLowerCase().includes(wanted.toLowerCase()))
              .map((tag) => (
                <li key={tag.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={pending}
                    onClick={() => attach.mutate({ ...on, tagId: tag.id })}
                  >
                    {tag.name}
                  </Button>
                </li>
              ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
