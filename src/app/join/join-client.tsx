"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";

const APP_STORE_URL = "https://apps.apple.com/br/app/master-services/id6747205225";
// TODO: add PLAY_STORE_URL once Android is published

// ─── Onboarding slides (mirrors OnboardingScreen in the app) ─────────────────
const SLIDES = [
  {
    gradient: "linear-gradient(160deg,#020034 0%,#0A0054 50%,#1A0085 100%)",
    icon: "flash",
    title: "Welcome to\nMaster Partner",
    subtitle: "Your professional hub for jobs, earnings, and schedules — all in one place.",
  },
  {
    gradient: "linear-gradient(160deg,#E94A02 0%,#C73A00 50%,#9A2A00 100%)",
    icon: "mail",
    title: "Receive Job\nInvitations",
    subtitle: "Get notified instantly when a new job matches your skills and area.",
  },
  {
    gradient: "linear-gradient(160deg,#059669 0%,#047857 50%,#065F46 100%)",
    icon: "briefcase",
    title: "Complete Jobs\n& File Reports",
    subtitle: "Track time, document your work, and submit reports directly from the field.",
  },
  {
    gradient: "linear-gradient(160deg,#4F46E5 0%,#3730A3 50%,#1E1A78 100%)",
    icon: "cash",
    title: "Track Your\nEarnings",
    subtitle: "Monitor payments, download invoices, and grow your business with real-time data.",
  },
] as const;

// ─── SVG icons ────────────────────────────────────────────────────────────────
function SlideIcon({ name }: { name: typeof SLIDES[number]["icon"] }) {
  const cls = "w-[72px] h-[72px] fill-white";
  if (name === "flash") return (
    <svg viewBox="0 0 24 24" className={cls}>
      <path d="M13 2L4.5 14H11L10 22L19.5 10H13L13 2Z"/>
    </svg>
  );
  if (name === "mail") return (
    <svg viewBox="0 0 24 24" className={cls}>
      <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  );
  if (name === "briefcase") return (
    <svg viewBox="0 0 24 24" className={cls}>
      <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4C8.9 3 8 3.9 8 5v2H4C2.9 7 2 7.9 2 9v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-8-2h4v2h-4V5zM4 20V9h16v11H4z"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" className={cls}>
      <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
    </svg>
  );
}

