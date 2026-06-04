"use client";

import { usePathname, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { BillingCreatedAtFilter } from "@/components/finance/billing-created-at-filter";
import {
  BillingFilterProvider,
  useBillingCreatedAtFilter,
  useBillingHeaderActions,
} from "@/components/finance/billing-filter-context";

function BillingLayoutHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { filter, setFilter } = useBillingCreatedAtFilter();
  const headerActions = useBillingHeaderActions();
  const activeTab = pathname.includes("/selfbill") ? "selfbill" : "invoices";

  return (
    <PageHeader
      title="Billing"
      subtitle="Customer receivables and partner self-billing."
      eyebrow="Finance · Billing"
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        <BillingCreatedAtFilter value={filter} onChange={setFilter} />
        {headerActions}
      </div>
    </PageHeader>
  );
}

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <BillingFilterProvider>
      <div className="space-y-5">
        <BillingLayoutHeader />
        {children}
      </div>
    </BillingFilterProvider>
  );
}
