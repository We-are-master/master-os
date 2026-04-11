"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Send,
  Eye,
  TestTube2,
  Plus,
  Copy,
  Pencil,
  Trash2,
  FileText,
  History,
  MailPlus,
  Users,
} from "lucide-react";

import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useProfile } from "@/hooks/use-profile";

import { listPartnersAll } from "@/services/partners";
import {
  listTemplates,
  listCampaigns,
  sendCampaign,
  deleteTemplate,
  duplicateTemplate,
} from "@/services/outreach";
import { partnerVars } from "@/lib/outreach/render-template";

import { PartnerMultiSelect } from "./components/partner-multi-select";
import { VariableChips } from "./components/variable-chips";
import { PreviewModal } from "./components/preview-modal";
import { TemplateEditorModal } from "./components/template-editor-modal";
import { HistoryDetailModal } from "./components/history-detail-modal";

import type { Partner } from "@/types/database";
import type {
  OutreachTemplate,
  OutreachCampaign,
  OutreachTemplateCategory,
} from "@/types/outreach";
import type { Editor } from "@tiptap/react";

type TabId = "compose" | "templates" | "history";

const CATEGORY_LABELS: Record<OutreachTemplateCategory, string> = {
  onboarding: "Onboarding",
  follow_up: "Follow-up",
  reactivation: "Reativação",
  announcement: "Comunicado",
  custom: "Outro",
};

const CATEGORY_VARIANTS: Record<OutreachTemplateCategory, "primary" | "info" | "warning" | "violet" | "default"> = {
  onboarding: "info",
  follow_up: "primary",
  reactivation: "warning",
  announcement: "violet",
  custom: "default",
};

