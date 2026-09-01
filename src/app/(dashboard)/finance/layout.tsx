import { requirePagePermission } from "@/lib/page-access";

/** All /finance/* pages require the `finance` permission (role matrix +
 * per-user overrides). Server-side: direct URLs are blocked, not just the
 * sidebar links. */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("finance");
  return <>{children}</>;
}
