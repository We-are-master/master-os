"use client";

import { usePathname, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = pathname.includes("/selfbill") ? "selfbill" : "invoices";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        subtitle="Customer receivables and partner self-billing."
      >
        <Tabs
          variant="pills"
          className="max-w-full shrink-0"
          tabs={[
            { id: "invoices", label: "Invoices" },
            { id: "selfbill", label: "Self-Billing" },
          ]}
          activeTab={activeTab}
          onChange={(id) => {
            if (id === "invoices") router.push("/finance/billing/invoices");
            else router.push("/finance/billing/selfbill");
          }}
        />
      </PageHeader>
      {children}
    </div>
  );
}
