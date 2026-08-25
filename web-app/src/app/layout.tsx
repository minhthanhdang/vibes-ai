import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TRPCReactProvider } from "@/trpc/react";
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
  title: "Vibes",
  description: "Browse references, analyze them, build a moodboard, ship the deck.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The workspace is a two-column tool, not a document: the shell is the
          viewport, and the surfaces inside it scroll on their own. Below 960px
          of height there is no room left for a gallery once the header and the
          uploader are paid for, so the shell keeps its size and the page
          scrolls instead. */}
      <body className="flex h-dvh min-h-[960px] flex-col">
        <TRPCReactProvider>
          {children}
        </TRPCReactProvider>
      </body>
    </html>
  );
}
