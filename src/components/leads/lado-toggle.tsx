import Link from "next/link";
import { cn } from "@/lib/utils";

/** B2B | B2C no topo de Leads: a mesma tela, dois funis (dono, 11/10/2026). */
export function LadoToggle({ lado }: { lado: "b2b" | "b2c" }) {
  const item = (v: "b2b" | "b2c", rotulo: string) => (
    <Link
      href={`/crm?side=${v}`}
      aria-current={lado === v ? "page" : undefined}
      className={cn(
        "inline-flex h-7 items-center rounded-md px-3 text-[12px] font-semibold transition-colors",
        lado === v ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
      )}
    >
      {rotulo}
    </Link>
  );
  return (
    <nav aria-label="Lead type" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {item("b2c", "B2C")}
      {item("b2b", "B2B")}
    </nav>
  );
}
