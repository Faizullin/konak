import { notFound } from "next/navigation";
import { OrganizationOverview } from "@/features/organizations/client";
import { organizationBySlug } from "@/features/organizations/server";

export default async function OrganizationOverviewPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  return <OrganizationOverview organization={organization} />;
}
