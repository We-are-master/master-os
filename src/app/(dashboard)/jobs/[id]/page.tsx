/**
 * Server Component shell for the Job Detail page.
 *
 * Pre-fetches the full job bundle (job + client + partner + payments +
 * invoice + self_bill + line_items + reports + audit) via
 * `get_job_detail_bundle` (migration 125) so the page renders with data
 * on first paint.
 */
import { fetchInitialJobDetail } from "@/lib/server-fetchers/job-detail";
import { JobDetailClient } from "./job-detail-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const initialBundle = await fetchInitialJobDetail(id);
  return <JobDetailClient initialBundle={initialBundle} />;
}
