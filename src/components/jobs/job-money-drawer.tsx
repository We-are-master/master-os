"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogAddonChargeOption } from "@/lib/catalog-line-pricing";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOptionGroup } from "@/components/ui/select";
import type { Invoice, JobPaymentMethod } from "@/types/database";
import { cn, formatCurrency } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { Copy, ExternalLink, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { PARTNER_PAY_LEDGER_LABEL_OPTIONS } from "@/lib/partner-pay-record";
import { isJobExtraDiscountExtraType } from "@/lib/job-extra-discount";
import { parseMoneyInput } from "@/lib/parse-money-input";
import {
  isPartnerCancellationFeeExtraType,
  partnerAddOnlySelectOptions,
  partnerPresetSelectOptions,
  type PartnerExtraPresetRow,
} from "@/lib/partner-extra-presets";

const LS_CLIENT = "mos-job-money-method-client";
const LS_PARTNER = "mos-job-money-method-partner";

const EPS = 0.02;

export type JobMoneyDrawerFlow = "client_pay" | "client_extra" | "partner_pay" | "partner_extra";

export type ClientPayApplyAs = "deposit" | "final";

export type JobMoneySubmitPayload = {
  flow: JobMoneyDrawerFlow;
  amount: number;
  paymentDate: string;
  method: JobPaymentMethod;
  note: string;
  /** For extra flows: mandatory category selected by user. */
  extraType?: string;
  /** For extra flows: mandatory reason/details explaining why the extra happened. */
  extraReason?: string;
  /** For client extra flow: user attestation checkbox state. */
  clientProofConfirmed?: boolean;
  /** Optional helper path: create partner extra in the same submit from client extra modal. */
  linkedPartnerExtra?: {
    amount: number;
    extraType: string;
    extraReason: string;
  };
  clientPayApplyAs?: ClientPayApplyAs;
  /** Optional; prefixed into payment note for history only. */
  paymentLedgerLabel?: string;
  /** Partner extra drawer: submitted from the deduction section (always reduces self-bill). */
  partnerDeduction?: boolean;
};

/** Deposit scheduled vs still owed (for payment type UI). */
export type JobMoneyDrawerClientCashContext = {
  depositScheduled: number;
  depositRemaining: number;
};

function buildPartnerDeductTypeOptions(partnerDeductionPresets: PartnerExtraPresetRow[]): { value: string; label: string }[] {
  return partnerPresetSelectOptions(partnerDeductionPresets);
}

type Props = {
  open: boolean;
  flow: JobMoneyDrawerFlow | null;
  initialExtraType?: string;
  partnerExtraPresets?: PartnerExtraPresetRow[];
  partnerDeductionPresets?: PartnerExtraPresetRow[];
  onClose: () => void;
  onSubmit: (payload: JobMoneySubmitPayload) => Promise<void>;
  submitting: boolean;
  stripeInvoices: Invoice[];
  clientCashContext?: JobMoneyDrawerClientCashContext;
  /** Stackable catalog additionals for this job's service — quick-pick on extra flows. */
  catalogAddonOptions?: CatalogAddonChargeOption[];
};

const CLIENT_METHODS: { value: JobPaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "stripe", label: "Stripe" },
];

const PARTNER_METHODS: { value: JobPaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const CLIENT_LEDGER_LABEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Optional — for history" },
  { value: "Deposit", label: "Deposit" },
  { value: "Partial payment", label: "Partial payment" },
  { value: "Advance payment", label: "Advance payment" },
  { value: "Other", label: "Other" },
];

/** Match Cash In — Finance Summary “CASH IN — CLIENT” extra rows. */
const CLIENT_EXTRA_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Labour", label: "Labour" },
  { value: "CCZ", label: "CCZ" },
  { value: "Parking", label: "Parking" },
  { value: "Materials", label: "Materials" },
  { value: "Other", label: "Other" },
  { value: "Discount — labour", label: "Discount — labour" },
  { value: "Discount — extras", label: "Discount — access / other charges" },
  { value: "Discount — materials", label: "Discount — materials" },
];

const CLIENT_EXTRA_DISCOUNT_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Goodwill — partner damage / incident on site", label: "Goodwill — partner damage / incident on site" },
  { value: "Service recovery — price adjustment agreed with client", label: "Service recovery — price adjustment" },
  { value: "Rectification agreed without extra charge", label: "Rectification agreed without extra charge" },
  { value: "__other__", label: "Other (type manually)" },
];

const CLIENT_EXTRA_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Extra labour approved by client", label: "Extra labour approved by client" },
  { value: "Scope extension approved by client", label: "Scope extension approved by client" },
  { value: "Additional labour time approved after inspection", label: "Additional labour time approved after inspection" },
  { value: "Return visit labour approved by client", label: "Return visit labour approved by client" },
  { value: "Additional task outside original scope approved by client", label: "Additional task outside original scope approved by client" },
  { value: "__other__", label: "Other (type manually)" },
];

const CLIENT_MATERIALS_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Client approved materials purchase on site", label: "Client approved materials purchase on site" },
  { value: "Additional material quantity required to complete scope", label: "Additional material quantity required to complete scope" },
  { value: "Replacement materials approved after inspection", label: "Replacement materials approved after inspection" },
  { value: "Emergency materials required and approved by client", label: "Emergency materials required and approved by client" },
  { value: "__other__", label: "Other (type manually)" },
];

