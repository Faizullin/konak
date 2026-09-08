import { notFound } from "next/navigation";
import { OrganizationSettingsPanel } from "@/features/organizations/client";
import { organizationBySlug } from "@/features/organizations/server";

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  return <OrganizationSettingsPanel organization={organization} />;
}
