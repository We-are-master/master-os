import { getSupabase } from "./base";

const JOB_REPORTS_BUCKET = "job-reports";

export type AppJobReportRow = {
  id: string;
  job_id: string;
  phase: number;
  pdf_url: string | null;
  description: string | null;
  materials: string | null;
  uploaded_at: string;
  created_at: string | null;
};

/** Rows written by the partner app (table `job_reports`). */
export async function listAppJobReports(jobId: string): Promise<AppJobReportRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("job_reports")
    .select("id, job_id, phase, pdf_url, description, materials, uploaded_at, created_at")
    .eq("job_id", jobId)
    .order("phase", { ascending: true })
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppJobReportRow[];
}

/**
 * The app stores `getPublicUrl` for bucket `job-reports`, which is private — the public URL does not load.
 * Extract the object path so we can `createSignedUrl` in the dashboard.
 */
export function jobReportPdfPathFromStoredUrl(pdfUrl: string): string | null {
  if (!pdfUrl?.trim()) return null;
  try {
    const u = new URL(pdfUrl);
    const pathname = u.pathname;
    const re = /\/object\/(?:public|sign)\/job-reports\/(.+)$/;
    const m = pathname.match(re);
    if (m) return decodeURIComponent(m[1]);
    const idx = pathname.indexOf("/job-reports/");
    if (idx !== -1) return decodeURIComponent(pathname.slice(idx + "/job-reports/".length));
  } catch {
    return null;
  }
  return null;
}

/** Time-limited URL for opening the PDF in the browser (private bucket). */
export async function createSignedJobReportPdfUrl(pdfUrl: string, expiresSec = 3600): Promise<string | null> {
  const path = jobReportPdfPathFromStoredUrl(pdfUrl);
  if (!path) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(JOB_REPORTS_BUCKET).createSignedUrl(path, expiresSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
