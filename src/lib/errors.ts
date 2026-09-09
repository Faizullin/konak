"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

/**
 * Every error the client can be handed: what it is, and where it renders.
 *
 * Two dialects reach the browser — tRPC throws, Better Auth *returns*
 * `{ data, error }` — and `normalizeError` collapses both into `AppError` so
 * no form has to know either. See ui-patterns.md § Errors for the routing table.
 */

export type AppErrorKind =
  /** At least one named input is wrong. Render under the field. */
  | "field"
  /** Wrong, but not about one input. Render on the form. */
  | "form"
  /** No session. A toast is useless — the caller redirects. */
  | "auth"
  /** Signed in, not allowed. Editing the form cannot fix it. */
  | "forbidden"
  /** The row is gone, usually a stale list. */
  | "notFound"
  /** Our fault. The message is never shown. */
  | "server"
  /** Never reached the server at all. */
  | "network";

export type AppError = {
  kind: AppErrorKind;
  /** Safe to display, always. */
  message: string;
  /** Field name → messages. Zod's map and a `DomainError`'s single name both land here. */
  fieldErrors?: Record<string, string[]>;
  /** Messages belonging to the submission as a whole. */
  formErrors?: string[];
  code?: string;
  /**
   * The stable half of a domain refusal — `DomainError.code` on the server.
   *
   * `code` above is the transport's (`CONFLICT`, `NOT_FOUND`); this is the
   * rule's ("reservation.room_taken"). A message can be reworded or translated
   * without moving, which is what a screen keying off a specific refusal, and a
   * later translation file, need.
   */
  domainCode?: string;
  status?: number;
};

/**
 * Turns a domain code into a sentence, or `null` when it has no translation.
 *
 * Passed in rather than imported, so `normalizeError` stays pure and its tests
 * stay free of a provider. `useErrorHandlers` supplies the real one.
 */
export type TranslateDomain = (
  code: string,
  values?: Record<string, string | number>
) => string | null;

/** What a 500 says. The server's own message is written for a log, not a person. */
export const GENERIC_SERVER_MESSAGE = "Something went wrong. Please try again.";

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

/** Anything unlisted — `INTERNAL_SERVER_ERROR` included — is ours. */
const KIND_BY_CODE: Record<string, AppErrorKind> = {
  UNAUTHORIZED: "auth",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  BAD_REQUEST: "form",
  CONFLICT: "form",
  PARSE_ERROR: "form",
  UNPROCESSABLE_CONTENT: "form",
  TIMEOUT: "network",
  TOO_MANY_REQUESTS: "network",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v) : [];
}

/** By shape, not `instanceof`: the concrete classes drag React in with them. */
function trpcDataOf(error: unknown): Record<string, unknown> | null {
  if (!isRecord(error) || !isRecord(error.data)) return null;
  return typeof error.data.code === "string" ? error.data : null;
}

function authErrorOf(error: unknown): Record<string, unknown> | null {
  if (!isRecord(error)) return null;
  return typeof error.status === "number" ? error : null;
}

function kindByStatus(status: number): AppErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status >= 500) return "server";
  if (status >= 400) return "form";
  return "server";
}

/** Everything above, applied. Never throws, whatever it is handed. */
export function normalizeError(error: unknown, translate?: TranslateDomain): AppError {
  const data = trpcDataOf(error);

  if (data) {
    const english = stringOr(isRecord(error) ? error.message : null, GENERIC_SERVER_MESSAGE);
    // The code wins when it has a translation; the server's English is the
    // fallback, not the source. A refusal whose sentence comes from a `model/`
    // rule has no translation yet and keeps its English — see
    // `plans/internationalisation.md`.
    const code = typeof data.domainCode === "string" ? data.domainCode : null;
    const values = isRecord(data.domainValues)
      ? (data.domainValues as Record<string, string | number>)
      : undefined;
    const message = (code && translate?.(code, values)) || english;
    const zod = isRecord(data.zodError) ? data.zodError : null;

    const fieldErrors: Record<string, string[]> = {};
    if (zod && isRecord(zod.fieldErrors)) {
      for (const [name, messages] of Object.entries(zod.fieldErrors)) {
        const list = stringsOf(messages);
        if (list.length) fieldErrors[name] = list;
      }
    }
    // A `DomainError` names one field for a rule Zod cannot express, and the
    // message for it is the error's own.
    if (typeof data.field === "string" && data.field) {
      fieldErrors[data.field] = [...(fieldErrors[data.field] ?? []), message];
    }

    const formErrors = zod ? stringsOf(zod.formErrors) : [];
    const named = Object.keys(fieldErrors).length > 0;
    const kind = named ? "field" : (KIND_BY_CODE[data.code as string] ?? "server");

    return {
      kind,
      message: kind === "server" ? GENERIC_SERVER_MESSAGE : message,
      ...(named ? { fieldErrors } : {}),
      ...(formErrors.length ? { formErrors } : {}),
      code: data.code as string,
      ...(code ? { domainCode: code } : {}),
      ...(typeof data.httpStatus === "number" ? { status: data.httpStatus } : {}),
    };
  }

  const auth = authErrorOf(error);
  if (auth) {
    const kind = kindByStatus(auth.status as number);
    return {
      kind,
      message:
        kind === "server" ? GENERIC_SERVER_MESSAGE : stringOr(auth.message, GENERIC_SERVER_MESSAGE),
      ...(typeof auth.code === "string" ? { code: auth.code } : {}),
      status: auth.status as number,
    };
  }

  // `fetch` rejects with a TypeError when the request never left, which is the
  // one failure worth wording differently: nothing is wrong with the input.
  if (error instanceof TypeError) {
    return { kind: "network", message: NETWORK_MESSAGE };
  }

  return { kind: "server", message: GENERIC_SERVER_MESSAGE };
}