const PARTNER_CANCELLATION_FEE_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Partner no-show or late cancellation fee", label: "Partner no-show or late cancellation fee" },
  { value: "Agreed clawback — partner fault", label: "Agreed clawback — partner fault" },
  { value: "__other__", label: "Other (type manually)" },
];

/** @deprecated Use setup-driven partner extra presets. */
const PARTNER_EXTRA_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Labour", label: "Labour" },
  { value: "CCZ", label: "CCZ" },
  { value: "Parking", label: "Parking" },
  { value: "Materials", label: "Materials" },
  { value: "Other", label: "Other" },
  { value: "Discount — labour", label: "Discount — labour (less to pay partner)" },
  { value: "Discount — materials", label: "Discount — materials (less materials cost)" },
];

const PARTNER_EXTRA_DISCOUNT_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Clawback — damage / rectify issue caused on site", label: "Clawback — damage / rectify issue on site" },
  { value: "Agreed reduction after quality issue", label: "Agreed reduction after quality issue" },
  { value: "__other__", label: "Other (type manually)" },
];

const PARTNER_EXTRA_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Extra labour agreed with partner", label: "Extra labour agreed with partner" },
  { value: "Scope extension agreed with partner", label: "Scope extension agreed with partner" },
  { value: "Additional labour time after inspection", label: "Additional labour time after inspection" },
  { value: "Return visit labour agreed with partner", label: "Return visit labour agreed with partner" },
  { value: "Task outside original scope performed by partner", label: "Task outside original scope performed by partner" },
  { value: "__other__", label: "Other (type manually)" },
];

const PARTNER_MATERIALS_REASON_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Select reason" },
  { value: "Partner purchased materials on site", label: "Partner purchased materials on site" },
  { value: "Additional material quantity required to complete scope", label: "Additional material quantity required to complete scope" },
  { value: "Replacement materials purchased by partner", label: "Replacement materials purchased by partner" },
  { value: "Emergency materials purchased by partner", label: "Emergency materials purchased by partner" },
  { value: "__other__", label: "Other (type manually)" },
];

function isClientFlow(flow: JobMoneyDrawerFlow): boolean {
  return flow === "client_pay" || flow === "client_extra";
}

function flowTitle(flow: JobMoneyDrawerFlow, extraType?: string): string {
  switch (flow) {
    case "client_pay":
    case "partner_pay":
      return "Record Payment";
    case "client_extra":
      return isJobExtraDiscountExtraType(extraType) ? "Add client discount" : "Add extra charge";
    case "partner_extra":
      return "Extra & deduction";
  }
}

function flowSubmitLabel(flow: JobMoneyDrawerFlow, extraType?: string): string {
  if (flow === "client_pay" || flow === "partner_pay") return "Record Payment";
  if (flow === "partner_extra") {
    return isJobExtraDiscountExtraType(extraType) ? "Add deduction" : "Add extra";
  }
  return flowTitle(flow, extraType);
}

function readSavedMethod(flow: JobMoneyDrawerFlow): JobPaymentMethod {
  if (typeof window === "undefined") return "bank_transfer";
  const raw = window.localStorage.getItem(isClientFlow(flow) ? LS_CLIENT : LS_PARTNER);
  if (isClientFlow(flow)) {
    if (raw === "stripe" || raw === "bank_transfer" || raw === "cash") return raw;
  } else {
    if (raw === "bank_transfer" || raw === "cash" || raw === "other") return raw;
  }
  return "bank_transfer";
}

function persistMethod(flow: JobMoneyDrawerFlow, m: JobPaymentMethod) {
  try {
    window.localStorage.setItem(isClientFlow(flow) ? LS_CLIENT : LS_PARTNER, m);
  } catch {
    /* ignore */
  }
}

function isPayFlow(flow: JobMoneyDrawerFlow): boolean {
  return flow === "client_pay" || flow === "partner_pay";
}

function buildExtraTypeOptions(
  flow: JobMoneyDrawerFlow,
  catalogAddons?: CatalogAddonChargeOption[],
): { value: string; label: string }[] {
  const base = CLIENT_EXTRA_TYPE_OPTIONS;
  if (!catalogAddons?.length) return base;
  const seen = new Set(base.map((o) => o.value.trim().toUpperCase()));
  const catalogOpts: { value: string; label: string }[] = [];
  for (const addon of catalogAddons) {
    const label = addon.label.trim();
    const key = label.toUpperCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    catalogOpts.push({ value: label, label });
  }
  if (catalogOpts.length === 0) return base;
  const otherIdx = base.findIndex((o) => o.value === "Other");
  if (otherIdx === -1) return [...catalogOpts, ...base];
  return [...base.slice(0, otherIdx), ...catalogOpts, ...base.slice(otherIdx)];
}

type PartnerReasonPresetState = {
  showPresetSelect: boolean;
  presetOptions: { value: string; label: string }[];
};

function resolvePartnerReasonPresets(extraType: string, side: "add" | "deduct"): PartnerReasonPresetState {
  const typeUpper = extraType.trim().toUpperCase();
  const isDiscount = isJobExtraDiscountExtraType(extraType);

  if (side === "deduct") {
    const showCancellationFee = isPartnerCancellationFeeExtraType(extraType);
    const showDiscountMaterials = isDiscount && typeUpper.includes("MATERIAL");
    const showDiscountGeneric = isDiscount && !showDiscountMaterials && !showCancellationFee;
    const showPresetSelect = showCancellationFee || showDiscountMaterials || showDiscountGeneric;
    const presetOptions = showCancellationFee
      ? PARTNER_CANCELLATION_FEE_REASON_PRESETS
      : showDiscountMaterials
        ? PARTNER_MATERIALS_REASON_PRESETS
        : showDiscountGeneric
          ? PARTNER_EXTRA_DISCOUNT_REASON_PRESETS
          : [];
    return {
      showPresetSelect,
      presetOptions,
    };
  }

  const showMaterials = typeUpper === "MATERIALS";
  const showLabour = typeUpper === "LABOUR";
  const showPresetSelect = showMaterials || showLabour;
  return {
    showPresetSelect,
    presetOptions: showMaterials ? PARTNER_MATERIALS_REASON_PRESETS : PARTNER_EXTRA_REASON_PRESETS,
  };
}

