"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { VariableChips } from "./variable-chips";
import { createTemplate, updateTemplate, type CreateTemplateInput } from "@/services/outreach";
import type { OutreachTemplate, OutreachTemplateCategory } from "@/types/outreach";
import type { Editor } from "@tiptap/react";

const CATEGORY_OPTIONS: { value: OutreachTemplateCategory; label: string }[] = [
  { value: "onboarding", label: "Onboarding" },
  { value: "follow_up", label: "Follow-up" },
  { value: "reactivation", label: "Reativação" },
  { value: "announcement", label: "Comunicado" },
  { value: "custom", label: "Outro" },
];

interface TemplateEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** When null, the modal is in "create" mode. Otherwise edits the given template. */
  template: OutreachTemplate | null;
  onSaved: (template: OutreachTemplate) => void;
}

export function TemplateEditorModal({ open, onClose, template, onSaved }: TemplateEditorModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<OutreachTemplateCategory | "">("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [subjectFocused, setSubjectFocused] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setCategory((template?.category as OutreachTemplateCategory) ?? "");
    setSubject(template?.subject ?? "");
    setBodyHtml(template?.body_html ?? "");
  }, [open, template]);

  const insertVariable = (variable: string) => {
    if (subjectFocused) {
      setSubject((s) => s + variable);
      return;
    }
    if (editor) {
      editor.chain().focus().insertContent(variable).run();
    } else {
      setBodyHtml((b) => b + variable);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao template");
    if (!subject.trim()) return toast.error("Assunto obrigatório");
    if (!bodyHtml.trim() || bodyHtml === "<p></p>") return toast.error("Corpo obrigatório");

    setSaving(true);
    try {
      const input: CreateTemplateInput = {
        name: name.trim(),
        category: category || null,
        subject: subject.trim(),
        body_html: bodyHtml,
      };
      const saved = template
        ? await updateTemplate(template.id, input)
        : await createTemplate(input);
      toast.success(template ? "Template atualizado" : "Template criado");
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? "Editar template" : "Novo template"}
      subtitle="Corpo aceita variáveis {{nome}}, {{empresa}}, {{servico}}, {{email}}"
      size="lg"
    >
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-3">
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
              Nome
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Boas-vindas a partners"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as OutreachTemplateCategory | "")}
              className="w-full h-9 px-2.5 text-sm rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">— nenhuma —</option>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
            Assunto
          </label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onFocus={() => setSubjectFocused(true)}
            onBlur={() => setSubjectFocused(false)}
            placeholder="Ex: Bem-vindo à rede Master, {{nome}}!"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
            Corpo
          </label>
          <VariableChips onInsert={insertVariable} className="mb-2" />
          <RichTextEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            onReady={setEditor}
            placeholder="Escreva o conteúdo do template..."
            minHeight={260}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {template ? "Salvar alterações" : "Criar template"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
