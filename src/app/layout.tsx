import type { Metadata } from "next";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.name"),
  description: t("app.tagline"),
  robots: process.env.DEMO_MODE === "true" ? { index: false, follow: false } : undefined,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const demo = process.env.DEMO_MODE === "true";
  return (
    <html lang="pl">
      <body className="min-h-screen bg-white text-slate-900">
        {demo && (
          <div role="status" className="bg-amber-200 px-4 py-2 text-center text-sm font-medium">
            {t("demo.banner")}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
