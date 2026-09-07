"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInSchema, type SignInInput } from "@/features/identity";
import { authClient } from "@/lib/auth-client";
import { OAuthButtons, type OAuthProvider } from "./oauth-buttons";

/**
 * Sign in with email and password.
 *
 * A component rather than a page so the route file stays a thin shell and the
 * form can be dropped into a dialog later without moving anything.
 */
export function SignInForm({ providers = [] }: { providers?: OAuthProvider[] }) {
  const router = useRouter();

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const isPending = form.formState.isSubmitting;

  const onSubmit = async (values: SignInInput) => {
    // authClient resolves with `{ data, error }` instead of throwing, so a
    // wrong password arrives here as a value. Checking it is not optional —
    // without this branch a failed sign-in would look like a success.
    const { error } = await authClient.signIn.email(values);
    if (error) {
      toast.error(error.message ?? "Could not sign in");
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
        <FieldGroup>
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
                <Input
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
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
                <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
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
          Sign in
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{" "}
        <Button nativeButton={false} variant="link" size="xs" render={<Link href="/sign-up" />}>
          Create one
        </Button>
      </p>
    </div>
  );
}
