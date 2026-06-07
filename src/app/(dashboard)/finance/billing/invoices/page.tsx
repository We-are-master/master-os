import { redirect } from "next/navigation";

export default function BillingInvoicesRedirectPage() {
  redirect("/finance/billing?tab=inv");
}
