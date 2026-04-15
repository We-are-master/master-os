import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Building2,
  MapPin,
  Users,
  ClipboardList,
  Briefcase,
  ShieldCheck,
  FileText,
  History,
} from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountPropertyDetailBundle } from "@/lib/server-fetchers/account-property-detail";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PortalAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const bundle = await fetchAccountPropertyDetailBundle(id, { accountId: auth.accountId });
  if (!bundle) notFound();

  const { property, account, primaryContact, accountContacts, requests, jobs, documents, audit, partnerCompliance } =
    bundle;

  return (
    <div className="space-y-8 max-w-3xl">
      <Link
        href="/portal/assets"
        className="inline-flex text-sm text-text-secondary hover:text-text-primary"
      >
        ← Back to assets
      </Link>

      <div>
        <h1 className="text-2xl font-black text-text-primary">{property.name}</h1>
        <p className="text-sm text-text-secondary mt-1">{property.full_address}</p>
        <p className="text-xs text-text-tertiary mt-2">{property.property_type}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">How this fits</p>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Building2 className="w-5 h-5 text-orange-600 shrink-0" />
            <div>
              <p className="font-semibold">Account</p>
              <p className="text-text-secondary">{account.company_name}</p>
            </div>
          </li>
          <li className="flex gap-3 pl-4 border-l-2 border-border-light">
            <Users className="w-5 h-5 text-text-tertiary shrink-0" />
            <div>
              <p className="font-semibold">Contacts</p>
              <p className="text-xs text-text-tertiary mb-1">{accountContacts.length} on this account</p>
              <ul className="text-text-secondary space-y-0.5">
                {accountContacts.slice(0, 6).map((c) => (
                  <li key={c.id}>{c.full_name}</li>
                ))}
              </ul>
            </div>
          </li>
          <li className="flex gap-3 pl-4 border-l-2 border-border-light">
            <MapPin className="w-5 h-5 text-orange-600 shrink-0" />
            <div>
              <p className="font-semibold">This property</p>
              {primaryContact && (
                <p className="text-xs text-text-tertiary">Site contact: {primaryContact.full_name}</p>
              )}
              {property.phone && <p className="text-xs text-text-tertiary">Phone: {property.phone}</p>}
            </div>
          </li>
        </ol>
      </div>

      {property.notes && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-text-secondary whitespace-pre-wrap">
          {property.notes}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="w-5 h-5 text-orange-600" />
          <h2 className="font-bold">Requests</h2>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-text-tertiary">None yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <Link href="/portal/requests" className="font-medium text-orange-600 hover:underline">
                  {r.reference}
                </Link>
                <span className="text-text-tertiary">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase className="w-5 h-5 text-orange-600" />
          <h2 className="font-bold">Jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-text-tertiary">None yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex justify-between gap-2">
                <Link href={`/portal/jobs/${j.id}`} className="font-medium text-orange-600 hover:underline">
                  {j.reference}
                </Link>
                <span className="text-text-tertiary">{j.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-orange-600" />
          <h2 className="font-bold">Partner compliance</h2>
        </div>
        {partnerCompliance.length === 0 ? (
          <p className="text-sm text-text-tertiary">No partners on jobs at this site yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {partnerCompliance.map((p) => (
              <li key={p.id} className="flex justify-between border border-border-light rounded-lg px-3 py-2">
                <span>{p.company_name}</span>
                <span className="text-text-tertiary">
                  {p.compliance_score != null ? `${Math.round(p.compliance_score)}%` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-orange-600" />
          <h2 className="font-bold">Documents</h2>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-text-tertiary">No files yet.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id}>
                <a
                  href={`/api/portal/property-documents/${d.id}`}
                  className="text-sm font-medium text-orange-600 hover:underline"
                >
                  {d.file_name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-orange-600" />
          <h2 className="font-bold">Activity</h2>
        </div>
        {audit.length === 0 ? (
          <p className="text-sm text-text-tertiary">No activity logged yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="border-l-2 border-orange-200 pl-3">
                <p className="font-medium capitalize">{a.action.replace(/_/g, " ")}</p>
                <p className="text-xs text-text-tertiary">
                  {a.user_name ?? "System"} · {formatRelativeTime(a.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
