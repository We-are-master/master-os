import { fetchInitialLeads } from "@/lib/server-fetchers/leads";
import { LeadsClient } from "./leads-client";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const initialData = await fetchInitialLeads({ status: "new", pageSize: 10 });
  return <LeadsClient initialData={initialData} />;
}
