"use client";

import { Modal } from "@/components/ui/modal";
import { renderTemplate } from "@/lib/outreach/render-template";
import type { OutreachTemplateVars } from "@/types/outreach";

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  subject: string;
  bodyHtml: string;
  sampleVars: OutreachTemplateVars;
  sampleName: string;
}

export function PreviewModal({
  open,
  onClose,
  subject,
  bodyHtml,
  sampleVars,
  sampleName,
}: PreviewModalProps) {
  const renderedSubject = renderTemplate(subject, sampleVars);
  const renderedBody = renderTemplate(bodyHtml, sampleVars);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview do e-mail"
      subtitle={`Variáveis resolvidas com: ${sampleName}`}
      size="lg"
    >
      <div className="p-4 sm:p-6 space-y-4">
        <div>
          <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
            Assunto
          </div>
          <div className="text-sm font-medium text-text-primary">
            {renderedSubject || <span className="italic text-text-tertiary">(vazio)</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
            Corpo
          </div>
          <div className="rounded-lg border border-border-light bg-white text-stone-900 overflow-hidden">
            <div
              className="prose prose-sm max-w-none p-4"
              dangerouslySetInnerHTML={{ __html: renderedBody || "<p><em>(vazio)</em></p>" }}
            />
          </div>
        </div>
        <p className="text-[11px] text-text-tertiary">
          Este preview mostra apenas o corpo composto — no envio real, será envolvido no layout com
          logo e rodapé da empresa.
        </p>
      </div>
    </Modal>
  );
}
