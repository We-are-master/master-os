/**
 * Busca de contatos para "New conversation" da /inbox: contas, parceiros,
 * clientes e leads do site, por nome, empresa, postcode ou telefone. Devolve o
 * número já no formato do WhatsApp (só dígitos, com 44 no lugar do 0 do UK).
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { fixfyAccountId } from "@/lib/certificado/regra";

export const dynamic = "force-dynamic";

export type ContatoAchado = {
  tipo: "conta" | "parceiro" | "cliente" | "lead";
  id: string;
  nome: string;
  sub: string | null;
  /** Só dígitos, pronto para o envio. Null quando não há telefone no cadastro. */
  numero: string | null;
  postcode: string | null;
  /** A logo redonda antes do nome: a da conta (cliente: a conta a que ele pertence; sem conta, a Fixfy), a foto do parceiro. */
  logo: string | null;
  /** De quem é a logo, para o title. */
  logoDe: string | null;
};

/** O postcode UK dentro de um endereço ("..., London, SE7 8QP"). */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const postcodeDe = (...v: unknown[]): string | null => {
  for (const x of v) {
    const m = typeof x === "string" ? POSTCODE.exec(x) : null;
    if (m) return `${m[1]} ${m[2]}`.toUpperCase();
  }
  return null;
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

type LinhaDeParceiro = { id: unknown; company_name: unknown; contact_name: unknown; trade: unknown; whatsapp: unknown; phone: unknown; status: unknown };

/** Mesma empresa cadastrada duas vezes (um active e um onboarding) aparece uma vez só, o active primeiro. */
function umPorEmpresa<T extends LinhaDeParceiro>(linhas: T[]): T[] {
  const porEmpresa = new Map<string, T>();
  for (const p of [...linhas].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))) {
    const chave = String(p.company_name ?? "").trim().toLowerCase() || `id:${String(p.id)}`;
    if (!porEmpresa.has(chave)) porEmpresa.set(chave, p);
  }
  return [...porEmpresa.values()];
}

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
    s.sb.from("accounts").select("id, company_name, contact_name, contact_number, logo_url, address").or(ou(["company_name", "contact_name"], ["contact_number"])).limit(POR_TIPO),
    // Só quem trabalha ou está entrando; inactive e needs_attention ficam fora. O vínculo é pelo id,
    // então quando o onboarding vira active a conversa continua ligada.
    s.sb.from("partners").select("id, contact_name, company_name, trade, whatsapp, phone, status, avatar_url, coverage_base_postcode, partner_address").in("status", ["active", "onboarding"]).or(ou(["contact_name", "company_name"], ["whatsapp", "phone"])).limit(POR_TIPO),
    s.sb.from("clients").select("id, full_name, phone, postcode, address, source_account_id").is("deleted_at", null).or(ou(["full_name", "postcode"], ["phone"])).limit(POR_TIPO),
    s.sb.from("site_leads").select("id, full_name, phone, postcode, created_at").or(ou(["full_name", "postcode"], ["phone"])).order("created_at", { ascending: false }).limit(POR_TIPO),
  ]);

  // A conta de cada cliente achado (sem conta = cliente direto da Fixfy), para a logo.
  const fixfy = fixfyAccountId();
  const idsDeConta = [...new Set((clientes.data ?? []).map((c) => (c.source_account_id as string | null) || fixfy))];
  const { data: contasDosClientes } = idsDeConta.length
    ? await s.sb.from("accounts").select("id, company_name, logo_url").in("id", idsDeConta)
    : { data: [] as Record<string, unknown>[] };
  const contaPorId = new Map((contasDosClientes ?? []).map((a) => [a.id as string, a]));
  // Cliente sem postcode no cadastro: o do endereço do job mais recente dele.
  const semPostcode = (clientes.data ?? []).filter((c) => !postcodeDe(c.postcode, c.address)).map((c) => c.id as string);
  const postcodeDoJob = new Map<string, string>();
  if (semPostcode.length) {
    const { data: jobs } = await s.sb
      .from("jobs")
      .select("client_id, property_address")
      .in("client_id", semPostcode)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60);
    for (const j of jobs ?? []) {
      const pc = postcodeDe(j.property_address);
      if (pc && !postcodeDoJob.has(j.client_id as string)) postcodeDoJob.set(j.client_id as string, pc);
    }
  }

  const contatos: ContatoAchado[] = [
    ...(contas.data ?? []).map((a) => ({
      tipo: "conta" as const,
      id: a.id as string,
      nome: (a.contact_name as string | null) || (a.company_name as string | null) || "Account",
      sub: a.contact_name ? ((a.company_name as string | null) ?? null) : null,
      numero: paraWhatsApp(a.contact_number),
      postcode: postcodeDe(a.address),
      logo: (a.logo_url as string | null) ?? null,
      logoDe: (a.company_name as string | null) ?? null,
    })),
    ...umPorEmpresa(parceiros.data ?? []).map((p) => ({
      tipo: "parceiro" as const,
      id: p.id as string,
      // A empresa é o nome; quem atende vai embaixo, com o ofício.
      nome: (p.company_name as string | null) || (p.contact_name as string | null) || "Partner",
      sub: [p.company_name ? p.contact_name : null, p.trade].filter(Boolean).join(" · ") || null,
      numero: paraWhatsApp(p.whatsapp) ?? paraWhatsApp(p.phone),
      postcode: postcodeDe(p.coverage_base_postcode, p.partner_address),
      logo: (p.avatar_url as string | null) ?? null,
      logoDe: (p.company_name as string | null) ?? null,
    })),
    ...(clientes.data ?? []).map((c) => ({
      tipo: "cliente" as const,
      id: c.id as string,
      nome: (c.full_name as string | null) || "Client",
      sub: null,
      numero: paraWhatsApp(c.phone),
      postcode: postcodeDe(c.postcode, c.address) ?? postcodeDoJob.get(c.id as string) ?? null,
      ...(() => {
        const conta = contaPorId.get((c.source_account_id as string | null) || fixfy);
        return { logo: (conta?.logo_url as string | null) ?? null, logoDe: (conta?.company_name as string | null) ?? null };
      })(),
    })),
    ...(leads.data ?? []).map((l) => ({
      tipo: "lead" as const,
      id: l.id as string,
      nome: (l.full_name as string | null) || "Lead",
      sub: null,
      numero: paraWhatsApp(l.phone),
      postcode: postcodeDe(l.postcode),
      logo: null,
      logoDe: null,
    })),
  ];
  return NextResponse.json({ contatos, numero: dig.length >= 10 ? paraWhatsApp(dig) : null });
}
