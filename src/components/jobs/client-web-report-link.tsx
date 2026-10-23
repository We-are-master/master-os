"use client";

import { useState } from "react";
import { Copy, ExternalLink, Check, Loader2, Globe } from "lucide-react";
import { toast } from "sonner";

/**
 * O report do cliente na web (/report/[token]): todas as fotos por cômodo e o PDF
 * como download. Só aparece com report gravado. O link é pedido ao servidor a
 * cada clique, porque o token é assinado com o segredo do ambiente que vai abrir.
 */
export function ClientWebReportLink({ jobId, hasReport }: { jobId: string; hasReport: boolean }) {
  const [estado, setEstado] = useState<"livre" | "carregando" | "copiado">("livre");
  if (!hasReport) return null;

  const pegarLink = async (): Promise<string | null> => {
    const res = await fetch(`/api/jobs/${jobId}/reports/web-link`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) {
      toast.error(body.error ?? "Could not get the report link");
      return null;
    }
    return body.url;
  };

  const copiar = async () => {
    setEstado("carregando");
    const url = await pegarLink();
    if (!url) return setEstado("livre");
    await navigator.clipboard.writeText(url).catch(() => null);
    setEstado("copiado");
    toast.success("Client report link copied");
    setTimeout(() => setEstado("livre"), 2000);
  };

  const abrir = async () => {
    const url = await pegarLink();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-[10px] p-[14px] flex items-center justify-between gap-3" style={{ background: "#F4F5FB", border: "0.5px solid #D8DBEE" }}>
      <div className="flex items-start gap-2 min-w-0">
        <Globe className="h-4 w-4 shrink-0 mt-[2px]" style={{ color: "#020040" }} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: "#020040" }}>Client web report</p>
          <p className="text-[11px]" style={{ color: "#6B6B70" }}>All photos by room, with the PDF as a download. The link the client gets.</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={copiar} disabled={estado === "carregando"} className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-[12px] py-[7px] text-[12px] font-semibold cursor-pointer disabled:opacity-60" style={{ background: "#020040", color: "#fff" }} aria-label="Copy client report link">
          {estado === "carregando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : estado === "copiado" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {estado === "copiado" ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={abrir} className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-[12px] py-[7px] text-[12px] font-semibold cursor-pointer" style={{ background: "#FFFFFF", color: "#020040", border: "0.5px solid #D8DBEE" }} aria-label="Open client report">
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </button>
      </div>
    </div>
  );
}
