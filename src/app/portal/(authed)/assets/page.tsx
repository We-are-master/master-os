import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { getServerSupabase } from "@/lib/supabase/server-cached";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PortalAssetsPage() {
  const auth = await requirePortalUserOrRedirect();
  const supabase = await getServerSupabase();
  const { data: rows } = await supabase
    .from("account_properties")
    .select("id, name, full_address, property_type, created_at")
    .eq("account_id", auth.accountId)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  const list = (rows ?? []) as Array<{
    id: string;
    name: string;
    full_address: string;
    property_type: string;
    created_at: string;
  }>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-text-primary">Assets</h1>
          <p className="text-sm text-text-secondary mt-1">
            Physical sites linked to your organisation — requests must reference one of these properties.
          </p>
        </div>
        <Link
          href="/portal/assets/new"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:opacity-90 transition-opacity"
        >
          Add property
        </Link>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {list.length === 0 ? (
          <div className="text-center py-14 px-6">
            <MapPin className="w-10 h-10 mx-auto text-text-tertiary mb-3" />
            <h2 className="text-base font-bold text-text-primary mb-1">No properties yet</h2>
            <p className="text-sm text-text-secondary mb-4">
              Add your first site so you can raise service requests against a real address.
            </p>
            <Link href="/portal/assets/new" className="text-sm font-bold text-orange-600 hover:underline">
              Register a property
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border-light">
            {list.map((p) => (
              <Link
                key={p.id}
                href={`/portal/assets/${p.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-secondary transition-colors group"
              >
                <div className="min-w-0 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-text-primary truncate">{p.name}</p>
                    <p className="text-xs text-text-tertiary line-clamp-2">{p.full_address}</p>
                    <p className="text-xs text-text-secondary mt-1">{p.property_type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs text-text-tertiary">
                  {formatDate(p.created_at)}
                  <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-orange-600" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