function isPartnerSectionComplete(
  type: string,
  amountStr: string,
  reason: string,
  reasonPreset: string,
  side: "add" | "deduct",
): boolean {
  if (!type.trim()) return false;
  if (!(amountStr.trim() !== "" && parseMoneyInput(amountStr) > 0)) return false;
  const { showPresetSelect } = resolvePartnerReasonPresets(type, side);
  const quickReasonOk = !showPresetSelect || reasonPreset.trim().length > 0;
  const requiresManualReason = !showPresetSelect || reasonPreset === "__other__";
  const reasonOk = !requiresManualReason || reason.trim().length > 0;
  return quickReasonOk && reasonOk;
}

function clearPartnerAddFields(
  setters: {
    setType: (v: string) => void;
    setAmount: (v: string) => void;
    setReason: (v: string) => void;
    setReasonPreset: (v: string) => void;
  },
) {
  setters.setType("");
  setters.setAmount("");
  setters.setReason("");
  setters.setReasonPreset("");
}

function clearPartnerDeductFields(
  setters: {
    setType: (v: string) => void;
    setAmount: (v: string) => void;
    setReason: (v: string) => void;
    setReasonPreset: (v: string) => void;
  },
) {
  setters.setType("");
  setters.setAmount("");
  setters.setReason("");
  setters.setReasonPreset("");
}

