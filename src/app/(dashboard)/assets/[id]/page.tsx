import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { fetchAccountPropertyDetailBundle } from "@/lib/server-fetchers/account-property-detail";
import { formatRelativeTime } from "@/lib/utils";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Users,
  ClipboardList,
  Briefcase,
  ShieldCheck,
  History,
} from "lucide-react";
import { PropertyDocumentsSection } from "@/components/assets/property-documents-section";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await fetchAccountPropertyDetailBundle(id);
  if (!bundle) notFound();

  const { property, account, primaryContact, accountContacts, requests, jobs, documents, audit, partnerCompliance } =
    bundle;

  return (
    <PageTransition>
      <div className="space-y-8 max-w-5xl">
        <div className="flex flex-col gap-4">
          <Link
            href="/assets"
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to assets
          </Link>

          <PageHeader
            title={property.name}
            subtitle={property.full_address}
          >
            <Badge variant="primary" size="md">
              {property.property_type}
            </Badge>
          </PageHeader>
        </div>

        {/* Hierarchy */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Structure</p>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <Building2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Account (client organisation)</p>
                <p className="text-text-secondary">{account.company_name}</p>
                <Link href="/accounts" className="text-xs text-primary font-semibold mt-1 inline-block">
                  Open accounts
                </Link>
              </div>
            </li>
            <li className="flex gap-3 pl-6 border-l-2 border-border-light">
              <Users className="w-5 h-5 text-text-tertiary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Contacts on this account</p>
                <p className="text-text-tertiary text-xs mb-1">
                  {accountContacts.length} contact{accountContacts.length === 1 ? "" : "s"} — same records used
                  elsewhere as clients linked to the account.
                </p>
                <ul className="text-text-secondary space-y-0.5">
                  {accountContacts.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      {c.full_name}
                      {c.email ? ` · ${c.email}` : ""}
                    </li>
                  ))}
                  {accountContacts.length > 8 && (
                    <li className="text-text-tertiary">+{accountContacts.length - 8} more</li>
                  )}
                </ul>
              </div>
            </li>
            <li className="flex gap-3 pl-6 border-l-2 border-border-light">
              <MapPin className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Property (this site)</p>
                <p className="text-text-secondary">{property.name}</p>
                {primaryContact && (
                  <p className="text-xs text-text-tertiary mt-1">
                    Primary site contact:{" "}
                    <span className="text-text-secondary font-medium">{primaryContact.full_name}</span>
                  </p>
                )}
                {property.phone && (
                  <p className="text-xs text-text-tertiary mt-1">Phone: {property.phone}</p>
                )}
              </div>
            </li>
          </ol>
        </div>

        {property.notes && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary mb-2">Notes</p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{property.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-text-primary">Requests at this property</h2>
            </div>
            {requests.length === 0 ? (
              <p className="text-sm text-text-tertiary">No requests linked yet.</p>
            ) : (
              <ul className="divide-y divide-border-light">
                {requests.map((r) => (
                  <li key={r.id} className="py-2 flex justify-between gap-2 text-sm">
                    <Link href={`/requests`} className="font-medium text-primary hover:underline">
                      {r.reference}
                    </Link>
                    <span className="text-text-tertiary shrink-0">{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-text-primary">Jobs at this property</h2>
            </div>
            {jobs.length === 0 ? (
              <p className="text-sm text-text-tertiary">No jobs linked yet.</p>
            ) : (
              <ul className="divide-y divide-border-light">
                {jobs.map((j) => (
                  <li key={j.id} className="py-2 flex justify-between gap-2 text-sm">
                    <Link href={`/jobs/${j.id}`} className="font-medium text-primary hover:underline">
                      {j.reference}
                    </Link>
                    <span className="text-text-tertiary shrink-0">{j.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-text-primary">Partner compliance (from jobs)</h2>
          </div>
          {partnerCompliance.length === 0 ? (
            <p className="text-sm text-text-tertiary">
              No partner assignments on jobs at this site yet. Compliance scores come from the partner directory.
            </p>
          ) : (
            <ul className="space-y-2">
              {partnerCompliance.map((p) => (
                <li key={p.id} className="flex justify-between text-sm border border-border-light rounded-lg px-3 py-2">
                  <span className="font-medium text-text-primary">{p.company_name}</span>
                  <span className="text-text-secondary">
                    Score: {p.compliance_score != null ? `${Math.round(p.compliance_score)}%` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <PropertyDocumentsSection
          propertyId={property.id}
          accountId={property.account_id}
          initialDocuments={documents}
        />

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-text-primary">Activity</h2>
          </div>
          {audit.length === 0 ? (
            <p className="text-sm text-text-tertiary">No audit entries for this property yet.</p>
          ) : (
            <ul className="space-y-3">
              {audit.map((a) => (
                <li key={a.id} className="text-sm border-l-2 border-primary/30 pl-3">
                  <p className="font-medium text-text-primary capitalize">
                    {a.action.replace(/_/g, " ")}
                    {a.field_name ? ` · ${a.field_name}` : ""}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {a.user_name ?? "System"} · {formatRelativeTime(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageTransition>
  );
}
