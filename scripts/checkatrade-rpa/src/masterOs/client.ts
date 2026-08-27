import type { RpaConfig } from "../config.js";
import type { CreateJobPayload, CreateLeadPayload, MasterOsCreateResponse } from "./types.js";

/** One person for POST /api/contacts/ingest — find-or-create on `clients`. */
export type ContactPayload = {
  name: string;
  email?: string;
  phone?: string;
  postcode?: string;
  address?: string;
  notes?: string;
};

export class MasterOsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Master OS API error ${status}: ${body}`);
  }
}

async function post(url: string, apiKey: string, payload: unknown): Promise<MasterOsCreateResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new MasterOsApiError(res.status, text);
  return JSON.parse(text) as MasterOsCreateResponse;
}

export type Preflight = { ok: boolean; detail: string };

export function createMasterOsClient(cfg: RpaConfig) {
  return {
    /**
     * Is Master OS ready to receive a job RIGHT NOW?
     *
     * Accepting a job on Checkatrade is financially binding and happens BEFORE
     * the job is written to the OS, so a dead destination means a job we owe
     * the customer and have no record of. There is no rollback. The dev server
     * this points at is a child process of the desktop app and has died
     * mid-run more than once, so this is a real failure mode, not a theoretical
     * one.
     *
     * Probes with a deliberately empty body against the real endpoint and key:
     *   400 → server up, route present, key accepted (it got as far as
     *         validating the payload) — the only healthy answer
     *   401 → reachable but our key is wrong (e.g. pointed at prod by mistake)
     *   anything else / throw → down, restarting, or broken
     */
    async preflight(): Promise<Preflight> {
      try {
        const res = await fetch(`${cfg.masterOs.baseUrl}/api/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-API-Key": cfg.env.masterOsJobApiKey },
          body: "{}",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 400) return { ok: true, detail: "reachable, key accepted" };
        if (res.status === 401) return { ok: false, detail: "reachable but API key was REJECTED (401)" };
        return { ok: false, detail: `unexpected status ${res.status}` };
      } catch (err) {
        return { ok: false, detail: `unreachable (${err instanceof Error ? err.message : String(err)})` };
      }
    },

    async createJob(payload: CreateJobPayload): Promise<MasterOsCreateResponse> {
      return post(`${cfg.masterOs.baseUrl}/api/jobs`, cfg.env.masterOsJobApiKey, payload);
    },
    /**
     * Find-or-create one person in the Master OS contact base (`clients`).
     * Used by BOTH paths: a lead is only ever a contact, and an accepted
     * Express job enriches its customer's row with the postcode/address that
     * POST /api/jobs doesn't store.
     */
    async upsertContact(contact: ContactPayload): Promise<MasterOsCreateResponse> {
      const res = await post(`${cfg.masterOs.baseUrl}/api/contacts/ingest`, cfg.env.masterOsLeadApiKey, {
        account_id: cfg.masterOs.accountId,
        contacts: [contact],
      });
      // The batch endpoint answers with a results array; normalise it to the
      // { id, reference } shape the rest of the RPA (and seen.json) expects.
      const first = (res as unknown as { results?: { id: string; action: string }[] }).results?.[0];
      return { id: first?.id ?? "", reference: first?.action ?? "ok" } as MasterOsCreateResponse;
    },

    /**
     * A Checkatrade "lead" is a chat enquiry — a person, not a booked job — so
     * it lands in the contact base. NOTE: /api/leads (the route this used to
     * call) no longer exists, and /api/leads/ingest is the unrelated Apify
     * cold-outbound pipeline; /api/contacts/ingest is the correct destination.
     */
    async createLead(payload: CreateLeadPayload): Promise<MasterOsCreateResponse> {
      return this.upsertContact({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        postcode: payload.postcode,
        address: payload.address,
        // O marcador `checkatrade-lead:<id>` fica: é ele que prova cobertura
        // em reconcile.ts. O resto da nota nunca nomeia a plataforma — o
        // parceiro e o escritório leem esse texto, e de onde o lead veio é
        // assunto nosso, não do job.
        notes: [
          payload.external_id ? `checkatrade-lead:${payload.external_id}` : null,
          `Enquiry — ${payload.service_type}`,
          payload.scope,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    },

    /**
     * O que falta concluir no Checkatrade, já com as fotos assinadas.
     *
     * A fila é derivada do estado do job no OS, não uma tabela onde se
     * enfileira: o job entra nela sozinho no instante em que o relatório é
     * validado, e sai quando o POST abaixo diz que concluiu. Por isso não há
     * nada a sincronizar dos dois lados.
     *
     * Vazio é a resposta normal e não é erro.
     */
    async filaDeConclusao(): Promise<FilaDeConclusao> {
      const res = await fetch(`${cfg.masterOs.baseUrl}/api/express/pending-completions`, {
        headers: { "X-API-Key": cfg.env.masterOsJobApiKey },
      });
      const text = await res.text();
      if (!res.ok) throw new MasterOsApiError(res.status, text);
      return JSON.parse(text) as FilaDeConclusao;
    },

    /**
     * Registra o resultado. O motivo importa tanto quanto o sucesso: é ele que
     * conta a tentativa do lado do OS, e são três antes de o job parar de
     * aparecer na fila e virar caso para uma pessoa.
     */
    async registrarConclusao(jobId: string, ok: boolean, motivo?: string): Promise<void> {
      const res = await fetch(`${cfg.masterOs.baseUrl}/api/express/pending-completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": cfg.env.masterOsJobApiKey },
        body: JSON.stringify({ jobId, ok, motivo }),
      });
      if (!res.ok) throw new MasterOsApiError(res.status, await res.text());
    },
  };
}

/** Uma linha da fila de conclusão do Express, como o OS a devolve. */
export type ItemDaFila = {
  jobId: string;
  reference: string;
  externalId: string;
  url: string;
  /** Certificado anexa documento; o resto anexa foto. São botões diferentes na tela deles. */
  ehCertificado: boolean;
  /** URLs assinadas, válidas por uma hora. */
  fotos: string[];
  /**
   * £ de material cobrado do cliente no report (report-material-extra). Depois
   * de concluir, é o valor do Request payment extra no portal. 0 = nada a pedir.
   */
  extraCobranca?: number;
};

export type FilaDeConclusao = { fila: ItemDaFila[]; total: number };

export type MasterOsClient = ReturnType<typeof createMasterOsClient>;
