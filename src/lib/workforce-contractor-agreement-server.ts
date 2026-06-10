import { readFileSync } from "fs";
import { join } from "path";
import { fixfyContractLogoHtml } from "@/lib/brand/fixfy-contract-logo-html";
import {
  applyContractorAgreementPlaceholders,
  injectContractorAgreementPlaceholders,
  CONTRACTOR_AGREEMENT_PLACEHOLDERS,
  type ContractorAgreementPerson,
  type ContractorAgreementRenderOptions,
} from "@/lib/workforce-contractor-agreement";

let cachedTemplate: string | null = null;

export function loadContractorAgreementTemplate(): string {
  if (cachedTemplate && process.env.NODE_ENV === "production") return cachedTemplate;
  const path = join(
    process.cwd(),
    "src/lib/contract-templates/fixfy-independent-contractor-agreement.html",
  );
  const raw = readFileSync(path, "utf8");
  cachedTemplate = injectContractorAgreementPlaceholders(raw);
  return cachedTemplate;
}

export function resolveContractorAgreementHtml(
  person: ContractorAgreementPerson,
  options: ContractorAgreementRenderOptions = {},
): string {
  const withLogo = loadContractorAgreementTemplate().split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.contract_logo_html).join(fixfyContractLogoHtml());
  return applyContractorAgreementPlaceholders(withLogo, person, options);
}
