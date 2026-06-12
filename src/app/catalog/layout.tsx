import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fixfy — Trades, prices & how we help",
  description: "Standard call-out and fixed prices for property maintenance, certificates and cleaning.",
  robots: { index: true, follow: true },
};

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen font-sans antialiased" style={{ fontFamily: "var(--font-geist, Geist, Inter, sans-serif)" }}>
      {children}
    </div>
  );
}
