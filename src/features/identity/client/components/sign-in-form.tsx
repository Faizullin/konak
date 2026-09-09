"use client";

import { LoaderIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { FormError } from "@/components/common/form-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInSchema, type SignInInput } from "@/features/identity";
import { authClient } from "@/lib/auth-client";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { OAuthButtons, type OAuthProvider } from "./oauth-buttons";

/**
 * Sign in with email and password.
 *
 * A component rather than a page so the route file stays a thin shell and the
 * form can be dropped into a dialog later without moving anything.
 */
export function SignInForm({ providers = [] }: { providers?: OAuthProvider[] }) {
  const { handleFormError } = useErrorHandlers();
  const t = useTranslations("auth");
  const router = useRouter();

  const resolver = useZodResolver<SignInInput>(signInSchema);

  const form = useForm<SignInInput>({
    resolver,
    defaultValues: { email: "", password: "" },
  });

  const isPending = form.formState.isSubmitting;

  const onSubmit = async (values: SignInInput) => {
    // authClient resolves with `{ data, error }` instead of throwing, so a
    // wrong password arrives here as a value. Checking it is not optional —
    // without this branch a failed sign-in would look like a success.
    const { error } = await authClient.signIn.email(values);
    if (error) {
      // A wrong password belongs on the form, not in a toast that fades:
      // the person is still looking at the boxes they need to correct.
      handleFormError(form, error, { fallback: "form", fallbackMessage: "Could not sign in" });
      return;
    }

    // `refresh()` so the server components that read the session — the
    // dashboard guard, the sidebar's user — see the new cookie.
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <OAuthButtons providers={providers} />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormError message={form.formState.errors.root?.message} />

        <FieldGroup>
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="sign-in-email">{t("fields.email")}</FieldLabel>
                <Input
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("fields.emailPlaceholder")}
                  disabled={isPending}
                  {...field}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="sign-in-password">{t("fields.password")}</FieldLabel>
                <Input
                  id="sign-in-password"
                  type="password"
                  autoComplete="current-password"
                  disabled={isPending}
                  {...field}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <LoaderIcon className="size-4 animate-spin" />}
          {t("signIn.submit")}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        {t("signIn.noAccount")}{" "}
        <Button nativeButton={false} variant="link" size="xs" render={<Link href="/sign-up" />}>
          {t("signIn.createOne")}
        </Button>
      </p>
    </div>
  );
}
