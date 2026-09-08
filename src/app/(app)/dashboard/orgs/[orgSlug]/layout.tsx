import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReactNode } from "react";
import { organizationSlugSchema } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";

type Params = { params: Promise<{ orgSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { orgSlug } = await params;
  const organization = await organizationBySlug(orgSlug);
  if (!organization) return { title: "Not found" };

  return {
    title: organization.name,
    description: organization.description ?? undefined,
  };
}

/**
 * Validates the param's shape before it reaches the database — the same schema
 * the create form uses. Membership is checked by the procedures each page calls.
 */
export default async function OrganizationLayout({
  children,
  params,
}: Params & { children: ReactNode }) {
  const { orgSlug } = await params;
  if (!organizationSlugSchema.safeParse(orgSlug).success) {
    notFound();
  }
  return <>{children}</>;
}
