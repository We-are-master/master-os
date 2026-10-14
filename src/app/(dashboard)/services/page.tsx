import { PageTransition } from "@/components/layout/page-transition";
import { SettingsTabsBar } from "@/components/settings/settings-tabs-bar";
import { ServicesPricingClient } from "./services-pricing-client";

/** Services é uma aba do Settings (14/10/2026): topo do Settings e o catálogo embutido. */
export default function ServicesPage() {
  return (
    <PageTransition>
      <div className="space-y-6">
        <SettingsTabsBar active="services" />
        <ServicesPricingClient embedded />
      </div>
    </PageTransition>
  );
}