// ─── Onboarding phase ─────────────────────────────────────────────────────────
function OnboardingPhase({ onComplete }: { onComplete: () => void }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef(0);
  const isLast = active === SLIDES.length - 1;

  function next() {
    if (isLast) { onComplete(); return; }
    setActive((i) => i + 1);
  }
  function skip() { onComplete(); }

  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col select-none"
      onPointerDown={(e) => { touchStartX.current = e.clientX; }}
      onPointerUp={(e) => {
        const diff = touchStartX.current - e.clientX;
        if (diff > 50 && !isLast) setActive((i) => i + 1);
        else if (diff < -50 && active > 0) setActive((i) => i - 1);
      }}
    >
      <style>{`
        @keyframes ob-zoom {
          from { opacity:0; transform:scale(.7) translateY(40px); }
          to   { opacity:1; transform:scale(1) translateY(0); }
        }
        @keyframes ob-fadeup {
          from { opacity:0; transform:translateY(16px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .ob-icon { animation: ob-zoom .45s cubic-bezier(.34,1.56,.64,1) forwards; }
        .ob-text { animation: ob-fadeup .35s ease forwards; }
      `}</style>

      {/* Gradient backgrounds — crossfade */}
      {SLIDES.map((s, i) => (
        <div
          key={i}
          className="absolute inset-0 transition-opacity duration-500"
          style={{ background: s.gradient, opacity: i === active ? 1 : 0 }}
        />
      ))}

      {/* Decorative circles */}
      <div className="absolute -top-32 -right-20 w-80 h-80 rounded-full pointer-events-none"
           style={{ background: "rgba(255,255,255,0.04)" }} />
      <div className="absolute bottom-[42%] -left-16 w-56 h-56 rounded-full pointer-events-none"
           style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* Skip */}
      <div className="relative z-10 flex justify-end pt-12 pr-6">
        {!isLast ? (
          <button
            type="button"
            onClick={skip}
            className="px-4 py-2 rounded-full text-sm font-semibold text-white/75 hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            Skip
          </button>
        ) : (
          <div className="h-9" />
        )}
      </div>

      {/* Icon — centered in top 60% */}
      <div className="relative z-10 flex-1 flex items-center justify-center pb-8">
        <div
          key={`icon-${active}`}
          className="ob-icon flex items-center justify-center rounded-full"
          style={{ width: 200, height: 200, background: "rgba(255,255,255,0.1)" }}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 160, height: 160, background: "rgba(255,255,255,0.15)" }}
          >
            <SlideIcon name={SLIDES[active].icon} />
          </div>
        </div>
      </div>

      {/* White bottom panel */}
      <div
        className="relative z-10 bg-white rounded-t-[32px] pt-8 pb-10 px-7"
        style={{ boxShadow: "0 -8px 40px rgba(0,0,0,0.15)" }}
      >
        {/* Title + subtitle */}
        <div key={`text-${active}`} className="ob-text mb-7">
          <h1 className="text-[28px] font-extrabold text-[#020034] leading-tight tracking-tight mb-3 whitespace-pre-line">
            {SLIDES[active].title}
          </h1>
          <p className="text-[15px] text-slate-500 leading-relaxed font-medium">
            {SLIDES[active].subtitle}
          </p>
        </div>

        {/* Dots */}
        <div className="flex items-center gap-1.5 mb-7">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: i === active ? 28 : 8,
                background: i === active ? "#E94A02" : "#E2E8F0",
                opacity: i === active ? 1 : 0.5,
              }}
            />
          ))}
        </div>

        {/* CTA button */}
        <button
          type="button"
          onClick={next}
          className="w-full flex items-center justify-center gap-2.5 py-[18px] rounded-[18px] font-bold text-white text-[17px] mb-5"
          style={{
            background: "linear-gradient(90deg,#FF6B2B,#E94A02)",
            boxShadow: "0 6px 24px rgba(233,74,2,0.35)",
          }}
        >
          {isLast ? "Get Started" : "Continue"}
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
            {isLast
              ? <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              : <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            }
          </svg>
        </button>

      </div>
    </div>
  );
}

// ─── Registration form ────────────────────────────────────────────────────────

type DocKey = "photo_id" | "public_liability" | "proof_of_address" | "right_to_work";

const DOC_FIELDS: { key: DocKey; label: string; hint: string }[] = [
  { key: "photo_id",         label: "Photo ID",                  hint: "Passport or driving licence" },
  { key: "public_liability", label: "Public Liability Insurance", hint: "Active insurance certificate" },
  { key: "proof_of_address", label: "Proof of Address",          hint: "Utility bill or bank statement" },
  { key: "right_to_work",    label: "Right to Work",             hint: "Visa or passport biometric page" },
];

const TRADE_OPTIONS = [...TYPE_OF_WORK_OPTIONS] as string[];

const STEPS = ["Account", "Business", "Documents"];

/** Stops Safari/iOS native "The string did not match the expected pattern" (HTML constraint validation UI). */
function suppressHtml5ValidityBubble(
  e: React.InvalidEvent<HTMLInputElement | HTMLTextAreaElement>,
) {
  e.preventDefault();
}

const invalidNoBubble = { onInvalid: suppressHtml5ValidityBubble };