export function JobMoneyDrawer({
  open,
  flow,
  initialExtraType,
  partnerExtraPresets = [],
  partnerDeductionPresets = [],
  onClose,
  onSubmit,
  submitting,
  stripeInvoices,
  clientCashContext,
  catalogAddonOptions = [],
}: Props) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<JobPaymentMethod>("bank_transfer");
  const [note, setNote] = useState("");
  const [clientPayApplyAs, setClientPayApplyAs] = useState<ClientPayApplyAs>("final");
  const [paymentLedgerLabel, setPaymentLedgerLabel] = useState("");
  const [extraType, setExtraType] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [extraReasonPreset, setExtraReasonPreset] = useState("");
  const [extraClientProofConfirmed, setExtraClientProofConfirmed] = useState(false);
  const [addLinkedPartnerExtra, setAddLinkedPartnerExtra] = useState(false);
  const [linkedPartnerAmount, setLinkedPartnerAmount] = useState("");
  const [linkedPartnerType, setLinkedPartnerType] = useState("Labour");
  const [linkedPartnerReason, setLinkedPartnerReason] = useState("");
  const [partnerAddType, setPartnerAddType] = useState("");
  const [partnerAddAmount, setPartnerAddAmount] = useState("");
  const [partnerAddReason, setPartnerAddReason] = useState("");
  const [partnerAddReasonPreset, setPartnerAddReasonPreset] = useState("");
  const [partnerDeductType, setPartnerDeductType] = useState("");
  const [partnerDeductAmount, setPartnerDeductAmount] = useState("");
  const [partnerDeductReason, setPartnerDeductReason] = useState("");
  const [partnerDeductReasonPreset, setPartnerDeductReasonPreset] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const depositRemaining = clientCashContext?.depositRemaining ?? 0;
  const depositScheduled = clientCashContext?.depositScheduled ?? 0;
  const canRecordDeposit = depositRemaining > EPS;

  /* eslint-disable react-hooks/set-state-in-effect -- reset form when drawer opens (same pattern as quotes modal) */
  useEffect(() => {
    if (!open || !flow) return;
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setPaymentLedgerLabel("");
    setExtraType(initialExtraType?.trim() || (flow === "partner_extra" ? "" : "Labour"));
    setExtraReason("");
    setExtraReasonPreset("");
    setPartnerAddType(
      flow === "partner_extra" && initialExtraType?.trim() && !isJobExtraDiscountExtraType(initialExtraType)
        ? initialExtraType.trim()
        : "",
    );
    setPartnerAddAmount("");
    setPartnerAddReason("");
    setPartnerAddReasonPreset("");
    setPartnerDeductType(
      flow === "partner_extra" && initialExtraType?.trim() && isJobExtraDiscountExtraType(initialExtraType)
        ? initialExtraType.trim()
        : "",
    );
    setPartnerDeductAmount("");
    setPartnerDeductReason("");
    setPartnerDeductReasonPreset("");
    setExtraClientProofConfirmed(false);
    setAddLinkedPartnerExtra(false);
    setLinkedPartnerAmount("");
    setLinkedPartnerType("Labour");
    setLinkedPartnerReason("");
    if (isPayFlow(flow)) {
      setMethod(flow === "client_pay" ? "bank_transfer" : readSavedMethod(flow));
    } else {
      setMethod(isClientFlow(flow) ? "bank_transfer" : "other");
    }
    if (flow === "client_pay") {
      setClientPayApplyAs(canRecordDeposit ? "deposit" : "final");
    }
    const id = requestAnimationFrame(() => {
      amountRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, flow, canRecordDeposit, initialExtraType, partnerExtraPresets, partnerDeductionPresets]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !flow || !isPayFlow(flow) || method === "stripe") return;
    const id = requestAnimationFrame(() => amountRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [method, open, flow]);

  const isExtraFlowUi = flow === "client_extra" || flow === "partner_extra";
  const extraTypeOptions = useMemo(
    () => (flow && isExtraFlowUi && flow !== "partner_extra" ? buildExtraTypeOptions(flow, catalogAddonOptions) : []),
    [flow, isExtraFlowUi, catalogAddonOptions],
  );

  const partnerBaseAddTypeOptions = useMemo(
    () => partnerPresetSelectOptions(partnerExtraPresets),
    [partnerExtraPresets],
  );

  const partnerExtraSelectGroups = useMemo((): SelectOptionGroup[] => {
    const groups: SelectOptionGroup[] = [
      {
        label: "Standard",
        options: [{ value: "", label: "Select extra type" }, ...partnerBaseAddTypeOptions],
      },
    ];
    if (catalogAddonOptions.length > 0) {
      groups.push({
        label: "Service catalog",
        options: catalogAddonOptions.map((addon) => ({
          value: addon.label.trim(),
          label: `${addon.label.trim()} — ${formatCurrency(addon.partnerAmount)}`,
        })),
      });
    }
    return groups;
  }, [partnerBaseAddTypeOptions, catalogAddonOptions]);

  const partnerDeductTypeOptions = useMemo(
    () => buildPartnerDeductTypeOptions(partnerDeductionPresets),
    [partnerDeductionPresets],
  );

  const linkedPartnerTypeOptions = useMemo(
    () => partnerAddOnlySelectOptions(partnerExtraPresets),
    [partnerExtraPresets],
  );

  if (!flow) return null;

  const catalogAddonsForFlow =
    isExtraFlowUi && catalogAddonOptions.length > 0 && flow === "client_extra" ? catalogAddonOptions : [];

  const applyCatalogAddon = (addon: CatalogAddonChargeOption) => {
    const label = addon.label.trim();
    const amt = flow === "client_extra" ? addon.clientAmount : addon.partnerAmount;
    if (flow === "partner_extra") {
      clearPartnerDeductFields({
        setType: setPartnerDeductType,
        setAmount: setPartnerDeductAmount,
        setReason: setPartnerDeductReason,
        setReasonPreset: setPartnerDeductReasonPreset,
      });
      setPartnerAddType(label);
      setPartnerAddAmount(amt > 0 ? String(Math.round(amt * 100) / 100) : "");
      setPartnerAddReason(`Service catalog additional — ${label}`);
      setPartnerAddReasonPreset("");
      return;
    }
    setExtraType(label);
    setAmount(amt > 0 ? String(Math.round(amt * 100) / 100) : "");
    setExtraReason(`Service catalog additional — ${label}`);
    setExtraReasonPreset("");
    if (flow === "client_extra" && addon.partnerAmount > 0) {
      setAddLinkedPartnerExtra(true);
      setLinkedPartnerType(label);
      setLinkedPartnerAmount(
        addon.partnerAmount > 0 ? String(Math.round(addon.partnerAmount * 100) / 100) : "",
      );
      setLinkedPartnerReason(`Service catalog additional — ${label}`);
    }
  };

  const isClientStripe = flow === "client_pay" && method === "stripe";
  const n = parseMoneyInput(amount);
  const amountOk = amount.trim() !== "" && n > 0;
  const isExtraFlow = !isPayFlow(flow);
  const isPartnerExtraFlow = flow === "partner_extra";
  const extraTypeUpper = extraType.trim().toUpperCase();
  const discountMode = isExtraFlow && !isPartnerExtraFlow && isJobExtraDiscountExtraType(extraType);
  const showDiscountMaterialsPresets = discountMode && extraTypeUpper.includes("MATERIAL");
  const showMaterialsReasonPresets = isExtraFlow && !isPartnerExtraFlow && !discountMode && extraTypeUpper === "MATERIALS";
  const showLabourReasonPresets = isExtraFlow && !isPartnerExtraFlow && !discountMode && extraTypeUpper === "LABOUR";
  const showCancellationFeeReasonPresets = false;
  const showDiscountGenericPresets = discountMode && !showDiscountMaterialsPresets && !showCancellationFeeReasonPresets;
  const showExtraPresetReasonSelect =
    !isPartnerExtraFlow &&
    (showLabourReasonPresets ||
      showMaterialsReasonPresets ||
      showDiscountMaterialsPresets ||
      showDiscountGenericPresets);
  const activePresetOptions = showDiscountMaterialsPresets
    ? CLIENT_MATERIALS_REASON_PRESETS
    : showMaterialsReasonPresets
      ? CLIENT_MATERIALS_REASON_PRESETS
      : showDiscountGenericPresets
        ? CLIENT_EXTRA_DISCOUNT_REASON_PRESETS
        : showLabourReasonPresets
          ? CLIENT_EXTRA_REASON_PRESETS
          : CLIENT_EXTRA_REASON_PRESETS;
  const quickReasonOk = !showExtraPresetReasonSelect || extraReasonPreset.trim().length > 0;
  const requiresManualExtraReason =
    !showExtraPresetReasonSelect || extraReasonPreset === "__other__";
  const extraTypeOk = !isExtraFlow || isPartnerExtraFlow || extraType.trim().length > 0;
  const extraReasonOk =
    !isExtraFlow || isPartnerExtraFlow || (requiresManualExtraReason ? extraReason.trim().length > 0 : true);
  const extraClientProofOk = flow !== "client_extra" || discountMode || extraClientProofConfirmed;
  const linkedPartnerAmountNum = parseMoneyInput(linkedPartnerAmount);
  const linkedPartnerAmountOk =
    !addLinkedPartnerExtra || (linkedPartnerAmount.trim() !== "" && linkedPartnerAmountNum > 0);
  const linkedPartnerTypeOk = !addLinkedPartnerExtra || linkedPartnerType.trim().length > 0;
  const linkedPartnerReasonOk = !addLinkedPartnerExtra || linkedPartnerReason.trim().length > 0;

  const partnerAddComplete = isPartnerSectionComplete(
    partnerAddType,
    partnerAddAmount,
    partnerAddReason,
    partnerAddReasonPreset,
    "add",
  );
  const partnerDeductComplete = isPartnerSectionComplete(
    partnerDeductType,
    partnerDeductAmount,
    partnerDeductReason,
    partnerDeductReasonPreset,
    "deduct",
  );
  const canSubmitPartner =
    (partnerAddComplete && !partnerDeductComplete) || (!partnerAddComplete && partnerDeductComplete);
  const partnerSubmitLabel =
    partnerAddComplete && !partnerDeductComplete
      ? "Add extra"
      : partnerDeductComplete && !partnerAddComplete
        ? "Add deduction"
        : "Extra & deduction";

  const partnerDeductAmountNum = parseMoneyInput(partnerDeductAmount);
  const partnerDeductAmountOk = partnerDeductAmount.trim() !== "" && partnerDeductAmountNum > 0;
  const partnerAddActive =
    Boolean(partnerAddType.trim()) ||
    Boolean(partnerAddAmount.trim()) ||
    Boolean(partnerAddReason.trim()) ||
    Boolean(partnerAddReasonPreset.trim());
  const partnerDeductActive =
    Boolean(partnerDeductType.trim()) ||
    Boolean(partnerDeductAmount.trim()) ||
    Boolean(partnerDeductReason.trim()) ||
    Boolean(partnerDeductReasonPreset.trim());

  const canSubmit = isPartnerExtraFlow
    ? canSubmitPartner
    : !isClientStripe &&
      amountOk &&
      extraTypeOk &&
      quickReasonOk &&
      extraReasonOk &&
      extraClientProofOk &&
      linkedPartnerAmountOk &&
      linkedPartnerTypeOk &&
      linkedPartnerReasonOk;

  const handleMethodChange = (m: JobPaymentMethod) => {
    setMethod(m);
    if (isPayFlow(flow)) persistMethod(flow, m);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (isPartnerExtraFlow) {
      if (partnerAddComplete && partnerDeductComplete) {
        toast.error("Fill only the extra section or the deduction section, not both");
        return;
      }
      const isDeduct = partnerDeductComplete;
      const submitType = isDeduct ? partnerDeductType : partnerAddType;
      const submitAmount = isDeduct ? partnerDeductAmountNum : parseMoneyInput(partnerAddAmount);
      const submitReason = isDeduct ? partnerDeductReason : partnerAddReason;
      await onSubmit({
        flow: "partner_extra",
        amount: submitAmount,
        paymentDate: new Date().toISOString().slice(0, 10),
        method: "other",
        note: `${submitType.trim()}${submitReason.trim() ? ` — ${submitReason.trim()}` : ""}`,
        extraType: submitType.trim(),
        extraReason: submitReason.trim(),
        partnerDeduction: isDeduct,
      });
      return;
    }

    const pay = isPayFlow(flow);
    const submitMethod = pay ? method : isClientFlow(flow) ? "bank_transfer" : "other";
    const applyForSubmit: ClientPayApplyAs | undefined =
      flow === "client_pay"
        ? clientPayApplyAs === "deposit" && !canRecordDeposit
          ? "final"
          : clientPayApplyAs
        : undefined;
    const noteWithExtraType =
      !isPayFlow(flow) && extraType.trim()
        ? `${extraType.trim()}${extraReason.trim() ? ` — ${extraReason.trim()}` : ""}`
        : note;
    await onSubmit({
      flow,
      amount: n,
      paymentDate: pay ? paymentDate : new Date().toISOString().slice(0, 10),
      method: submitMethod,
      note: noteWithExtraType,
      ...(!pay
        ? {
            extraType: extraType.trim(),
            extraReason: extraReason.trim(),
            ...(flow === "client_extra"
              ? { clientProofConfirmed: discountMode ? true : extraClientProofConfirmed }
              : {}),
          }
        : {}),
      ...(flow === "client_extra" && addLinkedPartnerExtra && !discountMode
        ? {
            linkedPartnerExtra: {
              amount: linkedPartnerAmountNum,
              extraType: linkedPartnerType.trim(),
              extraReason: linkedPartnerReason.trim(),
            },
          }
        : {}),
      ...(applyForSubmit != null ? { clientPayApplyAs: applyForSubmit } : {}),
      ...(pay && paymentLedgerLabel.trim()
        ? { paymentLedgerLabel: paymentLedgerLabel.trim() }
        : {}),
    });
  };

  const stripeLinks = stripeInvoices.filter((i) => i.stripe_payment_link_url);

  const helpExtra =
    flow === "partner_extra" ? null : (
      <p className="text-[11px] text-text-tertiary leading-relaxed">
        {discountMode
          ? "Reduces what the client is charged (quote / extras / materials line you picked). Not a payment — no money received yet."
          : "Increases the job total and linked invoice. This is not a payment — use Record Payment when money is received."}
      </p>
    );

  const handlePartnerAddSelect = (next: string) => {
    clearPartnerDeductFields({
      setType: setPartnerDeductType,
      setAmount: setPartnerDeductAmount,
      setReason: setPartnerDeductReason,
      setReasonPreset: setPartnerDeductReasonPreset,
    });
    if (!next) {
      setPartnerAddType("");
      setPartnerAddAmount("");
      setPartnerAddReason("");
      setPartnerAddReasonPreset("");
      return;
    }
    const addon = catalogAddonOptions.find((a) => a.label.trim() === next.trim());
    if (addon) {
      applyCatalogAddon(addon);
      return;
    }
    setPartnerAddType(next);
    setPartnerAddAmount("");
    setPartnerAddReason("");
    const normalized = next.trim().toUpperCase();
    const usePresetRow = normalized === "LABOUR" || normalized === "MATERIALS";
    setPartnerAddReasonPreset(usePresetRow ? "" : "");
  };

  const handlePartnerDeductSelect = (next: string) => {
    clearPartnerAddFields({
      setType: setPartnerAddType,
      setAmount: setPartnerAddAmount,
      setReason: setPartnerAddReason,
      setReasonPreset: setPartnerAddReasonPreset,
    });
    if (!next) {
      setPartnerDeductType("");
      setPartnerDeductAmount("");
      setPartnerDeductReason("");
      setPartnerDeductReasonPreset("");
      return;
    }
    setPartnerDeductType(next);
    setPartnerDeductAmount("");
    setPartnerDeductReason("");
    const isDiscount = isJobExtraDiscountExtraType(next);
    const normalized = next.trim().toUpperCase();
    const usePresetRow = isDiscount || normalized === "MATERIALS";
    setPartnerDeductReasonPreset(usePresetRow ? "" : "");
  };

  const renderPartnerReasonFields = (
    extraType: string,
    side: "add" | "deduct",
    reasonPreset: string,
    reason: string,
    onPresetChange: (preset: string) => void,
    onReasonChange: (text: string) => void,
  ) => {
    const { showPresetSelect, presetOptions } = resolvePartnerReasonPresets(extraType, side);
    const requiresManualReason = !showPresetSelect || reasonPreset === "__other__";
    return (
      <div>
        {showPresetSelect ? (
          <Select
            label="Reason *"
            value={reasonPreset}
            onChange={(e) => {
              const preset = e.target.value.trim();
              onPresetChange(preset);
              if (!preset || preset === "__other__") {
                onReasonChange("");
                return;
              }
              onReasonChange(preset);
            }}
            options={presetOptions}
            className="h-10"
          />
        ) : null}
        {requiresManualReason ? (
          <>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 mt-2">
              Reason <span className="text-red-500">*</span>
            </label>
            <Input
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={
                side === "deduct"
                  ? "Why is this amount being deducted?"
                  : extraType.trim().toLowerCase() === "other"
                    ? "Describe this extra in detail"
                    : "Why did this extra happen?"
              }
              className="h-10"
              required
            />
            <p className="mt-1 text-[11px] text-text-tertiary">Mandatory for tracking and future audit.</p>
          </>
        ) : showPresetSelect ? (
          <p className="mt-1 text-[11px] text-text-tertiary">Using selected quick reason.</p>
        ) : null}
      </div>
    );
  };

  const clientPayTypeOptions = [
    {
      value: "deposit" as const,
      label:
        depositScheduled > EPS
          ? `Deposit (up to ${formatCurrency(depositRemaining)} due)`
          : "Deposit (none scheduled)",
      disabled: !canRecordDeposit,
    },
    { value: "final" as const, label: "Partial payment (final balance)", disabled: false },
  ];

  return (
    <Drawer
      open={open && !!flow}
      onClose={onClose}
      title={flowTitle(flow, isPartnerExtraFlow ? undefined : extraType)}
      width="w-[min(100vw,400px)]"
      className="bg-surface"
      footer={
        isClientStripe ? (
          <div className="px-5 py-4">
            <Button type="button" className="w-full h-10" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-border-light bg-surface">
            <Button
              type="submit"
              form="job-money-drawer-form"
              className={cn(
                "w-full h-10",
                isPartnerExtraFlow &&
                  partnerDeductComplete &&
                  !partnerAddComplete &&
                  "border-rose-300/90 bg-rose-700 text-white hover:bg-rose-800 dark:border-rose-500/50 dark:bg-rose-800 dark:hover:bg-rose-700",
              )}
              loading={submitting}
              disabled={!canSubmit}
            >
              {isPartnerExtraFlow ? partnerSubmitLabel : flowSubmitLabel(flow, extraType)}
            </Button>
          </div>
        )
      }
    >
      <form id="job-money-drawer-form" onSubmit={handleFormSubmit} className="px-5 py-5 space-y-5">
        {flow === "client_pay" && !isClientStripe ? (
          <div className="space-y-4">
            <div>
              <Select
                label="Payment type"
                value={clientPayApplyAs}
                onChange={(e) => setClientPayApplyAs(e.target.value as ClientPayApplyAs)}
                options={clientPayTypeOptions.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
                className="h-10"
              />
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
                Choose whether this receipt applies to the scheduled deposit or to the final balance. Deposit is disabled when
                nothing is due.
              </p>
            </div>
            <div>
              <Select
                label="Classification (optional)"
                value={paymentLedgerLabel}
                onChange={(e) => setPaymentLedgerLabel(e.target.value)}
                options={CLIENT_LEDGER_LABEL_OPTIONS}
                className="h-10"
              />
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
                Deposit / Partial payment / Advance / Other — history label only. Use Payment type above for deposit vs final balance.
              </p>
            </div>
          </div>
        ) : null}

        {flow === "partner_pay" ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Method</label>
            <Select
              value={method}
              onChange={(e) => handleMethodChange(e.target.value as JobPaymentMethod)}
              options={PARTNER_METHODS}
              className="h-10"
            />
            <p className="text-[11px] text-text-tertiary mt-1.5">How you sent money to the partner (ledger record only).</p>
          </div>
        ) : null}

        {flow === "partner_pay" ? (
          <div>
            <Select
              label="Classification (optional)"
              value={paymentLedgerLabel}
              onChange={(e) => setPaymentLedgerLabel(e.target.value)}
              options={PARTNER_PAY_LEDGER_LABEL_OPTIONS}
              className="h-10"
            />
            <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
              Partial payout follows the usual “still due vs partner cap”. Advance / early payment / deposit pass-through skips that cap —
              use when you already collected from the client and are forwarding cash early.
            </p>
          </div>
        ) : null}

        {isClientStripe ? (
          <div className="space-y-3 rounded-xl border border-border-light bg-card/60 px-3 py-3">
            <p className="text-sm text-text-secondary leading-snug">Payments sync when the client pays the link.</p>
            {stripeLinks.length > 0 ? (
              <ul className="space-y-2">
                {stripeLinks.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-light bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">{inv.reference}</p>
                      <p className="text-[11px] text-text-tertiary tabular-nums">{formatCurrency(inv.amount)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        icon={<Copy className="h-3 w-3" />}
                        onClick={() => {
                          void navigator.clipboard.writeText(inv.stripe_payment_link_url!);
                          toast.success("Copied");
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        icon={<ExternalLink className="h-3 w-3" />}
                        onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">No Stripe link on this job yet.</p>
            )}
            <p className="text-[11px] text-text-tertiary">Switch method to Bank or Cash to record a payment manually.</p>
          </div>
        ) : (
          <>
            {!isPayFlow(flow) ? helpExtra : null}
            {catalogAddonsForFlow.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-text-secondary">Service additionals</p>
                <div className="flex flex-wrap gap-1.5">
                  {catalogAddonsForFlow.map((addon) => {
                    const amt = flow === "client_extra" ? addon.clientAmount : addon.partnerAmount;
                    const selected = extraType.trim().toLowerCase() === addon.label.trim().toLowerCase();
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        onClick={() => applyCatalogAddon(addon)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border-light bg-card text-text-secondary hover:border-primary/30",
                        )}
                      >
                        <span className="font-medium">{addon.label}</span>
                        <span className="block text-[10px] tabular-nums opacity-80">{formatCurrency(amt)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!isPayFlow(flow) && flow === "partner_extra" ? (
              <div className="space-y-3">
                <p className="text-[11px] text-text-tertiary leading-relaxed">
                  Fill <span className="font-medium text-text-secondary">one section only</span> — extra or deduction.
                  Neither is a cash-out payment; use Record partner payment when you send money.
                </p>

                <div
                  className={cn(
                    "rounded-xl border p-3.5 space-y-3 transition-shadow",
                    "border-rose-200/80 bg-rose-50/40 dark:border-rose-500/25 dark:bg-rose-950/20",
                    partnerAddComplete && "ring-2 ring-rose-400/40 dark:ring-rose-500/35",
                    partnerDeductActive && !partnerAddActive && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rose-300/80 bg-rose-100 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/50 dark:text-rose-200">
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-300">
                          Extra · Extra Payment to Partner
                        </p>
                        <FixfyHintIcon text="Raises partner cost and self-bill gross for this job." />
                      </div>
                    </div>
                  </div>
                  <Select
                    label="Type"
                    value={partnerAddType}
                    onChange={(e) => handlePartnerAddSelect(e.target.value)}
                    optionGroups={partnerExtraSelectGroups}
                    className="h-10"
                  />
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
                    <Input
                      ref={amountRef}
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerAddAmount}
                      onChange={(e) => setPartnerAddAmount(e.target.value)}
                      className="h-10 text-sm font-medium tabular-nums bg-card"
                      placeholder="0.00"
                    />
                  </div>
                  {partnerAddType.trim()
                    ? renderPartnerReasonFields(
                        partnerAddType,
                        "add",
                        partnerAddReasonPreset,
                        partnerAddReason,
                        setPartnerAddReasonPreset,
                        setPartnerAddReason,
                      )
                    : null}
                </div>

                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-border-light dark:bg-[#2f3642]" />
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">or</span>
                  <div className="h-px flex-1 bg-border-light dark:bg-[#2f3642]" />
                </div>

                <div
                  className={cn(
                    "rounded-xl border p-3.5 space-y-3 transition-shadow",
                    "border-rose-300/70 bg-rose-50/25 dark:border-rose-500/30 dark:bg-rose-950/15",
                    partnerDeductComplete && "ring-2 ring-rose-500/45 dark:ring-rose-400/30",
                    partnerAddActive && !partnerDeductActive && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rose-400/70 bg-rose-200/50 text-rose-900 dark:border-rose-500/50 dark:bg-rose-950/60 dark:text-rose-100">
                      <Minus className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-900 dark:text-rose-200">
                          Deduction · reduces partner pay
                        </p>
                        <FixfyHintIcon text="Clawback from self-bill and labour cap — not money sent to the partner." />
                      </div>
                    </div>
                  </div>
                  <Select
                    label="Type"
                    value={partnerDeductType}
                    onChange={(e) => handlePartnerDeductSelect(e.target.value)}
                    options={[{ value: "", label: "Select deduction type" }, ...partnerDeductTypeOptions]}
                    className="h-10"
                  />
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount to deduct</label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerDeductAmount}
                      onChange={(e) => setPartnerDeductAmount(e.target.value)}
                      className="h-10 text-sm font-medium tabular-nums bg-card"
                      placeholder="0.00"
                    />
                    {partnerDeductAmountOk ? (
                      <p className="text-[11px] font-medium text-rose-800 dark:text-rose-300 mt-1.5 tabular-nums">
                        −{formatCurrency(partnerDeductAmountNum)} from partner payout
                      </p>
                    ) : null}
                  </div>
                  {partnerDeductType.trim()
                    ? renderPartnerReasonFields(
                        partnerDeductType,
                        "deduct",
                        partnerDeductReasonPreset,
                        partnerDeductReason,
                        setPartnerDeductReasonPreset,
                        setPartnerDeductReason,
                      )
                    : null}
                </div>
              </div>
            ) : null}
            {!isPayFlow(flow) && flow !== "partner_extra" ? (
              <div>
                <Select
                  label="Extra type"
                  value={extraType}
                  onChange={(e) => {
                    const next = e.target.value;
                    setExtraType(next);
                    if (isJobExtraDiscountExtraType(next)) setAddLinkedPartnerExtra(false);
                    const normalized = next.trim().toUpperCase();
                    const usePresetRow =
                      normalized === "LABOUR" ||
                      normalized === "MATERIALS" ||
                      isJobExtraDiscountExtraType(next);
                    if (!usePresetRow) setExtraReasonPreset("");
                  }}
                  options={extraTypeOptions}
                  className="h-10"
                />
              </div>
            ) : null}
            {(isPayFlow(flow) || flow === "client_extra") ? (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
                <Input
                  ref={amountRef}
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-10 text-sm font-medium tabular-nums"
                  placeholder="0.00"
                />
              </div>
            ) : null}
            {isPayFlow(flow) ? (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Date</label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            ) : null}
            {!isPayFlow(flow) && flow !== "partner_extra" ? (
              <div>
                {showExtraPresetReasonSelect ? (
                  <Select
                    label="Reason *"
                    value={extraReasonPreset}
                    onChange={(e) => {
                      const preset = e.target.value.trim();
                      setExtraReasonPreset(preset);
                      if (!preset) {
                        setExtraReason("");
                        return;
                      }
                      if (preset === "__other__") {
                        setExtraReason("");
                        return;
                      }
                      setExtraReason(preset);
                    }}
                    options={activePresetOptions}
                    className="h-10"
                  />
                ) : null}
                {requiresManualExtraReason ? (
                  <>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5 mt-2">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={extraReason}
                      onChange={(e) => setExtraReason(e.target.value)}
                      placeholder={extraType.trim().toLowerCase() === "other" ? "Describe this extra in detail" : "Why did this extra happen?"}
                      className="h-10"
                      required
                    />
                    <p className="mt-1 text-[11px] text-text-tertiary">
                      Mandatory for tracking and future audit.
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    Using selected quick reason.
                  </p>
                )}
                {flow === "client_extra" && !discountMode ? (
                  <label className="mt-2.5 inline-flex items-start gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={extraClientProofConfirmed}
                      onChange={(e) => setExtraClientProofConfirmed(e.target.checked)}
                      className="mt-0.5"
                      required
                    />
                    <span>
                      I confirm the client has been informed and the acceptance approved. I understand I may assume
                      responsibility for this charge.
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}
            {flow === "client_extra" && !discountMode ? (
              <div className="rounded-lg border border-border-light bg-card/60 px-3 py-2.5">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    checked={addLinkedPartnerExtra}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAddLinkedPartnerExtra(checked);
                      if (checked) {
                        if (!linkedPartnerAmount.trim() && amount.trim()) setLinkedPartnerAmount(amount);
                        if (!linkedPartnerReason.trim() && extraReason.trim()) setLinkedPartnerReason(extraReason.trim());
                        } else {
                          setLinkedPartnerAmount("");
                          setLinkedPartnerType("Labour");
                          setLinkedPartnerReason("");
                      }
                    }}
                  />
                  Add partner extra payout as well
                </label>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  Useful when you sell extra work and need to register partner extra in the same step.
                </p>
                {addLinkedPartnerExtra ? (
                  <div className="mt-2.5 space-y-2.5">
                    <Select
                      label="Partner extra type"
                      value={linkedPartnerType}
                      onChange={(e) => setLinkedPartnerType(e.target.value)}
                      options={linkedPartnerTypeOptions.length > 0 ? linkedPartnerTypeOptions : PARTNER_EXTRA_TYPE_OPTIONS.filter((o) => !o.value.startsWith("Discount"))}
                      className="h-10"
                    />
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Partner amount</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={linkedPartnerAmount}
                        onChange={(e) => setLinkedPartnerAmount(e.target.value)}
                        className="h-10 text-[14px] font-medium tabular-nums sm:text-[15px]"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        Partner reason <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={linkedPartnerReason}
                        onChange={(e) => setLinkedPartnerReason(e.target.value)}
                        placeholder="Why did this partner extra happen?"
                        className="h-10"
                        required
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </form>
    </Drawer>
  );
}
