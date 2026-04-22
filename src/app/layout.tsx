import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, readLocaleCookie } from "@/lib/locale";
import { LanguageProvider } from "@/lib/LanguageContext";

const inter = Inter({ subsets: ["latin"], display: "swap" });

const APP_NAME = "OPS";
const APP_DEFAULT_TITLE = "OPS";
const APP_DESCRIPTION = "Gestión de stock offline-first para hostelería.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: "%s · Stock"
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_DEFAULT_TITLE
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: "#000000"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = readLocaleCookie();
  const messages = await loadMessages(locale);
  return (
    <html lang={locale}>
      <body
        suppressHydrationWarning={true}
        className={`${inter.className} min-h-dvh bg-slate-50 text-slate-900`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LanguageProvider>
            <Providers>{children}</Providers>
          </LanguageProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

