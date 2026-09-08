import { notFound } from "next/navigation";
import { OrganizationMembersPanel } from "@/features/organizations/client";
import { organizationBySlug } from "@/features/organizations/server";

export default async function OrganizationMembersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  return <OrganizationMembersPanel organization={organization} />;
}
