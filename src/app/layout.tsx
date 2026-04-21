import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        suppressHydrationWarning={true}
        className={`${inter.className} min-h-dvh bg-gray-50 text-gray-900`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

