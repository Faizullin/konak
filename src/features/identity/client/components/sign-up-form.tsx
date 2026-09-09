"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { FormError } from "@/components/common/form-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signUpSchema, type SignUpInput } from "@/features/identity";
import { authClient } from "@/lib/auth-client";
import { useErrorHandlers } from "@/lib/errors";
import { OAuthButtons, type OAuthProvider } from "./oauth-buttons";

/**
 * Create an account with email and password.
 *
 * `role` is deliberately absent: it is an `input: false` field on the server,
 * so there is nothing here that could set it. New accounts are always USER.
 */
export function SignUpForm({ providers = [] }: { providers?: OAuthProvider[] }) {
  const { handleFormError } = useErrorHandlers();
  const t = useTranslations("auth");
  const router = useRouter();

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const isPending = form.formState.isSubmitting;

  const onSubmit = async (values: SignUpInput) => {
    const { error } = await authClient.signUp.email(values);
    if (error) {
      // A wrong password belongs on the form, not in a toast that fades:
      // the person is still looking at the boxes they need to correct.
      handleFormError(form, error, {
        fallback: "form",
        fallbackMessage: "Could not create your account",
      });
      return;
    }

    // `autoSignIn` is on in the server config, so the session cookie is
    // already set by the time this resolves — straight to the dashboard.
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
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="sign-up-name">{t("fields.name")}</FieldLabel>
                <Input
                  id="sign-up-name"
                  autoComplete="name"
                  placeholder={t("fields.namePlaceholder")}
                  disabled={isPending}
                  {...field}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="sign-up-email">{t("fields.email")}</FieldLabel>
                <Input
                  id="sign-up-email"
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
                <FieldLabel htmlFor="sign-up-password">{t("fields.password")}</FieldLabel>
                <Input
                  id="sign-up-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("fields.passwordPlaceholder")}
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
          {t("signUp.submit")}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        {t("signUp.haveAccount")}{" "}
        <Button nativeButton={false} variant="link" size="xs" render={<Link href="/sign-in" />}>
          {t("signUp.signIn")}
        </Button>
      </p>
    </div>
  );
}
