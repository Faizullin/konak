import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { personDisplayName } from "@/features/directory";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { AttachmentsPanel } from "@/features/platform/client/components/attachments-panel";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; personId: string }> };

/**
 * One person, and the paperwork attached to them.
 *
 * This route exists because identity documents hang off a `Person` and there
 * was nowhere to put them: the upload machinery was complete and unreachable
 * for the subject that needs it most.
 *
 * Three panels rather than one, each filtered to its own kind. A passport, a
 * marketing consent and a signed contract are different things to the person
 * looking at this page, and `KIND_LIMITS` already treats them differently — one
 * combined list would hide that.
 */
export default async function PersonPage({ params }: Params) {
  const t = await getTranslations("pages");
  const { orgSlug, personId } = await params;

  const id = Number(personId);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  const toggles = await prisma.organizationModule.findMany({
    where: { organizationId: organization.id },
    select: { moduleId: true, enabled: true },
  });
  if (!isOrgModuleEnabled("DIRECTORY", toggles)) {
    notFound();
  }

  // The organization is part of the lookup, not checked after it: a row from
  // another tenant must be indistinguishable from one that is absent.
  const person = await prisma.person.findFirst({
    where: { id, organizationId: organization.id },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  if (!person) {
    notFound();
  }

  const subject = { personId: person.id };

  return (
    <div className="space-y-8">
      <PageHeader
        title={personDisplayName(person)}
        description={t("person.description")}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/dashboard/orgs/${orgSlug}/directory`} />}
          >
            {t("person.backToDirectory")}
          </Button>
        }
      />

      {(person.email || person.phone) && (
        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {person.email && (
            <div className="flex items-center gap-2">
              <Mail className="size-4" aria-hidden />
              <dt className="sr-only">{t("person.email")}</dt>
              <dd>{person.email}</dd>
            </div>
          )}
          {person.phone && (
            <div className="flex items-center gap-2">
              <Phone className="size-4" aria-hidden />
              <dt className="sr-only">{t("person.phone")}</dt>
              <dd>{person.phone}</dd>
            </div>
          )}
        </dl>
      )}

      {/* The quota is one number for the whole organization, so only the first
          panel says it. */}
      <AttachmentsPanel
        organizationId={organization.id}
        subject={subject}
        kind="IDENTITY_DOCUMENT"
        title={t("person.identityDocuments")}
      />
      <AttachmentsPanel
        organizationId={organization.id}
        subject={subject}
        kind="CONSENT"
        title={t("person.consents")}
        showUsage={false}
      />
      <AttachmentsPanel
        organizationId={organization.id}
        subject={subject}
        kind="FILE"
        title={t("person.otherFiles")}
        showUsage={false}
      />
    </div>
  );
}
