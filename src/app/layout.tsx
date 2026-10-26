import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import "./globals.css";

/**
 * Fontes dentro do projeto (dono, 26/10/2026): com `next/font/google` o build baixava do
 * Google, e em 26/10 o Google devolveu um endereço que o Turbopack não lê e o deploy de
 * produção caiu. Mesmos pesos e o subconjunto latin de antes, em `src/app/fonts`.
 */
const inter = localFont({
  src: [
    { path: "./fonts/Inter-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Inter-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Inter-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Inter-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-inter",
});

/** Títulos e números grandes, igual ao site (getfixfy.com). */
const archivo = localFont({
  src: [
    { path: "./fonts/Archivo-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Archivo-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Archivo-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "Fixfy OS · Operations System",
  description: "Fixfy internal operations management system",
  // Favicon: src/app/icon.png (+ apple-icon.png) via App Router metadata.
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [{ url: "/fixfy-icon.png", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable}`} suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