/** Strip zero-width / BOM characters that sometimes break WebKit email handling. */
function normalizeEmailInput(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

/**
 * Bullet-proof error extractor.
 *
 * Walks any value (Error, plain object, nested Supabase error, array, primitive)
 * looking for a usable string message. Strips technical noise and returns one of:
 *  - the cleanest message field found, OR
 *  - a friendly fallback (never `[object Object]`, never `expected pattern`).
 */
const FRIENDLY_FALLBACK =
  "We could not complete your registration. Please double-check your details and try again.";

const TECHNICAL_NOISE_RE = /(expected pattern|\[object object\]|undefined|null)/i;

function pickStringMessage(value: unknown, depth = 0): string | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t || TECHNICAL_NOISE_RE.test(t)) return null;
    return t;
  }
  if (value instanceof Error) {
    return pickStringMessage(value.message, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const m = pickStringMessage(item, depth + 1);
      if (m) return m;
    }
    return null;
  }
  if (typeof value === "object") {
    // Prioritised keys commonly used by Supabase / Next / Postgres
    const keys = ["error_description", "message", "msg", "error", "details", "hint", "description"];
    for (const k of keys) {
      const m = pickStringMessage((value as Record<string, unknown>)[k], depth + 1);
      if (m) return m;
    }
    // Last resort: any string value in the object
    for (const v of Object.values(value as Record<string, unknown>)) {
      const m = pickStringMessage(v, depth + 1);
      if (m) return m;
    }
  }
  return null;
}

function extractFriendlyError(value: unknown, status?: number): string {
  // Network/HTTP-status hints take priority
  if (status === 409) return "An account with this email already exists.";
  if (status === 413) return "One of your files is too large. Please upload smaller files.";
  if (status === 422) {
    const m = pickStringMessage(value);
    return m ?? "Some of the details look invalid. Please review and try again.";
  }
  const msg = pickStringMessage(value);
  return msg ?? FRIENDLY_FALLBACK;
}

/**
 * Compress an image File entirely on the client (canvas). Resizes so the longest
 * edge fits in `maxDim` and re-encodes as JPEG at `quality`. Skips PDFs and any
 * file the browser can't decode (e.g. HEIC on older Safari) — returns the
 * original File in those cases so the upload still proceeds.
 *
 * Goal: keep every image well under 1 MB so the combined multipart body stays
 * inside the 4.5 MB Vercel API limit.
 */
async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number; targetMaxBytes?: number } = {},
): Promise<File> {
  const maxDim         = opts.maxDim         ?? 1600;
  const baseQuality    = opts.quality        ?? 0.82;
  const targetMaxBytes = opts.targetMaxBytes ?? 900_000; // ~0.9 MB

  // Skip non-images and PDFs entirely
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  // If already small enough, no work needed
  if (file.size <= targetMaxBytes) return file;

  // Decode the image
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Fallback to <img> + object URL (older WebKit)
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload  = () => resolve(i);
        i.onerror = () => reject(new Error("decode_failed"));
        i.src = url;
      });
      // Draw via canvas path below
      const canvas = document.createElement("canvas");
      const ratio  = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width  = Math.round(img.naturalWidth  * ratio);
      canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return file; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await canvasToJpegBlob(canvas, baseQuality, targetMaxBytes);
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } catch {
      return file;
    }
  }

  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width  * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await canvasToJpegBlob(canvas, baseQuality, targetMaxBytes);
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

/** Encode canvas → JPEG, lowering quality progressively until it fits under maxBytes. */
async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  startQuality: number,
  maxBytes: number,
): Promise<Blob | null> {
  const qualities = [startQuality, 0.7, 0.6, 0.5, 0.4];
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", q),
    );
    if (!blob) continue;
    if (blob.size <= maxBytes) return blob;
  }
  // Last attempt: aggressive downscale
  const lastCanvas = document.createElement("canvas");
  lastCanvas.width  = Math.round(canvas.width  * 0.7);
  lastCanvas.height = Math.round(canvas.height * 0.7);
  const ctx = lastCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, lastCanvas.width, lastCanvas.height);
  return new Promise<Blob | null>((resolve) =>
    lastCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.5),
  );
}

/**
 * iOS Safari throws "The string did not match the expected pattern." when FormData.append
 * receives a File whose `name` contains characters WebKit considers invalid for
 * Content-Disposition (HEIC capture without extension, special chars, accents, etc.).
 *
 * Workaround: re-wrap the File as a Blob with a clean ASCII filename.
 */
