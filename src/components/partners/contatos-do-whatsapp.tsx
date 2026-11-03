"use client";

/**
 * Os números do WhatsApp de operação (7983) ligados a este parceiro pela
 * /inbox. Desligar aqui faz a conversa voltar a ser um número sem cadastro;
 * o telefone do parceiro não muda.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Link2Off, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type Ligado = { contato: string; perfil: string | null; desde: string };

export function ContatosDoWhatsApp({ tipo, id, nome }: { tipo: "parceiro" | "cliente" | "conta" | "lead"; id: string; nome: string }) {
  const [lista, setLista] = useState<Ligado[] | null>(null);
  const [falta355, setFalta355] = useState(false);
  const [aDesligar, setADesligar] = useState<Ligado | null>(null);
  const [desligando, setDesligando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/inbox/vincular?tipo=${tipo}&id=${encodeURIComponent(id)}`);
    const j = (await r.json().catch(() => ({}))) as { contatos?: Ligado[]; falta355?: boolean };
    setLista(j.contatos ?? []);
    setFalta355(Boolean(j.falta355));
  }, [tipo, id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function desligar() {
    if (!aDesligar) return;
    setDesligando(true);
    try {
      const r = await fetch("/api/inbox/vincular", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contato: aDesligar.contato }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not unlink");
      toast.success(`+${aDesligar.contato} unlinked`);
      setADesligar(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unlink");
    } finally {
      setDesligando(false);
    }
  }

  return (
    <div className="space-y-3 p-4 sm:p-6">
      <div>
        <p className="text-sm font-semibold text-text-primary">Linked WhatsApp contacts</p>
        <p className="text-xs text-text-tertiary">Numbers linked to {nome} in the Operations inbox. Unlinking does not change their phone number.</p>
      </div>
      {lista === null ? (
        <p className="text-xs text-text-tertiary">Loading...</p>
      ) : falta355 ? (
        <p className="text-xs text-text-tertiary">Linking needs migration 355.</p>
      ) : !lista.length ? (
        <p className="rounded-xl border border-dashed border-border-light px-3 py-4 text-center text-xs text-text-tertiary">No linked contacts. Link a number from the inbox with “Who is this?”.</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-xl border border-border-light">
          {lista.map((l) => (
            <li key={l.contato} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-text-primary">{l.perfil ?? `+${l.contato}`}</p>
                <p className="truncate text-[11.5px] text-text-tertiary">
                  +{l.contato} · linked {new Date(l.desde).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <Link href={`/inbox?c=${l.contato}`} className="text-xs font-medium text-text-secondary hover:text-text-primary">
                Open chat
              </Link>
              <Button variant="outline" size="sm" type="button" onClick={() => setADesligar(l)}>
                <Link2Off className="h-3.5 w-3.5" />
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={aDesligar !== null}
        onClose={() => (desligando ? null : setADesligar(null))}
        title="Unlink this contact"
        subtitle={aDesligar ? `+${aDesligar.contato}${aDesligar.perfil ? ` · ${aDesligar.perfil}` : ""}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3 sm:px-6">
            <Button variant="outline" type="button" onClick={() => setADesligar(null)} disabled={desligando}>
              Cancel
            </Button>
            <Button variant="danger" type="button" onClick={() => void desligar()} disabled={desligando}>
              {desligando ? "Unlinking..." : "Unlink"}
            </Button>
          </div>
        }
      >
        <p className="px-4 py-4 text-[12.5px] text-text-secondary sm:px-6">
          The conversation goes back to an unknown number in the inbox. Messages stay, and nothing is sent.
        </p>
      </Modal>
    </div>
  );
}
