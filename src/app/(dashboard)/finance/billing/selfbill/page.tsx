import { redirect } from "next/navigation";

type Props = { searchParams: Promise<{ open?: string; focus?: string }> };

export default async function BillingSelfBillRedirectPage({ searchParams }: Props) {
  const sp = await searchParams;
  const id = sp.open ?? sp.focus;
  if (id) {
    redirect(`/finance/billing?tab=sb&selfBillId=${encodeURIComponent(id)}`);
  }
  redirect("/finance/billing?tab=sb");
}