function sanitizeFileForUpload(file: File, fallbackBaseName: string): File {
  const rawName = (file.name || "").trim();
  const dot     = rawName.lastIndexOf(".");
  const rawExt  = dot > 0 ? rawName.slice(dot + 1).toLowerCase() : "";

  // Map common iOS types to safe extensions
  const typeExt = (() => {
    const t = (file.type || "").toLowerCase();
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    if (t.includes("png"))                       return "png";
    if (t.includes("webp"))                      return "webp";
    if (t.includes("heic") || t.includes("heif")) return "heic";
    if (t.includes("pdf"))                       return "pdf";
    return "";
  })();

  const safeExt = (rawExt && /^[a-z0-9]{2,5}$/.test(rawExt)) ? rawExt : (typeExt || "bin");
  const safeName = `${fallbackBaseName}.${safeExt}`;
  const safeType = file.type || "application/octet-stream";

  // Re-create as a fresh File from the underlying blob bytes — this strips any
  // problematic metadata that WebKit refuses to serialize into the multipart body.
  return new File([file], safeName, { type: safeType, lastModified: Date.now() });
}

export function JoinClient() {
  const [phase, setPhase] = useState<"onboarding" | "form">("onboarding");

  if (phase === "onboarding") {
    return <OnboardingPhase onComplete={() => setPhase("form")} />;
  }

  return <RegistrationForm />;
}

