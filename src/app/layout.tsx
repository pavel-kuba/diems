import type { Metadata } from "next";
import "./globals.css";

// Type is the system stack (SF Pro on macOS) — set in globals.css.

export const metadata: Metadata = {
  title: "diems — monitoring station outreach",
  description: "Compose and send custom highlighted emails via Resend.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
