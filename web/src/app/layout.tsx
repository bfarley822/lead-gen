import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Offsite Event Discovery Bot",
  description: "AI-powered event discovery for Crumbl Cookies franchises",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 bg-card shadow-sm">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/crumbl-logo.svg"
                alt="Crumbl"
                width={100}
                height={20}
                className="h-5 w-auto"
                priority
              />
              <span className="text-lg font-bold tracking-tight text-foreground">
                Offsite Event Discovery Bot
              </span>
            </Link>
            <nav className="flex gap-1">
              <Link
                href="/"
                className="rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-light hover:text-accent"
              >
                Dashboard
              </Link>
              <Link
                href="/runs"
                className="rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-light hover:text-accent"
              >
                Runs
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
          {children}
        </main>
      </body>
    </html>
  );
}
