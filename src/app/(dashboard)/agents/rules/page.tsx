import { redirect } from "next/navigation";

// Rules é o toggle da página Agents (dono, 07/10/2026).
export default function RulesRedirect() {
  redirect("/agents?view=rules");
}
