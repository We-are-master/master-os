"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocRulesGroup, type DocRuleRow } from "@/components/settings/doc-rules-group";
import { FieldRulesGroup, type FieldRuleRow } from "@/components/settings/field-rules-group";
import { getCompanySettings, updateCompanySettings } from "@/services/company";
import { mergeFrontendSetup, parseFrontendSetup, resolvePartnerDocumentRules, resolvePartnerRegistrationRules } from "@/lib/frontend-setup";
import {
  computeMandatoryComplianceScoreTotal,
  computeRegistrationComplianceScoreLabels,
} from "@/lib/partner-registration-compliance-score";
import {
  getPartnerRegistrationCatalogForSetup,
  mergePartnerRegistrationRules,
  type PartnerRegistrationRuleRow,
} from "@/lib/partner-registration-fields";
import { getPartnerDocumentCatalogForSetup, mergePartnerDocumentRules, type PartnerDocRuleRow } from "@/lib/partner-required-docs";
import { toast } from "sonner";

/** Org-level partner registration + document rules — Settings → Setup → Partners. */
export function PartnerRegistrationConfigPanel({ canEdit = true }: { canEdit?: boolean }) {
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [rawSetup, setRawSetup] = useState<unknown>(null);
  const [fieldRules, setFieldRules] = useState<PartnerRegistrationRuleRow[]>(() => mergePartnerRegistrationRules(null));
  const [docRules, setDocRules] = useState<PartnerDocRuleRow[]>(() => mergePartnerDocumentRules(null));
  const [tradeCertsExpanded, setTradeCertsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await getCompanySettings();
      setSettingsId(row?.id ?? null);
      setRawSetup(row?.frontend_setup ?? null);
      const parsed = parseFrontendSetup(row?.frontend_setup);
      setFieldRules(resolvePartnerRegistrationRules(parsed));
      setDocRules(resolvePartnerDocumentRules(parsed));
    } catch {
      toast.error("Couldn't load registration settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const next = mergeFrontendSetup(rawSetup, {
        partner_registration_rules: fieldRules,
        partner_document_rules: docRules,
      });
      if (!settingsId) {
        const created = await updateCompanySettings({
          company_name: "My Company",
          address: "",
          phone: "",
          email: "",
          frontend_setup: next,
        });
        setSettingsId(created.id);
      } else {
        await updateCompanySettings({ frontend_setup: next });
      }
      setRawSetup(next);
      setFieldRules(resolvePartnerRegistrationRules(next));
      setDocRules(resolvePartnerDocumentRules(next));
      window.dispatchEvent(new Event("master-os-company-settings"));
      toast.success("Registration rules saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save registration rules.");
    } finally {
      setSaving(false);
    }
  };

  const profileFields = getPartnerRegistrationCatalogForSetup().filter((f) => f.group === "profile");
  const onboardingFields = getPartnerRegistrationCatalogForSetup().filter((f) => f.group === "onboarding_step");
  const agreementFields = getPartnerRegistrationCatalogForSetup().filter((f) => f.group === "agreement");

  const complianceScores = useMemo(
    () => computeRegistrationComplianceScoreLabels({ fieldRules, docRules }),
    [fieldRules, docRules],
  );
  const mandatoryScoreTotal = useMemo(
    () => computeMandatoryComplianceScoreTotal({ fieldRules, docRules }),
    [fieldRules, docRules],
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-border-light bg-card p-6 flex items-center gap-2 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading registration settings…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-light bg-card p-4 sm:p-5 space-y-5">
      <div>
        <p className="text-sm font-semibold text-text-primary">Partner registration</p>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed max-w-2xl">
          Org-wide rules for Trade Portal onboarding (<code className="text-[11px]">/get-started</code>, in-app wizard,
          and Settings). Hidden fields are removed everywhere. Mandatory fields count toward compliance and block funnel
          completion when missing.{" "}
          <span className="text-text-tertiary">
            Score = approximate share of the partner compliance % (profile 33% + documents 52%; up to{" "}
            <strong className="font-medium text-text-secondary">{mandatoryScoreTotal}%</strong> from mandatory items
            below).
          </span>
        </p>
      </div>

      <FieldRulesGroup
        title="Profile & account"
        entries={profileFields}
        rules={fieldRules as FieldRuleRow[]}
        scores={complianceScores.fields}
        canEdit={canEdit}
        onPatch={(id, patch) => {
          setFieldRules((prev) =>
            prev.map((r) => {
              if (r.id !== id) return r;
              const visible = patch.visible ?? r.visible;
              return {
                ...r,
                visible,
                mandatory: visible ? (patch.mandatory ?? r.mandatory) : false,
              };
            }),
          );
        }}
      />

      <FieldRulesGroup
        title="Onboarding steps"
        entries={onboardingFields}
        rules={fieldRules as FieldRuleRow[]}
        scores={complianceScores.fields}
        canEdit={canEdit}
        onPatch={(id, patch) => {
          setFieldRules((prev) =>
            prev.map((r) => {
              if (r.id !== id) return r;
              const visible = patch.visible ?? r.visible;
              return {
                ...r,
                visible,
                mandatory: visible ? (patch.mandatory ?? r.mandatory) : false,
              };
            }),
          );
        }}
      />

      <FieldRulesGroup
        title="Agreements"
        entries={agreementFields}
        rules={fieldRules as FieldRuleRow[]}
        scores={complianceScores.fields}
        canEdit={canEdit}
        onPatch={(id, patch) => {
          setFieldRules((prev) =>
            prev.map((r) => {
              if (r.id !== id) return r;
              const visible = patch.visible ?? r.visible;
              return {
                ...r,
                visible,
                mandatory: visible ? (patch.mandatory ?? r.mandatory) : false,
              };
            }),
          );
        }}
      />

      <DocRulesGroup
        title="Documents"
        entries={getPartnerDocumentCatalogForSetup().filter((e) => ["core", "utr", "legal", "agreement"].includes(e.group))}
        rules={docRules as DocRuleRow[]}
        scores={complianceScores.documents}
        canEdit={canEdit}
        onPatch={(id, patch) => {
          setDocRules((prev) =>
            prev.map((r) => {
              if (r.id !== id) return r;
              const enabled = patch.enabled ?? r.enabled;
              return {
                ...r,
                enabled,
                mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
              };
            }),
          );
        }}
      />

      <div>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border-light bg-card px-3 py-2.5 text-left hover:bg-surface-hover/80 transition-colors text-sm font-medium text-text-primary"
          onClick={() => setTradeCertsExpanded((v) => !v)}
        >
          Trade certificates
          <span className="text-text-tertiary text-xs">{tradeCertsExpanded ? "Hide" : "Show"}</span>
        </button>
        {tradeCertsExpanded ? (
          <div className="mt-3">
            <DocRulesGroup
              title=""
              entries={getPartnerDocumentCatalogForSetup().filter((e) => e.group === "trade_cert")}
              rules={docRules as DocRuleRow[]}
              scores={complianceScores.documents}
              canEdit={canEdit}
              onPatch={(id, patch) => {
                setDocRules((prev) =>
                  prev.map((r) => {
                    if (r.id !== id) return r;
                    const enabled = patch.enabled ?? r.enabled;
                    return {
                      ...r,
                      enabled,
                      mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
                    };
                  }),
                );
              }}
            />
          </div>
        ) : null}
      </div>

      <DocRulesGroup
        title="Optional extras"
        entries={getPartnerDocumentCatalogForSetup().filter((e) => e.group === "extra")}
        rules={docRules as DocRuleRow[]}
        scores={complianceScores.documents}
        canEdit={canEdit}
        onPatch={(id, patch) => {
          setDocRules((prev) =>
            prev.map((r) => {
              if (r.id !== id) return r;
              const enabled = patch.enabled ?? r.enabled;
              return {
                ...r,
                enabled,
                mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
              };
            }),
          );
        }}
      />

      <Button
        type="button"
        onClick={() => void save()}
        disabled={!canEdit || saving}
        icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
      >
        {saving ? "Saving…" : "Save registration rules"}
      </Button>
    </div>
  );
}
