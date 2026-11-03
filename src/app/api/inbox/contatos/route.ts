/**
 * Busca de contatos para "New conversation" da /inbox: contas, parceiros,
 * clientes e leads do site, por nome, empresa, postcode ou telefone. Devolve o
 * número já no formato do WhatsApp (só dígitos, com 44 no lugar do 0 do UK).
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";

export const dynamic = "force-dynamic";

export type ContatoAchado = {
  tipo: "conta" | "parceiro" | "cliente" | "lead";
  id: string;
  nome: string;
  sub: string | null;
  /** Só dígitos, pronto para o envio. Null quando não há telefone no cadastro. */
  numero: string | null;
};

/** "07123 456789" e "+44 7123..." viram "447123456789". */
function paraWhatsApp(bruto: unknown): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0") && d.length === 11) return `44${d.slice(1)}`;
  if (d.startsWith("00")) return d.slice(2);
  return d.length >= 10 ? d : null;
}

const POR_TIPO = 6;

export async function GET(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  // Vírgula e parênteses quebram o filtro `or` do PostgREST.
  const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/[,()*%]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ contatos: [] });
  const dig = q.replace(/\D/g, "");
  const tel = dig.length >= 4 ? dig.replace(/^0/, "").slice(-9) : null;
  const like = `%${q}%`;
  const ou = (nomes: string[], fones: string[]) => [...nomes.map((c) => `${c}.ilike.${like}`), ...(tel ? fones.map((c) => `${c}.ilike.%${tel}%`) : [])].join(",");

  const [contas, parceiros, clientes, leads] = await Promise.all([
    s.sb.from("accounts").select("id, company_name, contact_name, contact_number").or(ou(["company_name", "contact_name"], ["contact_number"])).limit(POR_TIPO),
    s.sb.from("partners").select("id, contact_name, company_name, trade, whatsapp, phone").or(ou(["contact_name", "company_name"], ["whatsapp", "phone"])).limit(POR_TIPO),
    s.sb.from("clients").select("id, full_name, phone, postcode").is("deleted_at", null).or(ou(["full_name", "postcode"], ["phone"])).limit(POR_TIPO),
    s.sb.from("site_leads").select("id, full_name, phone, postcode, created_at").or(ou(["full_name", "postcode"], ["phone"])).order("created_at", { ascending: false }).limit(POR_TIPO),
  ]);

  const contatos: ContatoAchado[] = [
    ...(contas.data ?? []).map((a) => ({
      tipo: "conta" as const,
      id: a.id as string,
      nome: (a.contact_name as string | null) || (a.company_name as string | null) || "Account",
      sub: a.contact_name ? ((a.company_name as string | null) ?? null) : null,
      numero: paraWhatsApp(a.contact_number),
    })),
    ...(parceiros.data ?? []).map((p) => ({
      tipo: "parceiro" as const,
      id: p.id as string,
      nome: (p.contact_name as string | null) || (p.company_name as string | null) || "Partner",
      sub: [p.company_name, p.trade].filter(Boolean).join(" · ") || null,
      numero: paraWhatsApp(p.whatsapp) ?? paraWhatsApp(p.phone),
    })),
    ...(clientes.data ?? []).map((c) => ({
      tipo: "cliente" as const,
      id: c.id as string,
      nome: (c.full_name as string | null) || "Client",
      sub: (c.postcode as string | null) ?? null,
      numero: paraWhatsApp(c.phone),
    })),
    ...(leads.data ?? []).map((l) => ({
      tipo: "lead" as const,
      id: l.id as string,
      nome: (l.full_name as string | null) || "Lead",
      sub: (l.postcode as string | null) ?? null,
      numero: paraWhatsApp(l.phone),
    })),
  ];
  return NextResponse.json({ contatos, numero: dig.length >= 10 ? paraWhatsApp(dig) : null });
}
