import { headers } from "next/headers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";

export default async function Home() {
  // In a Server Component the session is read straight off the request
  // headers. The client-side equivalent is `authClient.useSession()`.
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-xl space-y-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Konak</h1>
        <p className="text-muted-foreground">
          Better Auth for authentication, Prisma on PostgreSQL for data, tRPC for the typed API —
          and the feature-per-domain layout to grow into.
        </p>
      </div>

      <div className="flex gap-3">
        {session ? (
          <Button nativeButton={false} render={<Link href="/dashboard" />}>
            Go to dashboard
          </Button>
        ) : (
          <>
            <Button nativeButton={false} render={<Link href="/sign-in" />}>
              Sign in
            </Button>
            <Button nativeButton={false} render={<Link href="/sign-up" />} variant="outline">
              Create account
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
