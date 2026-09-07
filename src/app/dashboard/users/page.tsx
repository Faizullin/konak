import { UsersTableView } from "@/features/identity/client";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-muted-foreground text-sm">
          Everyone with an account on this install, and the role each one holds.
        </p>
      </div>
      <UsersTableView />
    </div>
  );
}
