"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";
import { useValidationMessages } from "./errors";

/**
 * Form validation, in the current language.
 *
 * Its own file rather than part of `errors.ts`: this imports
 * `@hookform/resolvers`, and `errors.ts` is reached by every route through
 * `handleError`. A screen with no form should not carry a resolver, and the
 * bundle is where that shows.
 */

/**
 * `zodResolver`, with the keys resolved to the current language.
 *
 * Client-side validation never passes through `normalizeError` — react-hook-form
 * hands the schema's message straight to the field — so this is where a key
 * becomes a sentence on that path. The server's copy of the same failure is
 * translated by `useErrorHandlers` instead, and both land on the same words.
 */
export function useZodResolver<TFieldValues extends FieldValues>(
  schema: z.ZodType
): Resolver<TFieldValues> {
  const translateField = useValidationMessages();

  return useMemo(() => {
    // The schema's own generics say nothing about the form's field names, and
    // the call site already states them on `useForm`. The casts are confined to
    // this line rather than spread across nine call sites.
    const base = zodResolver(
      schema as Parameters<typeof zodResolver>[0]
    ) as unknown as Resolver<TFieldValues>;

    return async (values, context, options) => {
      const result = await base(values, context, options);
      if (!result.errors) return result;
      return { ...result, errors: translateErrors(result.errors, translateField) };
    };
  }, [schema, translateField]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Field errors nest, so the walk does too. Only `message` is rewritten. */
function translateErrors(errors: unknown, translate: (key: string) => string | null): never {
  if (!isRecord(errors)) return errors as never;

  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(errors)) {
    if (isRecord(value) && typeof value.message === "string") {
      out[name] = { ...value, message: translate(value.message) ?? value.message };
    } else if (isRecord(value)) {
      out[name] = translateErrors(value, translate);
    } else {
      out[name] = value;
    }
  }
  return out as never;
}
