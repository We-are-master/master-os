import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Calendar, ClipboardList, FileText, MapPin, Star, User } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalJobDetailRich } from "@/lib/server-fetchers/portal-job-detail";
import { JobHero } from "@/components/portal/job-hero";
import { JobStatsAnchor } from "@/components/portal/job-stats-anchor";
import { JobPhaseTimeline } from "@/components/portal/job-phase-timeline";
import { JobFinancialCard } from "@/components/portal/job-financial-card";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unassigned:         "Pending schedule",
  auto_assigning:     "Pending schedule",
  scheduled:          "Scheduled",
  late:               "Scheduled",
  in_progress_phase1: "In progress",
  in_progress_phase2: "In progress",
  in_progress_phase3: "In progress",
  in_progress:        "In progress",
  final_check:        "Final check",
  awaiting_payment:   "Awaiting payment",
  completed:          "Completed",
  cancelled:          "Cancelled",
  on_hold:            "On hold",
  need_attention:     "Needs attention",
};

const STATUS_COLOR: Record<string, string> = {
  unassigned:         "bg-amber-400/90 text-amber-950",
  auto_assigning:     "bg-amber-400/90 text-amber-950",
  scheduled:          "bg-sky-400/90 text-sky-950",
  late:               "bg-sky-400/90 text-sky-950",
  in_progress_phase1: "bg-orange-400/90 text-orange-950",
  in_progress_phase2: "bg-orange-400/90 text-orange-950",
  in_progress_phase3: "bg-orange-400/90 text-orange-950",
  in_progress:        "bg-orange-400/90 text-orange-950",
  final_check:        "bg-violet-400/90 text-violet-950",
  awaiting_payment:   "bg-rose-400/90 text-rose-950",
  completed:          "bg-emerald-400/90 text-emerald-950",
  cancelled:          "bg-stone-400/90 text-stone-950",
  on_hold:            "bg-amber-400/90 text-amber-950",
  need_attention:     "bg-amber-400/90 text-amber-950",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalJobDetailPage({ params }: PageProps) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const job = await fetchPortalJobDetailRich(id, auth.accountId);
  if (!job) notFound();

  const statusLabel = STATUS_LABEL[job.status] ?? job.status.replace(/_/g, " ");
  const statusColor = STATUS_COLOR[job.status] ?? "bg-stone-300 text-stone-900";

  const allImages = [
    ...job.images,
    ...(job.report?.after_images ?? []),
    ...(job.report?.before_images ?? []),
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link
        href="/portal/jobs"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to jobs
      </Link>

      <JobHero
        reference={job.reference}
        title={job.title}
        statusLabel={statusLabel}
        statusClassName={statusColor}
        images={allImages}
        address={job.property_address}
      />

      <JobOverdueBadge job={job} />

      <JobStatsAnchor
        currentPhase={job.current_phase}
        totalPhases={job.total_phases}
        scheduledStartAt={job.scheduled_start_at}
        scheduledFinishDate={job.scheduled_finish_date}
        partnerTimerStartedAt={job.partner_timer_started_at}
        partnerTimerEndedAt={job.partner_timer_ended_at}
        partnerTimerAccumPausedMs={job.partner_timer_accum_paused_ms}
        partnerTimerIsPaused={job.partner_timer_is_paused}
        partnerTimerPauseBeganAt={job.partner_timer_pause_began_at}
        status={job.status}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — timeline + scope */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-card rounded-2xl border border-border overflow-hidden">
            <header className="px-5 py-4 border-b border-border-light">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-text-tertiary" />
                Progress
              </h2>
            </header>
            <div className="px-5 py-5">
              <JobPhaseTimeline
                currentStatus={job.status}
                events={job.phases}
                createdAt={job.created_at}
              />
            </div>
          </section>

          {job.scope && (
            <section className="bg-card rounded-2xl border border-border overflow-hidden">
              <header className="px-5 py-4 border-b border-border-light">
                <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-text-tertiary" />
                  Scope of work
                </h2>
              </header>
              <div className="px-5 py-4 text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                {job.scope}
              </div>
            </section>
          )}

          {job.report && (job.report.before_images.length > 0 || job.report.after_images.length > 0) && (
            <section className="bg-card rounded-2xl border border-border overflow-hidden">
              <header className="px-5 py-4 border-b border-border-light flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <FileText className="w-4 h-4 text-text-tertiary" />
                  Site photos
                </h2>
                {job.report.pdf_url && (
                  <a
                    href={job.report.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Download report (PDF)
                  </a>
                )}
              </header>
              <div className="px-5 py-4 space-y-4">
                {job.report.before_images.length > 0 && (
                  <PhotoStrip label="Before" images={job.report.before_images} />
                )}
                {job.report.after_images.length > 0 && (
                  <PhotoStrip label="After" images={job.report.after_images} />
                )}
              </div>
            </section>
          )}

          {job.customer_review_rating != null && (
            <section className="bg-card rounded-2xl border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <h2 className="text-sm font-semibold text-text-primary">Your review</h2>
              </div>
              <div className="flex items-center gap-1 mb-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`w-4 h-4 ${
                      i < (job.customer_review_rating ?? 0)
                        ? "text-amber-500 fill-amber-500"
                        : "text-stone-300"
                    }`}
                  />
                ))}
              </div>
              {job.customer_review_comment && (
                <p className="text-sm text-text-secondary italic">&ldquo;{job.customer_review_comment}&rdquo;</p>
              )}
            </section>
          )}
        </div>

        {/* Right — sidebar details + financial */}
        <aside className="space-y-6">
          <section className="bg-card rounded-2xl border border-border overflow-hidden">
            <header className="px-5 py-4 border-b border-border-light">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <User className="w-4 h-4 text-text-tertiary" />
                Details
              </h2>
            </header>
            <div className="p-5 space-y-4">
              <SidebarRow
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Scheduled"
                value={formatWindow(job.scheduled_start_at, job.scheduled_end_at, job.scheduled_date)}
              />
              <SidebarRow
                icon={<User className="w-3.5 h-3.5" />}
                label="Assigned to"
                value={job.partner_name || "Master team"}
              />
              {job.property_address && (
                <SidebarRow
                  icon={<MapPin className="w-3.5 h-3.5" />}
                  label="Address"
                  value={job.property_address}
                />
              )}
            </div>
          </section>

          <JobFinancialCard
            clientPrice={job.client_price}
            depositRequired={job.deposit_required}
            depositPaid={job.customer_deposit_paid}
            finalPayment={job.customer_final_payment}
            finalPaid={job.customer_final_paid}
            payments={job.payments}
            invoices={job.invoices}
          />
        </aside>
      </div>
    </div>
  );
}

function SidebarRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium text-text-primary leading-snug">{value}</p>
    </div>
  );
}

function PhotoStrip({ label, images }: { label: string; images: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((src, i) => (
          <a
            key={`${label}-${i}`}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="relative aspect-square rounded-lg overflow-hidden bg-surface-tertiary hover:opacity-90 transition-opacity"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${label} ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function formatWindow(startIso: string | null, endIso: string | null, fallbackDate: string | null): string {
  if (startIso) {
    const start = new Date(startIso).toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    if (endIso) {
      const end = new Date(endIso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      return `${start} – ${end}`;
    }
    return start;
  }
  if (fallbackDate) {
    return new Date(fallbackDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  return "To be scheduled";
}
