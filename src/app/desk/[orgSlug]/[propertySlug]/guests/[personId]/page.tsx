import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { personDisplayName } from "@/features/directory";
import { StayHistory } from "@/features/directory/client/components/stay-history";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { organizationBySlug } from "@/features/organizations/server";
import { AttachmentsPanel } from "@/features/platform/client/components/attachments-panel";
import { EntityTags } from "@/features/platform/client/components/entity-tags";
import prisma from "@/server/db";

type Params = {
  params: Promise<{ orgSlug: string; propertySlug: string; personId: string }>;
};

/**
 * The guest, on the desk.
 *
 * The list has been here since P4 and the card had not: clicking a name left
 * the shell for the dashboard's directory, which made one of the client's eight
 * items unreachable inside the surface built for them.
 *
 * Composition, like every other desk screen — the tags, the history and the
 * three attachment panels are the same components the dashboard renders. What
 * differs is the frame and, now, where the links go: `usePersonLink` and
 * `useBookingLink` read the surface rather than writing the dashboard's paths.
 *
 * The directory is **organisation-wide** even though this route sits under a
 * property: a guest of one hotel in a group is a guest of the group, and a
 * receptionist looking someone up wants their whole history, not the part that
 * happened in this building.
 */
export default async function DeskGuestPage({ params }: Params) {
  const t = await getTranslations("pages");
  const { orgSlug, propertySlug, personId } = await params;

  const id = Number(personId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!property) notFound();

  // The organization is part of the lookup, not checked after it: a row from
  // another tenant must be indistinguishable from one that is absent.
  const person = await prisma.person.findFirst({
    where: { id, organizationId: organization.id },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, notes: true },
  });
  if (!person) notFound();

  const subject = { personId: person.id };

  return (
    <DeskSection
      property={property.name}
      section={personDisplayName(person)}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <div className="space-y-6">
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

        {/* The hotel's own vocabulary. Above the notes, because a tag is what
            someone scans for and a note is what they then read. */}
        <EntityTags organizationId={organization.id} subject={subject} />

        {person.notes && (
          <p className="text-muted-foreground rounded border p-3 text-sm whitespace-pre-wrap">
            {person.notes}
          </p>
        )}

        {/* Why a directory is worth keeping: a returning guest is one person
            with a history, not three unrelated bookings. */}
        <StayHistory organizationId={organization.id} personId={person.id} orgSlug={orgSlug} />

        {/* Three panels rather than one, each filtered to its own kind: a
            passport, a consent and a contract are different things to the
            person looking at this, and `KIND_LIMITS` already treats them so. */}
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
    </DeskSection>
  );
}
