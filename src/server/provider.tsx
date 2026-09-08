"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import superjson from "superjson";
import { normalizeError } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/** One typed client, created in `@/utils/trpc` and provided here. */
export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const router = useRouter();

  // The QueryClient is built once, so the caches below would close over the
  // first router. A ref keeps them pointed at the current one.
  const routerRef = useRef(router);
  routerRef.current = router;
  const redirecting = useRef(false);

  /**
   * A lost session is the one error no component can usefully render: the
   * person is not signed in, so the answer is the sign-in page, not a message
   * next to a button. Handled once here rather than in every `onError`.
   *
   * Redirect only — the local handler still writes the message, and doing both
   * here would show it twice.
   */
  const onExpiredSession = (error: unknown) => {
    if (normalizeError(error).kind !== "auth") return;
    if (redirecting.current || window.location.pathname.startsWith("/sign-in")) return;
    redirecting.current = true;
    routerRef.current.push("/sign-in");
  };

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: onExpiredSession }),
        mutationCache: new MutationCache({ onError: onExpiredSession }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: getBaseUrl() + "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * Where the tRPC client sends its requests. Empty string in the browser, so the
 * fetch stays same-origin and relative.
 *
 * Raw `process.env` here, like `next.config.ts` and for a related reason: this
 * module is `"use client"`, and `env.mjs`'s server block is unreachable from a
 * client module. Mirroring these into `NEXT_PUBLIC_` would publish them to the
 * browser for the sake of two values only the server branch below ever reads.
 */
function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