/** `fieldErrors` flattened to pairs, in declaration order. One message per pair. */
export function fieldEntriesOf(error: AppError): Array<[string, string]> {
  return Object.entries(error.fieldErrors ?? {}).flatMap(([field, messages]) =>
    messages.map((message): [string, string] => [field, message])
  );
}

/* --- Placing an error ----------------------------------------------------- */

export type HandleOptions<T extends FieldValues = FieldValues> = {
  /**
   * `false` renders nothing that is not a field error and returns what is
   * left, for a caller that wants to place it itself. Defaults to `true`.
   */
  toast?: boolean;
  /** Where a non-field message goes. Defaults by kind — see the table above. */
  fallback?: "toast" | "form";
  /**
   * Shown only when nothing better exists — that is, when the error carried no
   * message of its own and would otherwise read as the generic 500 copy. A real
   * server message always wins over it.
   */
  fallbackMessage?: string;
  /** Server field name → form field name, for the cases where they differ. */
  map?: Partial<Record<string, Path<T>>>;
  /** Supplied by `useErrorHandlers`; absent means the server's English. */
  translate?: TranslateDomain;
};

/**
 * For a mutation with no form behind it: `onError: (e) => handleError(e)`.
 * Wrapped, not passed by name — react-query would pass `variables` where
 * `options` is expected.
 */
export function handleError(error: unknown, options: HandleOptions = {}): AppError | null {
  const app = normalizeError(error, options.translate);
  const message = display(app.message, undefined, options.fallbackMessage);
  if (options.toast === false) return { ...app, message };
  toast.error(message);
  return null;
}

/** The server's words when it had any; `GENERIC_SERVER_MESSAGE` means it had none. */
function display(normalized: string, leftover: string | undefined, fallback?: string): string {
  if (leftover) return leftover;
  if (normalized !== GENERIC_SERVER_MESSAGE) return normalized;
  return fallback ?? normalized;
}

/**
 * For a mutation with a form behind it. Field errors are always placed; what
 * is left follows `fallback`. A server field this form does not have falls
 * through to the form-level error rather than vanishing.
 */
export function handleFormError<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
  options: HandleOptions<T> = {}
): AppError | null {
  const app = normalizeError(error, options.translate);
  const known = new Set(Object.keys(form.getValues() ?? {}));

  const unplaced: string[] = [];
  let placed = 0;

  for (const [field, message] of fieldEntriesOf(app)) {
    const target = (options.map?.[field] ?? field) as Path<T>;
    if (known.has(target)) {
      form.setError(target, { type: "server", message });
      placed += 1;
    } else {
      unplaced.push(message);
    }
  }

  const leftover = [...(app.formErrors ?? []), ...unplaced];
  // Everything the person needs to see is already under a field.
  if (placed > 0 && leftover.length === 0) return null;

  const message = display(app.message, leftover[0], options.fallbackMessage);
  if (options.toast === false) return { ...app, message };

  const where =
    options.fallback ?? (app.kind === "field" || app.kind === "form" ? "form" : "toast");

  if (where === "form") {
    form.setError("root", { type: "server", message });
  } else {
    toast.error(message);
  }
  return null;
}

/* --- Translating a refusal ------------------------------------------------ */

/**
 * The two placers, bound to the current language.
 *
 * `handleError` and `handleFormError` stay exported and pure — their tests pass
 * a `translate` directly and need no provider. A component uses this instead:
 *
 *   const { handleError } = useErrorHandlers();
 *   const remove = trpc.x.useMutation({ onError: handleError });
 *
 * The component's tree must be under a `NextIntlClientProvider` carrying the
 * `errors` namespace — `(app)/dashboard/layout.tsx` and `(auth)/layout.tsx` do.
 */
export function useErrorHandlers() {
  const t = useTranslations("errors");

  const translate = useCallback<TranslateDomain>(
    (code, values) => {
      // `has` and `t` are typed to literal keys from the JSON. A domain code is
      // data — it arrives over the wire — so the cast is the honest shape, and
      // `has` is what keeps an unknown one from throwing.
      const key = code as Parameters<typeof t.has>[0];
      return t.has(key) ? t(key, values as never) : null;
    },
    [t]
  );

  return useMemo(
    () => ({
      handleError: (error: unknown, options: HandleOptions = {}) =>
        handleError(error, { translate, ...options }),
      handleFormError: <T extends FieldValues>(
        form: UseFormReturn<T>,
        error: unknown,
        options: HandleOptions<T> = {}
      ) => handleFormError(form, error, { translate, ...options }),
    }),
    [translate]
  );
}
