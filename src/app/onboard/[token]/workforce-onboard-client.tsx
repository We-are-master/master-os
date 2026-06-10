"use client";

import "../workforce-onboarding.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BadgePoundSterling,
  Building2,
  Camera,
  Check,
  CheckCircle,
  FileBadge,
  FileSignature,
  FileText,
  Globe,
  IdCard,
  Info,
  Landmark,
  Loader2,
  Lock,
  LogIn,
  PartyPopper,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PAYROLL_UPLOAD_LABELS, PROFILE_PHOTO_DOC_KEY } from "@/lib/payroll-doc-checklist";
import {
  WorkforceSignaturePad,
  type WorkforceSignaturePadHandle,
} from "@/components/workforce/workforce-signature-pad";
import {
  applyContractorTaxNumberToProfile,
  contractorFiscalComplete,
  contractorTaxNumberFromProfile,
  isUkWorkCountry,
} from "@/lib/workforce-contractor-agreement";
import { FixfyHeaderLogo } from "@/components/brand/fixfy-header-logo";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { COUNTRY_WORK_HINT } from "@/components/ui/country-select";
import { countrySelectOptionsFor, resolveCountrySelectValue } from "@/lib/countries";
import { signIn } from "@/services/auth";
import { getSupabase } from "@/services/base";
import type { PayrollInternalProfile } from "@/types/database";

const WORKFORCE_CONTRACTOR_FEE_LABEL = "Service fee";

type PayrollDocumentFiles = Record<string, { path?: string; file_name?: string } | undefined>;

type SessionData = {
  person: {
    id: string;
    profile_id?: string | null;
    payee_name?: string | null;
    description?: string | null;
    amount: number;
    pay_frequency?: string | null;
    payment_day_of_month?: number | null;
    payment_method?: string | null;
    commission_enabled?: boolean | null;
    commission_rate_percent?: number | null;
    commission_basis?: string | null;
    employment_type?: "employee" | "self_employed" | null;
    lifecycle_stage?: string | null;
    payroll_profile?: Record<string, string | undefined> | null;
    payroll_document_files?: PayrollDocumentFiles | null;
    payout_bank_sort_code?: string | null;
    payout_bank_account_number?: string | null;
    payout_bank_account_holder?: string | null;
    business_units?: { name: string } | null;
  };
  contract?: { id: string; title: string; body_html: string } | null;
  docKeys: string[];
  mandatoryDocKeys?: string[];
  contractSigned?: boolean;
  branding: {
    companyName: string;
    primaryColor?: string;
  };
};

function OnboardBrand({ branding }: { branding: SessionData["branding"] }) {
  return (
    <div className="ob-brand">
      <FixfyHeaderLogo className="ob-brand__logo" height={32} alt={branding.companyName} />
    </div>
  );
}

type StepId = "welcome" | "details" | "bank" | "documents" | "contract" | "photo" | "done";

type StepDef = { id: StepId; label: string; cta: string };

const EMPTY_PROFILE: Record<string, string> = {
  email: "",
  phone: "",
  address: "",
  ni_number: "",
  tax_code: "",
  utr: "",
  vat_number: "",
  company_registration: "",
  country_of_operation: "",
  contractor_entity_type: "individual",
  position: "",
  start_date: "",
};

function profileField(profile: Record<string, string>, key: string): string {
  return (profile[key] ?? "").trim();
}

function buildSteps(session: SessionData): StepDef[] {
  const steps: StepDef[] = [
    { id: "welcome", label: "Welcome", cta: "Confirm & continue" },
    { id: "details", label: "Details", cta: "Save & continue" },
    { id: "bank", label: "Bank", cta: "Save & continue" },
  ];
  if (session.docKeys.length > 0) {
    steps.push({ id: "documents", label: "Documents", cta: "Continue" });
  }
  if (session.contract) {
    steps.push({ id: "contract", label: "Contract", cta: "Continue" });
  }
  steps.push({ id: "photo", label: "Photo", cta: "Finish & access platform" });
  steps.push({ id: "done", label: "Done", cta: "" });
  return steps;
}

