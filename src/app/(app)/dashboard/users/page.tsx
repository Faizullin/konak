import { PageHeader } from "@/components/common/page-header";
import { UsersTableView } from "@/features/identity/client/components/users-table-view";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Everyone with an account on this install, and the role each one holds."
      />
      <UsersTableView />
    </div>
  );
}
