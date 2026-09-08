"use client";

/**
 * For an error in the root layout, before `app/error.tsx` has a tree. Replaces
 * the document, so it brings its own `<html>`/`<body>` and uses no providers,
 * fonts or `cn` — the failure may be in one of them. Inline styles on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem" }}>
        <main style={{ margin: "0 auto", maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.75rem", opacity: 0.7 }}>
            The application failed to start. Please try again.
          </p>
          {error.digest && (
            <p style={{ marginTop: "0.75rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: "1.5rem", padding: "0.5rem 1rem" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
