import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VigilAI — AI VPS Monitoring",
  description:
    "Monitor your VPS fleet with threshold alerts and AI incident summaries.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
