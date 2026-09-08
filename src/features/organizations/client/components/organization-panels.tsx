"use client";

import NiceModal from "@ebay/nice-modal-react";
import { Building2, Pencil, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ORG_ROLE_LABELS, canEditOrganization, type OrgRole } from "@/features/organizations";
import { trpc } from "@/utils/trpc";
import { MemberTable } from "./member-table";
import { OrganizationDangerZone } from "./organization-danger-zone";
import { OrganizationFormNiceDialog } from "./organization-form-nice-dialog";

/**
 * The three organization pages, each a thin panel over one query.
 *
 * They live here rather than in `app/` because they hold queries and state;
 * the route files read the param and render one of these, which is all a
 * `page.tsx` should do.
 */

/** Shared shell: resolves the org, or explains why it cannot. */
function useOrganization(organizationId: number) {
  return trpc.organization.getById.useQuery({ id: organizationId });
}

function PanelError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Cannot open this organization</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function OrganizationOverview({ organizationId }: { organizationId: number }) {
  const { data, isLoading, error } = useOrganization(organizationId);
  const currentUser = trpc.user.getCurrent.useQuery();

  if (isLoading) return <Skeleton className="h-48" />;
  if (error) return <PanelError message={error.message} />;
  if (!data) return null;

  const canEdit = canEditOrganization(data.currentUserRole as OrgRole);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="text-muted-foreground text-sm">
            /{data.slug}
            {data.description ? ` · ${data.description}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{ORG_ROLE_LABELS[data.currentUserRole as OrgRole]}</Badge>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                NiceModal.show(OrganizationFormNiceDialog, { mode: "edit", organizationId })
              }
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Users className="size-4" />
              Members
            </CardDescription>
            <CardTitle className="text-3xl">{data.memberCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Building2 className="size-4" />
              Created
            </CardDescription>
            <CardTitle className="text-3xl">
              {new Date(data.createdAt).toLocaleDateString()}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Who has access, and what they can do.</CardDescription>
        </CardHeader>
        <CardContent>
          <MemberTable
            organizationId={organizationId}
            currentUserRole={data.currentUserRole as OrgRole}
            currentUserId={currentUser.data?.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function OrganizationMembersPanel({ organizationId }: { organizationId: number }) {
  const { data, isLoading, error } = useOrganization(organizationId);
  const currentUser = trpc.user.getCurrent.useQuery();

  if (isLoading) return <Skeleton className="h-48" />;
  if (error) return <PanelError message={error.message} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-muted-foreground text-sm">
          Owners and admins can add people and change roles.
        </p>
      </div>
      <MemberTable
        organizationId={organizationId}
        currentUserRole={data.currentUserRole as OrgRole}
        currentUserId={currentUser.data?.id}
      />
    </div>
  );
}

export function OrganizationSettingsPanel({ organizationId }: { organizationId: number }) {
  const { data, isLoading, error } = useOrganization(organizationId);
  const currentUser = trpc.user.getCurrent.useQuery();

  if (isLoading) return <Skeleton className="h-48" />;
  if (error) return <PanelError message={error.message} />;
  if (!data) return null;

  const role = data.currentUserRole as OrgRole;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">Name, slug and the irreversible actions.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>{data.name}</CardTitle>
            <CardDescription>
              /{data.slug}
              {data.description ? ` · ${data.description}` : ""}
            </CardDescription>
          </div>
          {canEditOrganization(role) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                NiceModal.show(OrganizationFormNiceDialog, { mode: "edit", organizationId })
              }
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
        </CardHeader>
      </Card>

      <OrganizationDangerZone
        organizationId={organizationId}
        currentUserRole={role}
        currentUserId={currentUser.data?.id}
      />
    </div>
  );
}
