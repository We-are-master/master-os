import { redirect } from "next/navigation";

// Rules mora dentro de Agents (dono, 07/10/2026).
export default function RulesRedirect() {
  redirect("/agents/rules");
}