export function OutreachClient() {
  const { profile, loading: profileLoading } = useProfile();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>("compose");

  // ─── Partners ────────────────────────────────────────────────────
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPartnersLoading(true);
    listPartnersAll({})
      .then((rows) => {
        if (!cancelled) setPartners(rows);
      })
      .catch((err) => {
        console.error("[outreach] partners load failed:", err);
        if (!cancelled) toast.error("Falha ao carregar partners");
      })
      .finally(() => {
        if (!cancelled) setPartnersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Templates ───────────────────────────────────────────────────
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [editorTemplate, setEditorTemplate] = useState<OutreachTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const rows = await listTemplates();
      setTemplates(rows);
    } catch (err) {
      console.error("[outreach] templates load failed:", err);
      toast.error("Falha ao carregar templates");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // ─── Campaigns (history) ─────────────────────────────────────────
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [historyCampaignId, setHistoryCampaignId] = useState<string | null>(null);
  const campaignsLoaded = useRef(false);

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const { campaigns: rows } = await listCampaigns(100, 0);
      setCampaigns(rows);
      campaignsLoaded.current = true;
    } catch (err) {
      console.error("[outreach] campaigns load failed:", err);
      toast.error("Falha ao carregar histórico");
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history" && !campaignsLoaded.current) {
      void loadCampaigns();
    }
  }, [activeTab, loadCampaigns]);

  // ─── Compose state ───────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [externalEmailsInput, setExternalEmailsInput] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subjectFocused, setSubjectFocused] = useState(false);
  const [composeEditor, setComposeEditor] = useState<Editor | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Deep link: /outreach?partnerIds=a,b,c → preselect
  useEffect(() => {
    const raw = searchParams?.get("partnerIds");
    if (!raw) return;
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setSelectedPartnerIds(new Set(ids));
    setActiveTab("compose");
    // Strip query param so a refresh doesn't re-apply
    router.replace("/outreach");
  }, [searchParams, router]);

  const parsedExternalEmails = useMemo(
    () =>
      externalEmailsInput
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [externalEmailsInput],
  );

  const totalRecipients = selectedPartnerIds.size + parsedExternalEmails.length;

  const insertVariable = (variable: string) => {
    if (subjectFocused) {
      setSubject((s) => s + variable);
      return;
    }
    if (composeEditor) {
      composeEditor.chain().focus().insertContent(variable).run();
    } else {
      setBodyHtml((b) => b + variable);
    }
  };

  const applyTemplate = (tpl: OutreachTemplate) => {
    setSubject(tpl.subject);
    setBodyHtml(tpl.body_html);
    setTemplateId(tpl.id);
    toast.success(`Template "${tpl.name}" carregado`);
  };

  const clearCompose = () => {
    setSubject("");
    setBodyHtml("");
    setSelectedPartnerIds(new Set());
    setExternalEmailsInput("");
    setTemplateId(null);
  };

  const sampleRecipient = useMemo(() => {
    const firstSelected = partners.find((p) => selectedPartnerIds.has(p.id));
    if (firstSelected) {
      return {
        name: firstSelected.contact_name ?? firstSelected.company_name,
        vars: partnerVars(firstSelected),
      };
    }
    return {
      name: "Amostra",
      vars: { nome: "João", empresa: "Empresa Exemplo", servico: "pintura", email: "contato@exemplo.com" },
    };
  }, [partners, selectedPartnerIds]);

  const handleSend = async () => {
    if (!subject.trim()) return toast.error("Assunto obrigatório");
    if (!bodyHtml.trim() || bodyHtml === "<p></p>") return toast.error("Corpo obrigatório");
    if (totalRecipients === 0) return toast.error("Selecione ao menos um destinatário");

    const confirm = window.confirm(
      `Enviar para ${totalRecipients} destinatário${totalRecipients > 1 ? "s" : ""}?`,
    );
    if (!confirm) return;

    setSending(true);
    try {
      const result = await sendCampaign({
        subject,
        bodyHtml,
        recipients: {
          partnerIds: Array.from(selectedPartnerIds),
          externalEmails: parsedExternalEmails,
        },
        templateId: templateId ?? undefined,
      });
      const sentCount = result.sent ?? 0;
      const failed = result.failed ?? 0;
      if (failed === 0) {
        toast.success(`Enviado com sucesso para ${sentCount} destinatário${sentCount > 1 ? "s" : ""}`);
      } else {
        toast.warning(`Enviado: ${sentCount} · Falharam: ${failed}`);
      }
      if (result.skipped && result.skipped.length > 0) {
        toast.message(`${result.skipped.length} destinatários ignorados (sem e-mail ou inválidos)`);
      }
      clearCompose();
      campaignsLoaded.current = false; // force reload next time history tab opens
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  };

  const handleTestSend = async () => {
    if (!subject.trim()) return toast.error("Assunto obrigatório");
    if (!bodyHtml.trim() || bodyHtml === "<p></p>") return toast.error("Corpo obrigatório");

    setTestSending(true);
    try {
      const result = await sendCampaign({
        subject,
        bodyHtml,
        recipients: {
          partnerIds: Array.from(selectedPartnerIds),
          externalEmails: parsedExternalEmails,
        },
        templateId: templateId ?? undefined,
        testMode: true,
      });
      toast.success(`Teste enviado para ${result.sentTo ?? "seu e-mail"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no envio de teste");
    } finally {
      setTestSending(false);
    }
  };

  // ─── Access gate ─────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-tertiary">
        Carregando...
      </div>
    );
  }
  if (profile?.role !== "admin") {
    return (
      <Card className="p-8 max-w-md mx-auto text-center">
        <h2 className="text-base font-semibold text-text-primary">Acesso restrito</h2>
        <p className="text-sm text-text-secondary mt-2">
          A área de outreach é exclusiva para administradores.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Outreach</h1>
          <p className="text-sm text-text-secondary">
            Envie e-mails personalizados para partners e contatos externos.
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "compose", label: "Compor", count: totalRecipients || undefined },
          { id: "templates", label: "Templates", count: templates.length || undefined },
          { id: "history", label: "Histórico", count: campaigns.length || undefined },
        ]}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      {activeTab === "compose" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
          {/* ─── Left column: composer ─── */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
                Template
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={templateId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setTemplateId(null);
                      return;
                    }
                    const tpl = templates.find((t) => t.id === id);
                    if (tpl) applyTemplate(tpl);
                  }}
                  className="flex-1 min-w-[200px] h-9 px-2.5 text-sm rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-primary/15"
                >
                  <option value="">— nenhum —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.category ? ` · ${CATEGORY_LABELS[t.category]}` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    setEditorTemplate(null);
                    setEditorOpen(true);
                  }}
                >
                  Novo template
                </Button>
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
                placeholder="Ex: Novidades para você, {{nome}}!"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
                  Corpo
                </label>
              </div>
              <VariableChips onInsert={insertVariable} className="mb-2" />
              <RichTextEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                onReady={setComposeEditor}
                placeholder="Escreva o conteúdo do e-mail..."
                minHeight={280}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                icon={<Eye className="h-4 w-4" />}
                onClick={() => setPreviewOpen(true)}
              >
                Preview
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<TestTube2 className="h-4 w-4" />}
                onClick={handleTestSend}
                loading={testSending}
              >
                Enviar teste
              </Button>
              <Button
                icon={<Send className="h-4 w-4" />}
                onClick={handleSend}
                loading={sending}
                disabled={totalRecipients === 0}
              >
                Enviar ({totalRecipients})
              </Button>
            </div>
          </Card>

          {/* ─── Right column: recipients ─── */}
          <Card className="p-4 sm:p-5 space-y-4 h-fit">
            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1 flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                Partners
              </label>
              <PartnerMultiSelect
                partners={partners}
                selectedIds={selectedPartnerIds}
                onChange={setSelectedPartnerIds}
                loading={partnersLoading}
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1 flex items-center gap-1.5">
                <MailPlus className="h-3 w-3" />
                E-mails externos
              </label>
              <textarea
                value={externalEmailsInput}
                onChange={(e) => setExternalEmailsInput(e.target.value)}
                placeholder="nome@exemplo.com, outro@dominio.com"
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-y"
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                Separe por vírgula ou nova linha.
              </p>
              {parsedExternalEmails.length > 0 && (
                <p className="text-[11px] text-text-secondary mt-1">
                  {parsedExternalEmails.length} e-mail{parsedExternalEmails.length > 1 ? "s" : ""} externo{parsedExternalEmails.length > 1 ? "s" : ""}
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-border-light">
              <div className="text-[11px] text-text-tertiary mb-1">Total</div>
              <div className="text-2xl font-semibold text-text-primary">
                {totalRecipients}{" "}
                <span className="text-xs font-normal text-text-tertiary">
                  destinatário{totalRecipients === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "templates" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-text-secondary">
              {templatesLoading ? "Carregando..." : `${templates.length} template${templates.length === 1 ? "" : "s"}`}
            </div>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditorTemplate(null);
                setEditorOpen(true);
              }}
            >
              Novo template
            </Button>
          </div>

          {!templatesLoading && templates.length === 0 && (
            <Card className="p-10 text-center">
              <FileText className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">
                Nenhum template criado. Comece clicando em &ldquo;Novo template&rdquo;.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => (
              <Card key={t.id} className="p-4 flex flex-col gap-2 hover:border-border transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary truncate">{t.name}</div>
                    <div className="text-xs text-text-tertiary truncate">{t.subject}</div>
                  </div>
                  {t.category && (
                    <Badge variant={CATEGORY_VARIANTS[t.category]} size="sm">
                      {CATEGORY_LABELS[t.category]}
                    </Badge>
                  )}
                </div>
                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map((v) => (
                      <span
                        key={v}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/5 text-primary"
                      >
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-text-tertiary mt-auto">
                  Atualizado em {format(new Date(t.updated_at), "dd/MM/yyyy")}
                </div>
                <div className="flex items-center gap-1 pt-2 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() => {
                      applyTemplate(t);
                      setActiveTab("compose");
                    }}
                    className="flex-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Usar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditorTemplate(t);
                      setEditorOpen(true);
                    }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-surface-tertiary text-text-secondary"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const dup = await duplicateTemplate(t.id);
                        setTemplates((arr) => [dup, ...arr]);
                        toast.success("Template duplicado");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Falha ao duplicar");
                      }
                    }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-surface-tertiary text-text-secondary"
                    title="Duplicar"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Excluir o template "${t.name}"?`)) return;
                      try {
                        await deleteTemplate(t.id);
                        setTemplates((arr) => arr.filter((x) => x.id !== t.id));
                        toast.success("Template excluído");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Falha ao excluir");
                      }
                    }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-red-500"
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <Card className="overflow-hidden">
          {campaignsLoading && (
            <div className="p-10 text-center text-sm text-text-tertiary">Carregando...</div>
          )}
          {!campaignsLoading && campaigns.length === 0 && (
            <div className="p-10 text-center">
              <History className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">Nenhuma campanha enviada ainda.</p>
            </div>
          )}
          {!campaignsLoading && campaigns.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary/70">
                  <tr className="text-left text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
                    <th className="px-4 py-2.5">Data</th>
                    <th className="px-4 py-2.5">Assunto</th>
                    <th className="px-4 py-2.5">Enviado por</th>
                    <th className="px-4 py-2.5 text-right">Destinatários</th>
                    <th className="px-4 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setHistoryCampaignId(c.id)}
                      className="border-t border-border-light hover:bg-surface-hover cursor-pointer"
                    >
                      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                        {format(new Date(c.sent_at), "dd/MM HH:mm")}
                      </td>
                      <td className="px-4 py-2.5 text-text-primary font-medium truncate max-w-[300px]">
                        {c.subject}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary truncate">
                        {c.sent_by_name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {c.recipient_count}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge
                          variant={
                            c.status === "sent"
                              ? "success"
                              : c.status === "partial"
                                ? "warning"
                                : c.status === "failed"
                                  ? "danger"
                                  : "default"
                          }
                          size="sm"
                        >
                          {c.status === "sent"
                            ? "Enviada"
                            : c.status === "partial"
                              ? "Parcial"
                              : c.status === "failed"
                                ? "Falhou"
                                : c.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        subject={subject}
        bodyHtml={bodyHtml}
        sampleVars={sampleRecipient.vars}
        sampleName={sampleRecipient.name ?? "Amostra"}
      />

      <TemplateEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        template={editorTemplate}
        onSaved={(saved) => {
          setTemplates((arr) => {
            const idx = arr.findIndex((t) => t.id === saved.id);
            if (idx === -1) return [saved, ...arr];
            const next = [...arr];
            next[idx] = saved;
            return next;
          });
        }}
      />

      <HistoryDetailModal
        open={historyCampaignId !== null}
        onClose={() => setHistoryCampaignId(null)}
        campaignId={historyCampaignId}
      />
    </div>
  );
}