function docIcon(key: string) {
  if (key === "passport") return <IdCard className="h-[18px] w-[18px]" />;
  if (key === "right_to_work") return <Globe className="h-[18px] w-[18px]" />;
  return <FileText className="h-[18px] w-[18px]" />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export default function WorkforceOnboardClient() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string>>({ ...EMPTY_PROFILE });
  const [bank, setBank] = useState({
    payout_bank_account_holder: "",
    payout_bank_sort_code: "",
    payout_bank_account_number: "",
  });
  const [signed, setSigned] = useState(false);
  const [agreeContract, setAgreeContract] = useState(false);
  const [contractScrolledEnd, setContractScrolledEnd] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [introOn, setIntroOn] = useState(true);
  const [introSlide, setIntroSlide] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [platformPassword, setPlatformPassword] = useState("");
  const [platformPasswordConfirm, setPlatformPasswordConfirm] = useState("");
  const [enteringPlatform, setEnteringPlatform] = useState(false);
  const [loginReady, setLoginReady] = useState(false);
  const savedPasswordRef = useRef("");
  const [contractorTaxNumber, setContractorTaxNumber] = useState("");
  const signaturePadRef = useRef<WorkforceSignaturePadHandle>(null);
  const contractRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const applySession = useCallback((data: SessionData) => {
    setSession(data);
    const p = data.person.payroll_profile ?? {};
    setProfile({
      ...EMPTY_PROFILE,
      email: p.email ?? "",
      phone: p.phone ?? "",
      address: p.address ?? "",
      ni_number: p.ni_number ?? "",
      tax_code: p.tax_code ?? "",
      utr: p.utr ?? "",
      vat_number: p.vat_number ?? "",
      company_registration: p.company_registration ?? "",
      country_of_operation: p.country_of_operation ?? "",
      contractor_entity_type: p.contractor_entity_type ?? "individual",
      position: p.position ?? "",
      start_date: p.start_date ?? "",
    });
    setContractorTaxNumber(
      contractorTaxNumberFromProfile({
        utr: p.utr,
        vat_number: p.vat_number,
        company_registration: p.company_registration,
      }),
    );
    setBank({
      payout_bank_account_holder: data.person.payout_bank_account_holder ?? "",
      payout_bank_sort_code: data.person.payout_bank_sort_code ?? "",
      payout_bank_account_number: data.person.payout_bank_account_number ?? "",
    });
    setSigned(!!data.contractSigned);
    setAgreeContract(!!data.contractSigned);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workforce/onboarding/session?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load");
      applySession(data as SessionData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load onboarding");
    } finally {
      setLoading(false);
    }
  }, [token, applySession]);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = useMemo(() => (session ? buildSteps(session) : []), [session]);
  const railSteps = useMemo(() => steps.filter((s) => s.id !== "done"), [steps]);
  const currentStep = steps[stepIndex]?.id ?? "welcome";
  const person = session?.person;
  const isContractor = person?.employment_type === "self_employed";
  const isUkContractor = isUkWorkCountry(profile.country_of_operation);
  const lifecycleStage = person?.lifecycle_stage ?? "active";
  const isUpdateMode = lifecycleStage === "active" || lifecycleStage === "needs_attention";
  const uploadedFiles = person?.payroll_document_files ?? {};
  const hasProfilePhoto = !!uploadedFiles[PROFILE_PHOTO_DOC_KEY]?.path || !!photoPreview;

  useEffect(() => {
    if (isUpdateMode) setIntroOn(false);
  }, [isUpdateMode]);

  useEffect(() => {
    document.body.classList.toggle("intro-on", introOn);
    return () => document.body.classList.remove("intro-on");
  }, [introOn]);

  const saveProfile = async () => {
    const profilePayload = isContractor
      ? { ...applyContractorTaxNumberToProfile(profile, contractorTaxNumber), ...bank }
      : { ...profile, ...bank };
    const res = await fetch(`/api/workforce/onboarding/session?token=${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profilePayload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Save failed");
    }
  };

  const uploadDoc = async (docKey: string, file: File) => {
    setUploadingKey(docKey);
    try {
      const fd = new FormData();
      fd.set("docKey", docKey);
      fd.set("file", file);
      const res = await fetch(`/api/workforce/onboarding/upload?token=${encodeURIComponent(token)}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Upload failed");
      }
      if (docKey === PROFILE_PHOTO_DOC_KEY) {
        setPhotoPreview(URL.createObjectURL(file));
      }
      await load();
    } finally {
      setUploadingKey(null);
    }
  };

  const clearSignature = () => {
    signaturePadRef.current?.clear();
    setSigned(false);
    setHasSignature(false);
  };

  const getSignatureDataUrl = (): string | null => signaturePadRef.current?.toDataURL() ?? null;

  const signContract = async () => {
    if (!session?.contract) return;
    const sig = getSignatureDataUrl();
    if (!sig) throw new Error("Draw your signature first");
    const res = await fetch(`/api/workforce/onboarding/sign?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersionId: session.contract.id,
        signerFullName: session.person.payee_name ?? profile.email,
        signerEmail: profile.email,
        signatureImageBase64: sig,
        deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.alreadySigned) {
        setSigned(true);
        return;
      }
      throw new Error(data.error ?? "Sign failed");
    }
    setSigned(true);
  };

  const handleComplete = async () => {
    if (!bank.payout_bank_sort_code.trim() || !bank.payout_bank_account_number.trim()) {
      toast.error("Enter your sort code and account number");
      return;
    }
    if (!bank.payout_bank_account_holder.trim()) {
      toast.error("Enter the account holder name");
      return;
    }
    if (!isUpdateMode) {
      if (platformPassword.length < 8) {
        toast.error("Choose a password with at least 8 characters");
        return;
      }
      if (platformPassword !== platformPasswordConfirm) {
        toast.error("Passwords do not match");
        return;
      }
    }
    setSubmitting(true);
    try {
      await saveProfile();
      if (session?.contract && !signed) await signContract();
      const res = await fetch(`/api/workforce/onboarding/complete?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          !isUpdateMode && platformPassword ? { password: platformPassword } : {},
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Complete failed");
      }
      const data = (await res.json()) as {
        autoLoginReady?: boolean;
        email?: string | null;
      };

      savedPasswordRef.current = platformPassword;
      setLoginReady(true);

      const loginEmail = data.email?.trim() || profile.email.trim().toLowerCase();
      const loginPassword = platformPassword || savedPasswordRef.current;

      if (data.autoLoginReady && loginEmail && loginPassword) {
        try {
          await signIn(loginEmail, loginPassword);
          window.location.assign("/");
          return;
        } catch {
          toast.error("Onboarding saved — use Access the platform to sign in");
        }
      }

      if (isUpdateMode) {
        const supabase = getSupabase();
        const { data: authData } = await supabase.auth.getUser();
        if (authData.user) {
          window.location.assign("/");
          return;
        }
      }

      const doneIdx = steps.findIndex((s) => s.id === "done");
      if (doneIdx >= 0) setStepIndex(doneIdx);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  const enterPlatform = useCallback(async () => {
    setEnteringPlatform(true);
    try {
      const supabase = getSupabase();
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        window.location.assign("/");
        return;
      }
      const email = profile.email.trim().toLowerCase();
      const password = savedPasswordRef.current || platformPassword;
      if (email && password) {
        await signIn(email, password);
        window.location.assign("/");
        return;
      }
      window.location.assign("/login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign in");
      window.location.assign("/login");
    } finally {
      setEnteringPlatform(false);
    }
  }, [platformPassword, profile.email]);

  useEffect(() => {
    if (currentStep !== "done" || !loginReady || enteringPlatform) return;
    const t = window.setTimeout(() => {
      void enterPlatform();
    }, 600);
    return () => window.clearTimeout(t);
  }, [currentStep, loginReady, enteringPlatform, enterPlatform]);

  const contractorProfile: PayrollInternalProfile = applyContractorTaxNumberToProfile(
    {
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      country_of_operation: profile.country_of_operation,
      contractor_entity_type:
        profile.contractor_entity_type === "company" ? "company" : "individual",
    },
    contractorTaxNumber,
  );

  const detailsValid =
    profileField(profile, "phone").length > 0 &&
    profileField(profile, "address").length > 0 &&
    (isContractor ? contractorFiscalComplete(contractorProfile) : profileField(profile, "ni_number").length > 0);

  const bankValid =
    bank.payout_bank_account_holder.trim().length > 0 &&
    bank.payout_bank_sort_code.trim().length > 0 &&
    bank.payout_bank_account_number.trim().length > 0;

  const mandatoryDocs = session?.mandatoryDocKeys ?? session?.docKeys ?? [];
  const docsValid = mandatoryDocs.every((k) => !!uploadedFiles[k]?.path);

  const contractValid =
    !session?.contract ||
    (signed && agreeContract) ||
    (agreeContract && contractScrolledEnd && hasSignature);

  const canAdvance = (() => {
    if (currentStep === "details") return detailsValid;
    if (currentStep === "bank") return bankValid;
    if (currentStep === "documents") return docsValid;
    if (currentStep === "contract") return contractValid;
    return true;
  })();

  const goNext = async () => {
    if (!canAdvance || submitting) return;
    try {
      if (currentStep === "details" || currentStep === "bank") {
        setSubmitting(true);
        await saveProfile();
        const res = await fetch(`/api/workforce/onboarding/session?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok) applySession(data as SessionData);
        setSubmitting(false);
      }
      if (currentStep === "contract" && session?.contract && !signed) {
        setSubmitting(true);
        await signContract();
        setSubmitting(false);
      }
      if (currentStep === "photo") {
        await handleComplete();
        return;
      }
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setSubmitting(false);
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const goBack = () => {
    setStepIndex((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) {
    return (
      <div className="ob-bg">
        <div className="ob-stage flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--coral)]" />
        </div>
      </div>
    );
  }

  if (error || !session || !person) {
    return (
      <div className="ob-bg">
        <div className="ob-stage flex items-center justify-center min-h-screen p-6">
          <p className="text-red-600 font-medium">{error ?? "Invalid link"}</p>
        </div>
      </div>
    );
  }

  const freqLabel =
    person.pay_frequency === "weekly"
      ? "Weekly"
      : person.pay_frequency === "biweekly"
        ? "Bi-weekly"
        : person.pay_frequency === "monthly"
          ? "Monthly"
          : person.pay_frequency ?? "—";
  const basisLabel = person.commission_basis === "revenue" ? "revenue" : "gross margin";
  const buName = person.business_units?.name ?? "—";
  const roleLine = profile.position?.trim() || person.description?.trim() || "—";
  const startDateLabel = profile.start_date ? formatDate(profile.start_date) : "—";
  const firstName = (person.payee_name ?? "there").trim().split(/\s+/)[0] ?? "there";
  const feeLabel = isContractor ? WORKFORCE_CONTRACTOR_FEE_LABEL : "Fixed salary";
  const railActive = Math.min(stepIndex, railSteps.length - 1);

  return (
    <>
      <div className="ob-bg">
        <div className="ob-bg__grid" />
        <div className="ob-bg__orb a" />
        <div className="ob-bg__orb b" />
        <div className="ob-bg__orb c" />
      </div>

      {introOn && !isUpdateMode ? (
        <div className="ob-intro is-on" id="intro">
          <div className="ob-intro__bar">
            <OnboardBrand branding={session.branding} />
            <span className="ob-intro__skip" onClick={() => setIntroOn(false)} role="button" tabIndex={0}>
              Skip intro
            </span>
          </div>
          <div className="ob-intro__stage">
            <div className={`ob-slide${introSlide === 0 ? " is-active anim" : ""}`} data-slide="0">
              <div className="ob-hero">
                <div className="ob-hero__ring" />
                <div className="ob-hero__ring two" />
                <div className="ob-hero__core">
                  <PartyPopper className="h-12 w-12" />
                </div>
                <div className="ob-hero__chip c1">
                  <CheckCircle className="h-4 w-4" />
                  Offer accepted
                </div>
                <div className="ob-hero__chip c2">
                  <Sparkles className="h-4 w-4" />
                  Day one ready
                </div>
              </div>
              <div className="ob-slide__eyebrow">Welcome aboard</div>
              <h1 className="ob-slide__h">
                You&apos;re joining {session.branding.companyName},<br />
                {firstName}.
              </h1>
              <p className="ob-slide__p">
                {isContractor
                  ? "Complete your contractor onboarding — documents, agreement, and bank details — so we can pay you on time."
                  : "Let's get your account set up so you're ready for day one."}
              </p>
            </div>
            <div className={`ob-slide${introSlide === 1 ? " is-active anim" : ""}`} data-slide="1">
              <div className="ob-hero">
                <div className="ob-hero__ring" />
                <div className="ob-hero__ring two" />
                <div className="ob-hero__core" style={{ background: "linear-gradient(150deg,#020040,#3a3a8c)" }}>
                  <Route className="h-12 w-12" />
                </div>
                <div className="ob-hero__chip c1">
                  <CheckCircle className="h-4 w-4" />
                  ~4 minutes
                </div>
              </div>
              <div className="ob-slide__eyebrow">How it works</div>
              <h1 className="ob-slide__h">A few quick steps,<br />then you&apos;re in.</h1>
              <div className="ob-prev">
                <div className="ob-prev__i">
                  <span className="ob-prev__n">1</span>
                  <div>
                    <div className="ob-prev__t">Confirm your details</div>
                    <div className="ob-prev__d">Check what we know, add what&apos;s missing</div>
                  </div>
                </div>
                <div className="ob-prev__i">
                  <span className="ob-prev__n">2</span>
                  <div>
                    <div className="ob-prev__t">Upload documents</div>
                    <div className="ob-prev__d">ID and compliance files for payroll</div>
                  </div>
                </div>
                <div className="ob-prev__i">
                  <span className="ob-prev__n">3</span>
                  <div>
                    <div className="ob-prev__t">Sign your {isContractor ? "agreement" : "contract"}</div>
                    <div className="ob-prev__d">Read and sign digitally</div>
                  </div>
                </div>
              </div>
            </div>
            <div className={`ob-slide${introSlide === 2 ? " is-active anim" : ""}`} data-slide="2">
              <div className="ob-hero">
                <div className="ob-hero__ring" />
                <div className="ob-hero__ring two" />
                <div className="ob-hero__core" style={{ background: "linear-gradient(150deg,#0E8A5F,#3CCB94)" }}>
                  <ShieldCheck className="h-12 w-12" />
                </div>
              </div>
              <div className="ob-slide__eyebrow">Before you start</div>
              <h1 className="ob-slide__h">Have these handy.</h1>
              <div className="ob-ready">
                <div className="ob-ready__i">
                  <IdCard className="h-[18px] w-[18px]" />
                  Photo ID or passport
                  <span className="t">Upload</span>
                </div>
                <div className="ob-ready__i">
                  <Landmark className="h-[18px] w-[18px]" />
                  UK bank details
                  <span className="t">Sort + acc</span>
                </div>
                {!isContractor ? (
                  <div className="ob-ready__i">
                    <FileBadge className="h-[18px] w-[18px]" />
                    National Insurance no.
                    <span className="t">For payroll</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="ob-intro__foot">
            <div className="ob-dots">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`ob-dot${introSlide === i ? " is-active" : ""}`}
                  onClick={() => setIntroSlide(i)}
                  role="button"
                  tabIndex={0}
                />
              ))}
            </div>
            <div className="ob-intro__cta">
              {introSlide > 0 ? (
                <button type="button" className="btn btn--ghost" onClick={() => setIntroSlide((s) => s - 1)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--p btn--lg"
                onClick={() => {
                  if (introSlide === 2) setIntroOn(false);
                  else setIntroSlide((s) => s + 1);
                }}
              >
                {introSlide === 2 ? "Get started" : "Next"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="ob-top">
        <div className="ob-top__in">
          <OnboardBrand branding={session.branding} />
          <div className="ob-top__spacer" />
          <span className="ob-top__save">
            <CheckCircle className="h-3.5 w-3.5" />
            <span className="ob-top__save-long">Progress saved</span>
            <span className="ob-top__save-short">Saved</span>
          </span>
        </div>
        {currentStep !== "done" ? (
          <div className="ob-rail">
            {railSteps.map((step, idx) => (
              <span key={step.id} style={{ display: "contents" }}>
                <div
                  className={`ob-rail__s${idx < railActive ? " done" : ""}${idx === railActive ? " current" : ""}`}
                >
                  <div className="ob-rail__dot">{idx < railActive ? <Check className="h-3.5 w-3.5" /> : idx + 1}</div>
                  <div className="ob-rail__lbl">{step.label}</div>
                </div>
                {idx < railSteps.length - 1 ? (
                  <div className={`ob-rail__ln${idx < railActive ? " done" : ""}`} />
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <main className="ob-stage">
        {currentStep === "welcome" ? (
          <section className="ob-step is-active anim" data-step="welcome">
            <div className="ob-head">
              <div className="ob-eyebrow">
                Invitation · {isContractor ? "Contractor" : "Employee"}
              </div>
              <h1 className="ob-h1">Welcome, {person.payee_name ?? "there"}</h1>
              <p className="ob-sub">
                Review the details we already have, confirm what&apos;s correct, and add anything missing. Takes about 4
                minutes.
              </p>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <Building2 className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">Your company &amp; role</div>
                  <div className="ob-card__s">Pre-filled by {session.branding.companyName} — review only</div>
                </div>
              </div>
              <div className="ob-card__b">
                <div className="ob-rev">
                  <span className="ob-rev__k">Business unit</span>
                  <span className="ob-rev__v">{buName}</span>
                </div>
                <div className="ob-rev">
                  <span className="ob-rev__k">Role</span>
                  <span className="ob-rev__v">
                    {roleLine}
                    <small>{isContractor ? "Contractor · self-employed" : "Internal team"}</small>
                  </span>
                </div>
                <div className="ob-rev">
                  <span className="ob-rev__k">Start date</span>
                  <span className="ob-rev__v">{startDateLabel}</span>
                </div>
                <div className="ob-rev">
                  <span className="ob-rev__k">Invited email</span>
                  <span className="ob-rev__v">{profile.email || "—"}</span>
                </div>
              </div>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <BadgePoundSterling className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">Your compensation</div>
                  <div className="ob-card__s">Set by {session.branding.companyName} — review only</div>
                </div>
              </div>
              <div className="ob-card__b">
                <div className="ob-hl">
                  <div className="ob-hl__l">{feeLabel}</div>
                  <div className="ob-hl__v num">{formatCurrency(person.amount)}</div>
                  <div className="ob-hl__s">
                    {freqLabel}
                    {person.payment_day_of_month ? ` · pay day ${person.payment_day_of_month}` : ""}
                  </div>
                </div>
                <div className="ob-duo">
                  <div className="ob-mini">
                    <div className="ob-mini__l">Payment method</div>
                    <div className="ob-mini__v capitalize">
                      {person.payment_method?.replace("_", " ") ?? "Bank transfer"}
                    </div>
                  </div>
                  <div className="ob-mini">
                    <div className="ob-mini__l">Commission</div>
                    <div className="ob-mini__v">
                      {person.commission_enabled
                        ? `${person.commission_rate_percent}% on ${basisLabel}`
                        : `None — ${isContractor ? "service fee only" : "fixed pay"}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "details" ? (
          <section className="ob-step is-active anim" data-step="details">
            <div className="ob-head">
              <div className="ob-eyebrow">Step 2 · Your details</div>
              <h1 className="ob-h1">Confirm your details</h1>
              <p className="ob-sub">We&apos;ve pre-filled what we know. Please check it and complete the highlighted fields.</p>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <User className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">Contact &amp; address</div>
                  <div className="ob-card__s">How we reach you and where you&apos;re based</div>
                </div>
              </div>
              <div className="ob-card__b">
                <div className="ob-row">
                  <div className="ob-field">
                    <label>Email</label>
                    <input className="ob-inp" value={profile.email} readOnly />
                  </div>
                  <div className="ob-field">
                    <label>
                      Phone <span className="req">*</span>
                    </label>
                    <input
                      className={`ob-inp${profileField(profile, "phone") ? " ob-inp--filled" : ""}`}
                      value={profile.phone}
                      onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="+44 7…"
                    />
                  </div>
                </div>
                <div className="ob-field">
                  <label>
                    Home address <span className="req">*</span>
                  </label>
                  <AddressAutocomplete
                    value={profile.address}
                    onChange={(val) => setProfile((p) => ({ ...p, address: val }))}
                    onSelect={(parts) => setProfile((p) => ({ ...p, address: parts.full_address }))}
                    country={null}
                    variant="onboarding"
                    showMapPin={false}
                    placeholder="Start typing your address…"
                    fieldClassName={profileField(profile, "address") ? "ob-inp--filled" : ""}
                  />
                </div>
              </div>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <FileBadge className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">{isContractor ? "Tax identifiers" : "Tax & right to work"}</div>
                  <div className="ob-card__s">
                    {isContractor
                      ? "Country where you work & pay tax, plus one fiscal number"
                      : "Required for UK payroll"}
                  </div>
                </div>
              </div>
              <div className="ob-card__b">
                {isContractor ? (
                  <>
                    <div className="ob-field">
                      <label>
                        Entity type <span className="req">*</span>
                      </label>
                      <select
                        className="ob-inp"
                        value={profile.contractor_entity_type || "individual"}
                        onChange={(e) =>
                          setProfile((p) => ({
                            ...p,
                            contractor_entity_type: e.target.value,
                          }))
                        }
                      >
                        <option value="individual">Self-employed / sole trader</option>
                        <option value="company">Registered company</option>
                      </select>
                    </div>
                    <div className="ob-field">
                      <label>
                        Country <span className="req">*</span>
                      </label>
                      <p className="ob-field-hint">{COUNTRY_WORK_HINT}</p>
                      <select
                        className={`ob-inp${profileField(profile, "country_of_operation") ? " ob-inp--filled" : ""}`}
                        value={resolveCountrySelectValue(profile.country_of_operation)}
                        onChange={(e) =>
                          setProfile((p) => ({ ...p, country_of_operation: e.target.value }))
                        }
                      >
                        {countrySelectOptionsFor(profile.country_of_operation).map((opt) => (
                          <option key={opt.value || "empty"} value={opt.value} disabled={opt.disabled}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="ob-field">
                      <label>
                        {isUkContractor
                          ? profile.contractor_entity_type === "company"
                            ? "Company registration or VAT"
                            : "UTR"
                          : "Tax / fiscal number"}{" "}
                        <span className="req">*</span>
                      </label>
                      <input
                        className={`ob-inp mono${contractorTaxNumber.trim() ? " ob-inp--filled" : ""}`}
                        value={contractorTaxNumber}
                        onChange={(e) => setContractorTaxNumber(e.target.value)}
                        placeholder={
                          isUkContractor ? "UTR or Companies House / VAT" : "CNPJ, local tax ID, etc."
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="ob-row">
                    <div className="ob-field">
                      <label>
                        National Insurance no. <span className="req">*</span>
                      </label>
                      <input
                        className={`ob-inp mono${profileField(profile, "ni_number") ? " ob-inp--filled" : ""}`}
                        value={profile.ni_number}
                        onChange={(e) => setProfile((p) => ({ ...p, ni_number: e.target.value }))}
                        placeholder="QQ 12 34 56 C"
                      />
                    </div>
                    <div className="ob-field">
                      <label>Tax code</label>
                      <input
                        className="ob-inp mono"
                        value={profile.tax_code}
                        onChange={(e) => setProfile((p) => ({ ...p, tax_code: e.target.value }))}
                        placeholder="1257L"
                      />
                    </div>
                  </div>
                )}
                <div className="ob-hint">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Stored securely and only used for payroll &amp; compliance.
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "bank" ? (
          <section className="ob-step is-active anim" data-step="bank">
            <div className="ob-head">
              <div className="ob-eyebrow">Step 3 · Bank details</div>
              <h1 className="ob-h1">Where should we pay you?</h1>
              <p className="ob-sub">Payments are made in GBP to a UK bank account on pay day each month.</p>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <Landmark className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">UK bank account</div>
                  <div className="ob-card__s">Must match your legal name</div>
                </div>
              </div>
              <div className="ob-card__b">
                <div className="ob-field">
                  <label>
                    Account holder name <span className="req">*</span>
                  </label>
                  <input
                    className={`ob-inp${bank.payout_bank_account_holder.trim() ? " ob-inp--filled" : ""}`}
                    value={bank.payout_bank_account_holder}
                    onChange={(e) => setBank((b) => ({ ...b, payout_bank_account_holder: e.target.value }))}
                    placeholder="Name on the account"
                  />
                </div>
                <div className="ob-row">
                  <div className="ob-field">
                    <label>
                      Sort code <span className="req">*</span>
                    </label>
                    <input
                      className={`ob-inp mono${bank.payout_bank_sort_code.trim() ? " ob-inp--filled" : ""}`}
                      value={bank.payout_bank_sort_code}
                      onChange={(e) => setBank((b) => ({ ...b, payout_bank_sort_code: e.target.value }))}
                      placeholder="00-00-00"
                    />
                  </div>
                  <div className="ob-field">
                    <label>
                      Account number <span className="req">*</span>
                    </label>
                    <input
                      className={`ob-inp mono${bank.payout_bank_account_number.trim() ? " ob-inp--filled" : ""}`}
                      value={bank.payout_bank_account_number}
                      onChange={(e) => setBank((b) => ({ ...b, payout_bank_account_number: e.target.value }))}
                      placeholder="12345678"
                    />
                  </div>
                </div>
                <div className="ob-hint">
                  <Lock className="h-3.5 w-3.5" />
                  Encrypted. Visible only to {session.branding.companyName} payroll.
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "documents" ? (
          <section className="ob-step is-active anim" data-step="documents">
            <div className="ob-head">
              <div className="ob-eyebrow">Step 4 · Documents</div>
              <h1 className="ob-h1">Add what&apos;s missing</h1>
              <p className="ob-sub">
                Upload the required documents to complete your file. Contracts are signed digitally in the next step.
              </p>
            </div>
            <div className="ob-card">
              <div className="ob-card__b" style={{ paddingTop: 18 }}>
                {session.docKeys.map((key) => {
                  const uploaded = !!uploadedFiles[key]?.path;
                  const mandatory = session.mandatoryDocKeys?.includes(key) ?? true;
                  return (
                    <div key={key} className={`ob-doc${uploaded ? " done" : ""}`}>
                      <span className="ob-doc__ic">{uploaded ? <Check className="h-[18px] w-[18px]" /> : docIcon(key)}</span>
                      <div className="ob-doc__m">
                        <div className="ob-doc__n">{PAYROLL_UPLOAD_LABELS[key] ?? key}</div>
                        <div className={`ob-doc__d${!uploaded && mandatory ? " req" : ""}`}>
                          {uploaded ? "Uploaded" : mandatory ? "Required" : "Optional"}
                        </div>
                      </div>
                      {uploaded ? (
                        <CheckCircle className="h-5 w-5 text-[var(--green)] shrink-0" />
                      ) : (
                        <label className="btn btn--g" style={{ padding: "8px 14px", fontSize: 13 }}>
                          {uploadingKey === key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          Upload
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,image/*,.doc,.docx"
                            disabled={uploadingKey === key}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void uploadDoc(key, f).catch((err) => toast.error(String(err.message)));
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "contract" && session.contract ? (
          <section className="ob-step is-active anim" data-step="contract">
            <div className="ob-head">
              <div className="ob-eyebrow">
                Step 5 · {isContractor ? "Service agreement" : "Employment contract"}
              </div>
              <h1 className="ob-h1">Sign your {isContractor ? "agreement" : "contract"}</h1>
              <p className="ob-sub">Please read the agreement and sign at the bottom to continue.</p>
            </div>
            <div className="ob-card">
              <div className="ob-card__h">
                <span className="ob-card__ic">
                  <FileSignature className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="ob-card__t">{session.contract.title}</div>
                  <div className="ob-card__s">{session.branding.companyName}</div>
                </div>
              </div>
              <div className="ob-card__b">
                <div
                  ref={contractRef}
                  className="ob-contract ob-contract--full"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setContractScrolledEnd(true);
                  }}
                  dangerouslySetInnerHTML={{ __html: session.contract.body_html }}
                />
                <div className="ob-scrollnote" style={contractScrolledEnd ? { color: "var(--green)" } : undefined}>
                  {contractScrolledEnd ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      You&apos;ve reached the end
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3.5 w-3.5" />
                      Scroll to the end to enable signing
                    </>
                  )}
                </div>
                {signed ? (
                  <div className="ob-hint" style={{ color: "var(--green)", marginTop: 0 }}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    Contract signed — thank you
                  </div>
                ) : (
                  <div className="ob-sign">
                    <div className="ob-field" style={{ margin: 0 }}>
                      <label>
                        Sign here <span className="req">*</span>
                      </label>
                      <WorkforceSignaturePad
                        ref={signaturePadRef}
                        disabled={!contractScrolledEnd}
                        onChange={setHasSignature}
                        onDrawStart={() => {
                          if (!contractScrolledEnd) {
                            toast.error("Scroll through the contract first");
                            signaturePadRef.current?.clear();
                          }
                        }}
                      />
                      <button type="button" className="btn btn--ghost" style={{ marginTop: 8 }} onClick={clearSignature}>
                        Clear signature
                      </button>
                    </div>
                  </div>
                )}
                <label className="ob-confirm" style={{ marginTop: 16 }}>
                  <input
                    type="checkbox"
                    checked={agreeContract}
                    onChange={(e) => setAgreeContract(e.target.checked)}
                    disabled={signed}
                  />
                  I have read and agree to the {isContractor ? "service agreement" : "employment agreement"} and{" "}
                  {session.branding.companyName}&apos;s policies. I confirm the information I&apos;ve provided is accurate.
                </label>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "photo" ? (
          <section className="ob-step is-active anim" data-step="photo">
            <div className="ob-head">
              <div className="ob-eyebrow">Step 6 · Profile photo</div>
              <h1 className="ob-h1">Add a profile photo</h1>
              <p className="ob-sub">This is how your team will recognise you in the platform. A clear headshot works best.</p>
            </div>
            <div className="ob-card">
              <div className="ob-card__b" style={{ paddingTop: 24 }}>
                <div className="ob-photo-wrap">
                  <div className="ob-photo">
                    {hasProfilePhoto ? (
                      photoPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoPreview} alt="Profile" />
                      ) : (
                        <div className="ob-photo__init">{initials(person.payee_name ?? "?")}</div>
                      )
                    ) : (
                      <div className="ob-photo__ph">
                        <UserRound className="h-8 w-8" />
                        <span>No photo</span>
                      </div>
                    )}
                  </div>
                  <div className="ob-photo-actions">
                    <button
                      type="button"
                      className="btn btn--p"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploadingKey === PROFILE_PHOTO_DOC_KEY}
                    >
                      {uploadingKey === PROFILE_PHOTO_DOC_KEY ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : hasProfilePhoto ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      {hasProfilePhoto ? "Change photo" : "Upload photo"}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => void goNext()}>
                      Skip for now
                    </button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadDoc(PROFILE_PHOTO_DOC_KEY, f).catch((err) => toast.error(String(err.message)));
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
                {!isUpdateMode ? (
                  <div className="ob-card" style={{ marginTop: 16 }}>
                    <div className="ob-card__h">
                      <span className="ob-card__ic">
                        <Lock className="h-[18px] w-[18px]" />
                      </span>
                      <div>
                        <div className="ob-card__t">Platform access</div>
                        <div className="ob-card__s">Create the password you&apos;ll use to sign in to Fixfy OS</div>
                      </div>
                    </div>
                    <div className="ob-card__b">
                      <div className="ob-field">
                        <label>
                          Password <span className="req">*</span>
                        </label>
                        <input
                          type="password"
                          className={`ob-inp${platformPassword.length >= 8 ? " ob-inp--filled" : ""}`}
                          value={platformPassword}
                          onChange={(e) => setPlatformPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="ob-field" style={{ marginBottom: 0 }}>
                        <label>
                          Confirm password <span className="req">*</span>
                        </label>
                        <input
                          type="password"
                          className={`ob-inp${platformPasswordConfirm.length >= 8 ? " ob-inp--filled" : ""}`}
                          value={platformPasswordConfirm}
                          onChange={(e) => setPlatformPasswordConfirm(e.target.value)}
                          placeholder="Repeat your password"
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === "done" ? (
          <section className="ob-step is-active anim" data-step="done">
            <div className="ob-done">
              <div className="ob-done__ring">
                <Check className="h-10 w-10" />
              </div>
              <h1 className="ob-h1">
                {isUpdateMode ? "Details saved" : `You're all set, ${firstName}`}
              </h1>
              <p className="ob-sub">
                {isUpdateMode
                  ? `Your profile has been updated. ${session.branding.companyName} has your latest information.`
                  : `Your onboarding is complete and sent to ${session.branding.companyName}. Welcome to the team.`}
              </p>
              <div className="ob-checklist">
                <div className="ob-checklist__i">
                  <CheckCircle className="h-4 w-4" />
                  Details &amp; tax confirmed
                </div>
                <div className="ob-checklist__i">
                  <CheckCircle className="h-4 w-4" />
                  Bank account added
                </div>
                {session.docKeys.length > 0 ? (
                  <div className="ob-checklist__i">
                    <CheckCircle className="h-4 w-4" />
                    Documents uploaded
                  </div>
                ) : null}
                {session.contract ? (
                  <div className="ob-checklist__i">
                    <CheckCircle className="h-4 w-4" />
                    {isContractor ? "Agreement signed" : "Contract signed"}
                  </div>
                ) : null}
                <div className="ob-checklist__i">
                  <CheckCircle className="h-4 w-4" />
                  {hasProfilePhoto ? "Profile photo set" : "Profile photo skipped"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--p btn--lg"
                style={{ marginTop: 28 }}
                disabled={enteringPlatform}
                onClick={() => void enterPlatform()}
              >
                {enteringPlatform ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                Access the platform
              </button>
              {loginReady ? (
                <p className="ob-sub" style={{ marginTop: 12, fontSize: 13 }}>
                  Your account is ready — we&apos;ll sign you in when you continue.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>

      {currentStep !== "done" ? (
        <footer className="ob-foot">
          <div className="ob-foot__in">
            <span className="ob-foot__status">
              <Info className="h-4 w-4" />
              Step {Math.min(stepIndex + 1, railSteps.length)} of {railSteps.length}
            </span>
            <div className="ob-foot__spacer" />
            {stepIndex > 0 ? (
              <button type="button" className="btn btn--ghost" onClick={goBack}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--p"
              disabled={!canAdvance || submitting}
              style={{ opacity: canAdvance && !submitting ? 1 : 0.45 }}
              onClick={() => void goNext()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {steps[stepIndex]?.cta ?? "Continue"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </footer>
      ) : null}
    </>
  );
}
