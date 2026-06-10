"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { PAYROLL_DOC_LABELS } from "@/lib/payroll-doc-checklist";

type SessionData = {
  person: {
    id: string;
    payee_name?: string | null;
    amount: number;
    pay_frequency?: string | null;
    payment_method?: string | null;
    commission_enabled?: boolean | null;
    commission_rate_percent?: number | null;
    commission_basis?: string | null;
    payroll_profile?: Record<string, string | undefined> | null;
  };
  contract?: { id: string; title: string; body_html: string } | null;
  docKeys: string[];
  branding: { companyName: string; logoUrl: string | null };
};

export default function WorkforceOnboardClient() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workforce/onboarding/session?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load");
      setSession(data);
      const p = data.person.payroll_profile ?? {};
      setProfile({
        email: p.email ?? "",
        phone: p.phone ?? "",
        address: p.address ?? "",
        ni_number: p.ni_number ?? "",
        tax_code: p.tax_code ?? "",
        utr: p.utr ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load onboarding");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async () => {
    const res = await fetch(`/api/workforce/onboarding/session?token=${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Save failed");
    }
  };

  const uploadDoc = async (docKey: string, file: File) => {
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
    toast.success("Document uploaded");
  };

  const getSignatureDataUrl = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  };

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
    toast.success("Contract signed");
  };

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      await saveProfile();
      if (session?.contract && !signed) await signContract();
      const res = await fetch(`/api/workforce/onboarding/complete?token=${encodeURIComponent(token)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Complete failed");
      }
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-destructive">{error ?? "Invalid link"}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
        <h1 className="text-2xl font-bold">Onboarding complete</h1>
        <p className="text-muted-foreground max-w-md">
          Thank you. Our team will review your details and activate your access. Check your email for login instructions.
        </p>
      </div>
    );
  }

  const person = session.person;
  const basisLabel = person.commission_basis === "revenue" ? "revenue" : "gross profit";

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="text-center space-y-2">
          {session.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.branding.logoUrl} alt="" className="h-10 mx-auto" />
          ) : null}
          <h1 className="text-2xl font-bold">Welcome, {person.payee_name ?? "there"}</h1>
          <p className="text-sm text-muted-foreground">Complete your profile, upload documents, and sign your contract.</p>
        </header>

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Payment (set by Fixfy — read only)</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Fixed pay</span>
              <p className="font-medium">{formatCurrency(person.amount)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Frequency</span>
              <p className="font-medium capitalize">{person.pay_frequency ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Method</span>
              <p className="font-medium capitalize">{person.payment_method?.replace("_", " ") ?? "—"}</p>
            </div>
            {person.commission_enabled ? (
              <div>
                <span className="text-muted-foreground">Commission</span>
                <p className="font-medium">
                  {person.commission_rate_percent}% on {basisLabel}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Your details</h2>
          <div className="grid gap-3">
            <Input label="Email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
            <Input label="Phone" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
            <Input label="Address" value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} />
            <Input label="NI number" value={profile.ni_number} onChange={(e) => setProfile((p) => ({ ...p, ni_number: e.target.value }))} />
            <Input label="Tax code" value={profile.tax_code} onChange={(e) => setProfile((p) => ({ ...p, tax_code: e.target.value }))} />
            <Input label="UTR" value={profile.utr} onChange={(e) => setProfile((p) => ({ ...p, utr: e.target.value }))} />
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Documents</h2>
          {session.docKeys.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <span>{PAYROLL_DOC_LABELS[key] ?? key}</span>
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadDoc(key, f).catch((err) => toast.error(String(err.message)));
                }}
              />
            </div>
          ))}
        </section>

        {session.contract ? (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <h2 className="font-semibold">{session.contract.title}</h2>
            <div
              className="prose prose-sm max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: session.contract.body_html }}
            />
            <canvas
              ref={canvasRef}
              width={400}
              height={120}
              className="border rounded-md w-full bg-white touch-none"
              onMouseDown={() => { drawing.current = true; }}
              onMouseUp={() => { drawing.current = false; }}
              onMouseLeave={() => { drawing.current = false; }}
              onMouseMove={(e) => {
                if (!drawing.current || !canvasRef.current) return;
                const ctx = canvasRef.current.getContext("2d");
                if (!ctx) return;
                const rect = canvasRef.current.getBoundingClientRect();
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                ctx.strokeStyle = "#15153d";
                ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
              }}
              onTouchStart={() => { drawing.current = true; }}
              onTouchEnd={() => { drawing.current = false; }}
            />
            {signed ? <p className="text-sm text-emerald-600">Signed</p> : null}
          </section>
        ) : null}

        <Button className="w-full" onClick={() => void handleComplete()} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit onboarding"}
        </Button>
      </div>
    </div>
  );
}
