import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/nox/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NOX AI — Intelligence in the Dark",
  description:
    "NOX AI is a sleek, futuristic AI assistant. Chat, create, and explore with an intelligence built for the night.",
  keywords: [
    "NOX AI",
    "AI assistant",
    "AI chat",
    "futuristic AI",
    "chatbot",
    "Next.js",
  ],
  authors: [{ name: "NOX AI" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "NOX AI — Intelligence in the Dark",
    description:
      "A sleek, futuristic AI assistant. Chat, create, and explore with NOX AI.",
    siteName: "NOX AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "NOX AI — Intelligence in the Dark",
    description:
      "A sleek, futuristic AI assistant. Chat, create, and explore with NOX AI.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
