import { requirePagePermission } from "@/lib/page-access";

/** Workforce holds payroll and personal data — Admin role only, matching the
 * nav's ADMIN_ONLY declaration for /people (the matrix cannot open it for
 * manager/operator). The sidebar hiding the link is cosmetic; this layout is
 * what actually blocks direct URLs. */
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("team", { adminOnly: true });
  return <>{children}</>;
}
