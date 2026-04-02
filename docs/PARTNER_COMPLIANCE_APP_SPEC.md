# Partner compliance — regras (Master OS) para replicar no app

Documento de referência para implementar o mesmo comportamento noutro repositório (app mobile / onboarding).  
Fonte: `src/lib/partner-compliance.ts`, `src/lib/partner-uk-coverage.ts`, `src/app/(dashboard)/partners/page.tsx`.

---

## 1. Tipo legal (`partner_legal_type`)

| Valor | Identificador fiscal (perfil) | Documento UTR na checklist |
|-------|--------------------------------|----------------------------|
| `self_employed` | Campo `utr` (texto) obrigatório para pontos | Sim — ficheiro `doc_type: utr` |
| `limited_company` | Campo `crn` (texto) obrigatório para pontos | Não |

**VAT (limited company):** coluna `vat_registered` (`boolean | null`). Se `false`, não há número de VAT e o campo não é mostrado. Se `true`, `vat_number` é obrigatório. Legado: só `vat_number` preenchido implica registado.

**Legado (inferência se `partner_legal_type` null):** se `crn` preenchido → tratar como `limited_company`; senão → `self_employed`.

---

## 2. Perfil — itens e pesos (0–100 do perfil)

Soma dos pesos = 100. Cada item `done` soma o peso.

| id | Peso | Regra `done` |
|----|------|----------------|
| `email` | 14 | `email` não vazio |
| `phone` | 12 | `phone` não vazio |
| `address` | 14 | `partner_address` OR `location` (legado) não vazio |
| `coverage` | 14 | `uk_coverage_regions` com pelo menos 1 região OU `location` legado (fallback) |
| `tax_id` | 18 | Limited: `crn`; Self: `utr` |
| `vat` | 8 | Ver `isVatProfileComplete`: limited + `vat_registered === false` → feito; limited + `true` → precisa `vat_number`; limited legado só número → feito; self-employed → `vat_number` não vazio |
| `identity` | 20 | `company_name` E `contact_name` não vazios |

**Cobertura UK (`uk_coverage_regions`):**

- Multi-select de regiões; **padrão: London**. Sem opção “Whole UK” no OS — combinar chips (ex.: London + Outside London + outras).
- Regiões: London, Outside London, South East, South West, East of England, West Midlands, East Midlands, Yorkshire & Humber, North West, North East, Scotland, Wales, Northern Ireland.
- Legado `__whole_uk__` na BD é ignorado na normalização (trata-se como vazio e volta ao default London até o utilizador guardar de novo).

---

## 3. Documentos obrigatórios (checklist base)

Ordem lógica: **core** → **UTR (só self-employed)** → **certificados por trade**.

### 3.1 Core (todos)

| id | Nome UI | doc_type | aliases (match no nome do ficheiro, lowercase) |
|----|---------|----------|--------------------------------------------------|
| `photo_id` | Photo ID | `id_proof` | photo id, passport, driver license, driving license, id proof |
| `proof_of_address` | Proof of Address | `other` | proof of address, utility bill, bank statement, address proof |
| `right_to_work` | Right to Work | `other` | right to work, share code, birth certificate, british passport, passport |
| `public_liability` | Public Liability Insurance | `insurance` | public liability, insurance, liability insurance |

### 3.2 UTR (só `self_employed`)

| id | Nome UI | doc_type | aliases |
|----|---------|----------|---------|
| `utr_hmrc` | UTR (HMRC) | `utr` | utr, hmrc, unique taxpayer, utr (hmrc), tax reference |

### 3.3 Certificados por ofício (trade)

Para **cada** `trade` na lista de trades do partner, acrescentar os certificados da tabela abaixo.  
`doc_type` = `certification`.  
`aliases` por certificado: `[nome em minúsculas, "certificate", trade em minúsculas]`.  
Deduplicar por nome do certificado (mesmo cert em dois trades → um só item).

**Mapa `CERT_REQUIREMENTS_BY_TRADE` (chave = nome exato do trade no sistema):**

| Trade | Certificados exigidos |
|-------|------------------------|
| Plumber | Water Regulations, WRAS |
| Electrician | NICEIC, ECS Card, 18th Edition Wiring Regulations |
| Gas Safety Certificate | Gas Safe Certificate, ACS Gas Certificate |
| PAT Testing | PAT Testing Certificate |
| PAT EICR | PAT Testing Certificate, EICR Qualification |
| EICR | EICR Qualification |
| Fire Alarm Certificate | Fire Alarm Certification |
| Emergency Lighting Certificate | Emergency Lighting Certification |
| Fire Extinguisher Service | BAFE / extinguisher servicing certificate |

**Optional (not in compliance score):** Builder & Carpenter — CSCS Card (upload suggested in OS Documents tab only).

---

## 4. Validação de documento (satisfei “requirement”)

- Unir documentos que façam match por: `doc_type` igual **OU** nome do documento contém algum `alias`.
- “Válido” para o requisito: existe pelo menos um match com **sem** `expires_at` **OU** `expires_at >= agora`.
- Certificações (`certification`): múltiplos uploads possíveis; basta um válido para satisfazer aquele requisito.

---

## 5. Score de documentos (0–100)

`documentScore = round((count requisitos satisfeitos) / (total requisitos)) * 100)`  
Se `total requisitos === 0` → 100.

---

## 6. Score de perfil (0–100)

`profileScore = round((soma pesos dos itens done) / 100 * 100)` — equivalente a média ponderada dos itens da secção 2.

---

## 7. Documentos expirados (penalização)

- `expiredCount` = número de documentos com `expires_at` < agora.
- `expiredPenalty = min(38, expiredCount * 14)`
- Termo: `0.15 * max(0, 100 - expiredPenalty)`

---

## 8. Score final (0–100)

```
blended = 0.52 * documentScore + 0.33 * profileScore + 0.15 * max(0, 100 - expiredPenalty)
final = clamp(round(blended), 0, 100)
```

---

## 9. Tipos `doc_type` sem data de expiração obrigatória no upload (OS)

`utr`, `service_agreement`, `self_bill_agreement`

*(Service / Self-bill não entram na checklist obrigatória do score no OS; são opcionais comercialmente.)*

---

## 10. Prompt para Cursor (outro repositório)

Copiar o bloco abaixo para uma task no app:

```
Implement partner onboarding and compliance checklist to match Master OS rules (see docs/PARTNER_COMPLIANCE_APP_SPEC.md in master-os repo, or paste sections 1–8).

Requirements:
- Collect profile fields: partner_legal_type, company_name, contact_name, email, phone, partner_address, uk_coverage_regions (or legacy location), vat_number, crn OR utr based on legal type.
- Build required document list = CORE_DOCS + (if self_employed: UTR doc) + flatten CERT_REQUIREMENTS_BY_TRADE for each selected trade (dedupe certificates by name).
- Document upload: store doc_type, name, optional expires_at; for certification require certificate number + expiry where applicable.
- Compute documentScore, profileScore, expiredCount, and final blended score using the same weights and formulas as in the spec.
- UK coverage: multi-region list (default London), no Whole UK; include Outside London + standard regions as in OS.
- Match documents to requirements by doc_type OR substring match on document name (aliases).
```

---

## Manutenção

Ao alterar trades ou certificados no Master OS, atualizar **a tabela da secção 3.3** e o mapa no código (`CERT_REQUIREMENTS_BY_TRADE`).
