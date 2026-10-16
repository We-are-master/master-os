/**
 * A aba antiga de leads do site. Leads e CRM viraram uma tela só (dono, 11/10/2026):
 * /crm, com o botão B2C | B2B. Este endereço fica para os links antigos.
 */
import { redirect } from "next/navigation";

export default function WebsiteLeadsPage() {
  redirect("/crm?side=b2c");
}
