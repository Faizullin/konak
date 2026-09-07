import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function Home() {
  // Clerk Core 3 removed <SignedIn>/<SignedOut>; in a Server Component the
  // session is read directly. (The client-side equivalent is `useAuth()`,
  // or `<Show when="signed-in">`.)
  const { userId } = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-xl space-y-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Konak</h1>
        <p className="text-muted-foreground">
          Clerk for authentication, Prisma on SQLite for data, tRPC for the typed API — and the
          feature-per-domain layout to grow into.
        </p>
      </div>

      <div className="flex gap-3">
        {userId ? (
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