function RegistrationForm() {
  const [step, setStep]       = useState(0);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Step 0 — Account
  const [fullName,        setFullName]        = useState("");
  const [email,           setEmail]           = useState("");
  const [phone,           setPhone]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword,    setShowPassword]    = useState(false);

  // Step 1 — Business
  const [companyName,    setCompanyName]    = useState("");
  const [address,        setAddress]        = useState("");
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  const [services,       setServices]       = useState("");
  const [utr,            setUtr]            = useState("");
  const [website,        setWebsite]        = useState("");

  // Step 2 — Documents (all required) + profile/logo photo (optional)
  const [docs,         setDocs]         = useState<Partial<Record<DocKey, File>>>({});
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const profilePhotoRef                 = useRef<HTMLInputElement | null>(null);
  const fileRefs = useRef<Partial<Record<DocKey, HTMLInputElement>>>({});

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!fullName.trim()) return "Please enter your full name.";
      const emailTrim = normalizeEmailInput(email);
      if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        return "Please enter a valid email address.";
      }
      const phoneTrim = phone.replace(/\s+/g, "");
      if (!phoneTrim || phoneTrim.length < 7) return "Please enter a valid WhatsApp number.";
      if (password.length < 8) return "Password must be at least 8 characters.";
      if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter.";
      if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
      if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
      if (password !== confirmPassword) return "Passwords do not match.";
    }
    if (s === 1) {
      if (selectedTrades.length === 0) return "Please select at least one service type.";
      if (!address.trim() || address.trim().length < 10) return "Please enter your full business address (street, city and postcode).";
    }
    if (s === 2) {
      const missing = DOC_FIELDS.filter(({ key }) => !docs[key]).map(({ label }) => label);
      if (missing.length) return `Please upload: ${missing.join(", ")}.`;
    }
    return null;
  }

  function handleNext() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => s + 1);
  }

  function handleBack() { setError(null); setStep((s) => s - 1); }

  function handleFileChange(key: DocKey, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setDocs((prev) => ({ ...prev, [key]: file }));
  }

  function removeDoc(key: DocKey) {
    setDocs((prev) => { const n = { ...prev }; delete n[key]; return n; });
    if (fileRefs.current[key]) fileRefs.current[key]!.value = "";
  }

  async function handleSubmit() {
    const err = validateStep(2);
    if (err) { setError(err); return; }
    setError(null);
    setLoading(true);

    try {
      // Compress all images on the client first — keeps the multipart body
      // well under Vercel's 4.5 MB API limit even with 5 attached files.
      const [compressedProfile, ...compressedDocs] = await Promise.all([
        profilePhoto ? compressImage(profilePhoto) : Promise.resolve(null),
        ...DOC_FIELDS.map(({ key }) => {
          const f = docs[key];
          return f ? compressImage(f) : Promise.resolve(null);
        }),
      ]);

      const form = new FormData();
      form.append("fullName",         fullName.trim());
      form.append("email",            normalizeEmailInput(email).toLowerCase());
      form.append("phone",            phone.trim());
      form.append("password",         password);
      form.append("companyName",      companyName.trim());
      form.append("address",          address.trim());
      form.append("trades",           selectedTrades.join(","));
      form.append("servicesProvided", services.trim());
      form.append("utr",              utr.trim());
      form.append("website",          website.trim());

      if (compressedProfile) {
        form.append("profile_photo", sanitizeFileForUpload(compressedProfile, "profile_photo"));
      }

      DOC_FIELDS.forEach(({ key }, idx) => {
        const f = compressedDocs[idx];
        if (f) form.append(key, sanitizeFileForUpload(f, key));
      });

      const res = await fetch("/api/join/register", {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
      });

      let payload: unknown = null;
      try { payload = await res.json(); } catch { /* non-JSON response — ignore */ }

      if (!res.ok) {
        console.error("[join] API error:", res.status, payload);
        setError(extractFriendlyError(payload, res.status));
        return;
      }
      setSuccess(true);
    } catch (e: unknown) {
      console.error("[join] submit exception:", e);
      setError(extractFriendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  if (success) return <SuccessScreen />;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg,#020034 0%,#0D006E 55%,#E94A02 100%)" }}
    >
      {/* Logo */}
      <div className="mb-8 text-center">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 8px 32px rgba(233,74,2,0.35)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://wearemaster.com/favicon.png"
            alt="Master"
            className="w-12 h-12 object-contain"
          />
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight">Become a Partner</h1>
        <p className="text-white/55 text-sm mt-1">Join the Master network and start earning</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i < step ? "bg-[#E94A02] text-white" : i === step ? "bg-white text-[#020034]" : "bg-white/15 text-white/50"
            }`}>
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${i === step ? "text-white" : "text-white/40"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${i < step ? "bg-[#E94A02]" : "bg-white/20"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Form card: noValidate + autoComplete=off + per-input onInvalid — Safari iOS HTML5 validation bubbles */}
      <form
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-7"
        noValidate
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {step === 0 && (
          <Step0
            fullName={fullName}             setFullName={setFullName}
            email={email}                   setEmail={setEmail}
            phone={phone}                   setPhone={setPhone}
            password={password}             setPassword={setPassword}
            confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
            showPassword={showPassword}     setShowPassword={setShowPassword}
          />
        )}
        {step === 1 && (
          <Step1
            companyName={companyName}       setCompanyName={setCompanyName}
            address={address}               setAddress={setAddress}
            selectedTrades={selectedTrades} setSelectedTrades={setSelectedTrades}
            services={services}             setServices={setServices}
            utr={utr}                       setUtr={setUtr}
            website={website}               setWebsite={setWebsite}
          />
        )}
        {step === 2 && (
          <Step2
            docs={docs}
            fileRefs={fileRefs}
            onFileChange={handleFileChange}
            onRemove={removeDoc}
            profilePhoto={profilePhoto}
            profilePhotoRef={profilePhotoRef}
            onProfilePhotoChange={(e) => { const f = e.target.files?.[0]; if (f) setProfilePhoto(f); }}
            onRemoveProfilePhoto={() => { setProfilePhoto(null); if (profilePhotoRef.current) profilePhotoRef.current.value = ""; }}
          />
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3.5 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
            >
              Back
            </button>
          )}
          {step < 2 ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(90deg,#FF6B2B,#E94A02)" }}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(90deg,#FF6B2B,#E94A02)" }}
            >
              {loading ? "Submitting…" : "Submit Application"}
            </button>
          )}
        </div>
      </form>

    </div>
  );
}

// ─── Step sub-components ──────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition";

function Step0({
  fullName,
  setFullName,
  email,
  setEmail,
  phone,
  setPhone,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  showPassword,
  setShowPassword,
}: {
  fullName: string;
  setFullName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <>
      <h2 className="text-lg font-bold text-slate-800 mb-5">Create your account</h2>
      <Field label="Full name" required>
        <input
          className={inputCls}
          placeholder="John Smith"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          name="join_full_name"
          autoComplete="name"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="Email address" required>
        <p className="text-xs text-slate-400 mb-1.5">We&apos;ll use this email to send you job updates and important notifications — make sure it&apos;s one you check regularly.</p>
        <input
          className={inputCls}
          type="text"
          placeholder="john@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="email"
          name="join_email"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="WhatsApp number" required>
        <p className="text-xs text-slate-400 mb-1.5">This is how our team will contact you about jobs and schedule — please use an active WhatsApp number.</p>
        <input
          className={inputCls}
          type="tel"
          placeholder="+44 7700 900000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          name="join_phone"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="Password" required>
        <div className="relative">
          <input
            className={inputCls}
            type={showPassword ? "text" : "password"}
            placeholder="8+ chars: lower, upper, number"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            name="join_password"
            {...invalidNoBubble}
          />
          <button type="button" onClick={() => setShowPassword((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-medium">
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Field label="Confirm password" required>
        <input
          className={inputCls}
          type={showPassword ? "text" : "password"}
          placeholder="Repeat password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          name="join_password_confirm"
          {...invalidNoBubble}
        />
      </Field>
    </>
  );
}

function Step1({
  companyName,
  setCompanyName,
  address,
  setAddress,
  selectedTrades,
  setSelectedTrades,
  services,
  setServices,
  utr,
  setUtr,
  website,
  setWebsite,
}: {
  companyName: string;
  setCompanyName: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  selectedTrades: string[];
  setSelectedTrades: Dispatch<SetStateAction<string[]>>;
  services: string;
  setServices: (v: string) => void;
  utr: string;
  setUtr: (v: string) => void;
  website: string;
  setWebsite: (v: string) => void;
}) {
  function toggleTrade(trade: string) {
    setSelectedTrades((prev: string[]) =>
      prev.includes(trade) ? prev.filter((t: string) => t !== trade) : [...prev, trade]
    );
  }

  return (
    <>
      <h2 className="text-lg font-bold text-slate-800 mb-5">Business details</h2>
      <Field label="Company / trading name">
        <input
          className={inputCls}
          placeholder="Smith Plumbing Ltd"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          name="join_company"
          autoComplete="organization"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="Full address" required>
        <p className="text-xs text-slate-400 mb-1.5">Your home or registered business address (street, city and postcode).</p>
        <AddressAutocomplete
          value={address}
          onChange={(v) => setAddress(v)}
          onSelect={(parts: AddressParts) => setAddress(parts.full_address)}
          placeholder="Start typing your address or postcode..."
          country="gb"
        />
      </Field>
      <Field label="Service type" required>
        <p className="text-xs text-slate-400 mb-2">Select all that apply</p>
        <div className="flex flex-wrap gap-2">
          {TRADE_OPTIONS.map((trade) => {
            const active = selectedTrades.includes(trade);
            return (
              <button
                key={trade}
                type="button"
                onClick={() => toggleTrade(trade)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-[#E94A02] border-[#E94A02] text-white"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:border-orange-300 hover:text-orange-600"
                }`}
              >
                {trade}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Additional details (optional)">
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          placeholder="e.g. specialisations, certifications…"
          value={services}
          onChange={(e) => setServices(e.target.value)}
          name="join_services"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="UTR number (optional)">
        <input
          className={inputCls}
          placeholder="1234567890"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          name="join_utr"
          {...invalidNoBubble}
        />
      </Field>
      <Field label="Website (optional)">
        <input
          className={inputCls}
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://yoursite.co.uk"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          name="join_website"
          {...invalidNoBubble}
        />
      </Field>
    </>
  );
}

