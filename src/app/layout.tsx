import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import Providers from "@/components/layout/providers";

import "@/styles/index.scss";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Konak",
  description: "Konak - Next.js + Better Auth + Prisma + tRPC",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The locale is a cookie, not a URL segment, so this is the only place that
  // can put it on `<html>`. It was hardcoded `en` while the product was already
  // serving Russian — a screen reader and every `lang`-dependent rule believed
  // the wrong one.
  const locale = await getLocale();

  return (
    // `next-themes` writes the class before React hydrates, which is the whole
    // point of it — and without this every page logs a mismatch for a class the
    // server could not have known.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NuqsAdapter>
          <Providers>{children}</Providers>
        </NuqsAdapter>
      </body>
    </html>
  );
}
