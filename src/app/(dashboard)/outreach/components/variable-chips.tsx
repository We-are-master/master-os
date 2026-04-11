"use client";

import { cn } from "@/lib/utils";

export const AVAILABLE_VARIABLES = [
  { key: "nome", label: "Nome do contato", description: "contact_name do partner" },
  { key: "empresa", label: "Nome da empresa", description: "company_name" },
  { key: "servico", label: "Tipo de serviço", description: "trade" },
  { key: "email", label: "E-mail", description: "endereço do destinatário" },
] as const;

interface VariableChipsProps {
  onInsert: (variable: string) => void;
  className?: string;
}

export function VariableChips({ onInsert, className }: VariableChipsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[11px] text-text-tertiary font-medium uppercase tracking-wide mr-1">
        Variáveis:
      </span>
      {AVAILABLE_VARIABLES.map((v) => (
        <button
          key={v.key}
          type="button"
          title={v.description}
          onClick={() => onInsert(`{{${v.key}}}`)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-md bg-primary/5 text-primary border border-primary/15 hover:bg-primary/10 transition-colors"
        >
          {`{{${v.key}}}`}
        </button>
      ))}
    </div>
  );
}
