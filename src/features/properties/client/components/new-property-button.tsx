"use client";

import NiceModal from "@ebay/nice-modal-react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertyFormNiceDialog } from "./property-form-nice-dialog";

/** The one client island on an otherwise server-rendered list. */
export function NewPropertyButton({
  organizationId,
  orgSlug,
}: {
  organizationId: number;
  orgSlug: string;
}) {
  const t = useTranslations("properties");

  return (
    <Button
      size="sm"
      onClick={() => NiceModal.show(PropertyFormNiceDialog, { organizationId, orgSlug })}
    >
      <Plus />
      {t("propertyForm.new")}
    </Button>
  );
}