function Step2({ docs, fileRefs, onFileChange, onRemove, profilePhoto, profilePhotoRef, onProfilePhotoChange, onRemoveProfilePhoto }: {
  docs: Partial<Record<DocKey, File>>;
  fileRefs: React.MutableRefObject<Partial<Record<DocKey, HTMLInputElement>>>;
  onFileChange: (key: DocKey, e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (key: DocKey) => void;
  profilePhoto: File | null;
  profilePhotoRef: React.MutableRefObject<HTMLInputElement | null>;
  onProfilePhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveProfilePhoto: () => void;
}) {
  const photoPreview = useMemo(() => {
    if (!profilePhoto) return null;
    try {
      return URL.createObjectURL(profilePhoto);
    } catch {
      return null;
    }
  }, [profilePhoto]);

  // Revoke the blob URL when the photo changes or component unmounts
  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);

  return (
    <>
      <h2 className="text-lg font-bold text-slate-800 mb-1">Documents</h2>
      <p className="text-sm text-slate-500 mb-5">All documents are required to process your application.</p>

      {/* Profile / logo photo — optional */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
          Profile photo or company logo <span className="text-slate-400 font-normal normal-case">(optional)</span>
        </p>
        {profilePhoto ? (
          <div className="flex items-center gap-3 rounded-xl border-2 border-blue-300 bg-blue-50 p-3.5">
            {photoPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="preview" className="w-12 h-12 rounded-lg object-cover shrink-0 border border-blue-200" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{profilePhoto.name}</p>
              <p className="text-xs text-slate-500">Profile / logo photo</p>
            </div>
            <button type="button" onClick={onRemoveProfilePhoto} className="text-slate-400 hover:text-red-500 text-xs font-medium shrink-0">Remove</button>
          </div>
        ) : (
          <label className="flex items-center gap-3 cursor-pointer group rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:border-orange-300 p-3.5 transition-colors">
            <input
              ref={profilePhotoRef}
              type="file"
              className="hidden"
              accept="image/*"
              onChange={onProfilePhotoChange}
              {...invalidNoBubble}
            />
            <div className="w-10 h-10 rounded-lg bg-slate-200 group-hover:bg-orange-100 flex items-center justify-center transition-colors shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-slate-400 group-hover:fill-orange-400 transition-colors">
                <path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.7 0-8 1.35-8 4v2h16v-2c0-2.65-5.3-4-8-4z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Upload photo or logo</p>
              <p className="text-xs text-slate-400">JPG, PNG or WebP</p>
            </div>
          </label>
        )}
      </div>

      <div className="space-y-3">
        {DOC_FIELDS.map(({ key, label, hint }) => (
          <div key={key}
            className={`rounded-xl border-2 p-3.5 transition-colors ${docs[key] ? "border-green-400 bg-green-50" : "border-slate-200 bg-slate-50 hover:border-orange-300"}`}>
            {docs[key] ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-green-600 text-lg">✓</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                    <p className="text-xs text-slate-500 truncate">{docs[key]!.name}</p>
                  </div>
                </div>
                <button type="button" onClick={() => onRemove(key)} className="text-slate-400 hover:text-red-500 text-xs font-medium shrink-0">Remove</button>
              </div>
            ) : (
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  ref={(el) => { fileRefs.current[key] = el ?? undefined; }}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => onFileChange(key, e)}
                  {...invalidNoBubble}
                />
                <div className="w-8 h-8 rounded-lg bg-slate-200 group-hover:bg-orange-100 flex items-center justify-center transition-colors shrink-0">
                  <span className="text-slate-500 group-hover:text-orange-500 text-lg leading-none">+</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{label} <span className="text-red-400 text-xs">*</span></p>
                  <p className="text-xs text-slate-400">{hint}</p>
                </div>
              </label>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg,#020034 0%,#0D006E 55%,#E94A02 100%)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-2">Application submitted!</h2>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          Your documents are under review. Once approved, you will be able to start accepting jobs.
          Download the app and sign in to track your status.
        </p>
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-4 px-6 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white shrink-0">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
          <div className="text-left">
            <div className="text-xs text-white/60 leading-none">Download on the</div>
            <div className="text-base font-bold leading-tight">App Store</div>
          </div>
        </a>
        <p className="text-xs text-slate-400 mt-4">Use the same email and password to sign in.</p>
      </div>
    </div>
  );
}
