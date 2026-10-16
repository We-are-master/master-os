/**
 * Os segmentos de marketing, e a única porta para resolvê-los.
 *
 * Um segmento é uma pergunta ("quem é B2B no sul de Londres e já comprou?")
 * que devolve destinatários JÁ FILTRADOS por três travas, nesta ordem:
 *
 *   1. `deleted_at is null`      — o apagar reversível do próprio OS
 *   2. tag `no-marketing`        — plataforma, fornecedor, concorrente, teste
 *   3. lista de bloqueio         — quem pediu para sair, marcou spam ou rejeitou
 *
 * Quem chama nunca filtra por conta própria. Se um dia alguém escrever uma
 * consulta nova e esquecer uma das três, manda campanha para quem pediu para
 * sair — e aí não é um e-mail que se perde, é o domínio.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { bloqueados, normalizarEmail } from "./suppressions";

/** Provedores de e-mail pessoal. Quem não está aqui, e tem domínio, é B2B. */
const PESSOAL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "mac.com",
  "aol.com", "aol.co.uk", "btinternet.com", "btopenworld.com", "sky.com", "virginmedia.com",
  "talktalk.net", "ntlworld.com", "blueyonder.co.uk", "msn.com", "protonmail.com", "proton.me",
  "gmx.com", "mail.com", "yandex.com", "zoho.com", "rocketmail.com", "ymail.com", "tiscali.co.uk",
  "fastmail.com", "hey.com", "email.com", "o2.co.uk", "web.de", "gmail.con", "gmial.com",
  /**
   * Relay da Apple e do DuckDuckGo ENTREGAM: encaminham para a caixa real da
   * pessoa. São gente, e gente física — B2C, nunca lixo. Errei isto uma vez em
   * 14/09/2026 e quase removi 50 contatos bons da base.
   */
  "privaterelay.appleid.com", "duck.com",
  /** E-mail do trabalho usado para serviço de casa. O comprador é a pessoa, não o hospital. */
  "nhs.net", "doctors.org.uk",
]);

export type Segmento = "b2b" | "b2c" | "phone_only" | "todos";

export type AreaLondres = "sul" | "leste" | "norte" | "oeste" | "fora_m25";

/** Prefixos de postcode por área, na divisão que os parceiros de fato cobrem. */
const AREAS: Record<AreaLondres, string[]> = {
  sul: ["SE", "SW"],
  leste: ["E"],
  norte: ["N", "NW"],
  oeste: ["W", "WC", "EC"],
  fora_m25: ["BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
};

export type Destinatario = {
  clientId: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  postcode: string | null;
  jaComprou: boolean;
  segmento: Exclude<Segmento, "todos">;
  area: AreaLondres | null;
};

export type FiltroSegmento = {
  segmento: Segmento;
  /** Só quem já fez pelo menos um job conosco. O grupo mais quente que existe. */
  apenasCompradores?: boolean;
  areas?: AreaLondres[];
  /** Teto de destinatários. Existe para campanha de WhatsApp, que vai em lotes à mão. */
  limite?: number;
};

export function areaDoPostcode(postcode: string | null | undefined): AreaLondres | null {
  const p = String(postcode ?? "").toUpperCase().replace(/\s+/g, "");
  const prefixo = p.match(/^([A-Z]{1,2})/)?.[1];
  if (!prefixo) return null;
  for (const [area, prefixos] of Object.entries(AREAS) as Array<[AreaLondres, string[]]>) {
    if (prefixos.includes(prefixo)) return area;
  }
  return null;
}

export function segmentoDoEmail(email: string | null | undefined): "b2b" | "b2c" | null {
  const e = normalizarEmail(email);
  if (!e) return null;
  const dominio = e.split("@")[1] ?? "";
  return PESSOAL.has(dominio) ? "b2c" : "b2b";
}

/** Telefone utilizável: dez dígitos ou mais depois de tirar tudo que não é número. */
export function telefoneValido(telefone: string | null | undefined): boolean {
  return String(telefone ?? "").replace(/\D/g, "").length >= 10;
}

export async function resolverSegmento(filtro: FiltroSegmento): Promise<Destinatario[]> {
  const sb = createServiceClient();

  let q = sb
    .from("clients")
    .select("id, full_name, email, phone, postcode, jobs_count, tags")
    .is("deleted_at", null);
  if (filtro.apenasCompradores) q = q.gt("jobs_count", 0);

  const { data, error } = await q.limit(10000);
  if (error) throw new Error(`segmento: ${error.message}`);

  const candidatos: Destinatario[] = [];
  for (const c of data ?? []) {
    // Trava 2: a tag manda, e manda antes de qualquer outra coisa.
    const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
    if (tags.includes("no-marketing")) continue;

    const email = normalizarEmail(c.email as string);
    const temTel = telefoneValido(c.phone as string);
    const seg = email ? segmentoDoEmail(email)! : temTel ? "phone_only" : null;
    if (!seg) continue; // sem e-mail e sem telefone: inalcançável

    if (filtro.segmento !== "todos" && filtro.segmento !== seg) continue;

    const area = areaDoPostcode(c.postcode as string);
    if (filtro.areas?.length && (!area || !filtro.areas.includes(area))) continue;

    candidatos.push({
      clientId: c.id as string,
      nome: (c.full_name as string) ?? null,
      email,
      telefone: temTel ? (c.phone as string) : null,
      postcode: (c.postcode as string) ?? null,
      jaComprou: Number(c.jobs_count ?? 0) > 0,
      segmento: seg as Exclude<Segmento, "todos">,
      area,
    });
  }

  // Trava 3: a lista de bloqueio, num só ida e volta ao banco.
  const comEmail = candidatos.filter((d) => d.email).map((d) => d.email!);
  const barrados = await bloqueados(comEmail);
  const limpos = candidatos.filter((d) => !d.email || !barrados.has(d.email));

  /**
   * Quem já comprou primeiro, sempre.
   *
   * Campanha de WhatsApp sai em lote de cem por dia, e a ordem decide quem
   * recebe hoje e quem recebe em três semanas. Cliente que já pagou converte
   * muito mais que contato que nunca comprou, então ele nunca pode ficar no
   * fim da fila por acidente de ordenação.
   */
  limpos.sort((a, b) => Number(b.jaComprou) - Number(a.jaComprou));

  return filtro.limite ? limpos.slice(0, filtro.limite) : limpos;
}

/** Contagem por segmento, para o painel e para conferir antes de disparar. */
export async function contarSegmentos(): Promise<
  Record<"b2b" | "b2c" | "phone_only", { total: number; comEmail: number; comTelefone: number; compradores: number }>
> {
  const todos = await resolverSegmento({ segmento: "todos" });
  const vazio = () => ({ total: 0, comEmail: 0, comTelefone: 0, compradores: 0 });
  const out = { b2b: vazio(), b2c: vazio(), phone_only: vazio() };
  for (const d of todos) {
    const b = out[d.segmento];
    b.total++;
    if (d.email) b.comEmail++;
    if (d.telefone) b.comTelefone++;
    if (d.jaComprou) b.compradores++;
  }
  return out;
}
