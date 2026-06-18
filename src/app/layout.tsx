import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Event Tag Dictionary",
  description: "AI-powered event topic classification for your event database",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <div>
              <Link href="/" className="text-lg font-semibold tracking-tight text-stone-900">
                Event Tag Dictionary
              </Link>
              <p className="text-sm text-stone-500">Internal event topic classifier</p>
            </div>
            <SiteNav />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
