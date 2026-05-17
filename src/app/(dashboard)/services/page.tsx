import { redirect } from "next/navigation";

/** Legacy route — catalog lives under Settings → Service catalog tab. */
export default function ServicesCatalogRedirectPage() {
  redirect("/settings?tab=service-catalog");
}
