-- =============================================================================
-- Migration 136: Partner Contract Signatures
-- =============================================================================
--
-- Two tables to support legally-binding e-signatures for partner contracts
-- (Terms of Use + Self-bill Agreement). Partners must sign both before
-- accessing the app.
--
-- contract_versions          — versioned contract text (admin can publish new
--                              versions; only one active per type at a time)
-- partner_contract_signatures — one row per partner × version signed, with
--                              full audit trail for UK e-signature validity
--
-- Seed data at the bottom inserts the initial v1 of both contracts.
-- =============================================================================

-- =============================================
-- 1. TABLE: contract_versions
-- =============================================
CREATE TABLE IF NOT EXISTS public.contract_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_type   text        NOT NULL CHECK (contract_type IN ('terms_of_use', 'self_bill_agreement')),
  version         text        NOT NULL,
  title           text        NOT NULL,
  body_html       text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Only one active version per contract type at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_versions_active
  ON public.contract_versions (contract_type) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_contract_versions_type
  ON public.contract_versions (contract_type, is_active);

ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read contract_versions" ON public.contract_versions;
CREATE POLICY "Authenticated read contract_versions"
  ON public.contract_versions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert contract_versions" ON public.contract_versions;
CREATE POLICY "Authenticated insert contract_versions"
  ON public.contract_versions FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update contract_versions" ON public.contract_versions;
CREATE POLICY "Authenticated update contract_versions"
  ON public.contract_versions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.contract_versions TO authenticated;

COMMENT ON TABLE public.contract_versions IS
  'Versioned contract text for partner e-signatures. Only one active version per contract_type at a time.';

-- =============================================
-- 2. TABLE: partner_contract_signatures
-- =============================================
CREATE TABLE IF NOT EXISTS public.partner_contract_signatures (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid        NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  contract_version_id   uuid        NOT NULL REFERENCES public.contract_versions(id),
  contract_type         text        NOT NULL,
  signer_full_name      text        NOT NULL,
  signer_email          text        NOT NULL,
  signature_image_url   text        NOT NULL,
  signature_pdf_url     text,
  signer_ip             text,
  device_info           text,
  signed_at             timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(partner_id, contract_version_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_signatures_partner
  ON public.partner_contract_signatures (partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_signatures_type
  ON public.partner_contract_signatures (partner_id, contract_type);

ALTER TABLE public.partner_contract_signatures ENABLE ROW LEVEL SECURITY;

-- Signatures are immutable: SELECT + INSERT only (no UPDATE/DELETE)
DROP POLICY IF EXISTS "Authenticated read partner_signatures" ON public.partner_contract_signatures;
CREATE POLICY "Authenticated read partner_signatures"
  ON public.partner_contract_signatures FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert partner_signatures" ON public.partner_contract_signatures;
CREATE POLICY "Authenticated insert partner_signatures"
  ON public.partner_contract_signatures FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.partner_contract_signatures TO authenticated;
REVOKE UPDATE, DELETE ON public.partner_contract_signatures FROM authenticated;

COMMENT ON TABLE public.partner_contract_signatures IS
  'Legally-binding e-signature records. Immutable (no UPDATE/DELETE for authenticated). Each row captures signer identity, signature image, IP, device, and a snapshot reference to the exact contract version signed.';

-- =============================================
-- 3. SEED: Initial contract versions (v1)
-- =============================================

INSERT INTO public.contract_versions (contract_type, version, title, body_html) VALUES
(
  'terms_of_use',
  '2026-04-12',
  'Terms of Use — Master Services Platform',
  '<h2>Terms of Use — Master Services Platform</h2>
<p><strong>Effective Date:</strong> 12 April 2026</p>

<h3>1. Acceptance</h3>
<p>By signing this agreement, you ("Partner") accept these Terms of Use governing your access to and use of the Master Services mobile application and platform ("Platform").</p>

<h3>2. Partner Obligations</h3>
<p>You agree to:</p>
<ul>
  <li>Provide accurate and up-to-date information including trade qualifications, insurance, and identity documents.</li>
  <li>Maintain valid insurance coverage for the duration of your engagement.</li>
  <li>Perform assigned jobs to a professional standard and in accordance with UK regulations.</li>
  <li>Comply with all health and safety requirements applicable to your trade.</li>
  <li>Use the Platform solely for legitimate business purposes.</li>
</ul>

<h3>3. Job Acceptance &amp; Cancellation</h3>
<p>Once you accept a job via the Platform, you are committed to completing it. Cancellations within 2 hours of the scheduled start time may incur a cancellation fee as outlined in your service agreement.</p>

<h3>4. Payment</h3>
<p>Payment for completed jobs will be processed in accordance with the agreed pay schedule. You acknowledge that Master Services may operate a self-billing arrangement for VAT-registered partners.</p>

<h3>5. Confidentiality</h3>
<p>You shall keep confidential all client information, job details, pricing, and business information accessed through the Platform.</p>

<h3>6. Data Protection</h3>
<p>Your personal data will be processed in accordance with UK GDPR. Location data collected during active jobs is used solely for operational purposes (dispatch, safety, and job tracking).</p>

<h3>7. Intellectual Property</h3>
<p>All content, branding, and software on the Platform remain the property of Master Services Trades Ltd.</p>

<h3>8. Termination</h3>
<p>Either party may terminate this agreement with 14 days written notice. Master Services reserves the right to suspend access immediately for breach of these terms.</p>

<h3>9. Limitation of Liability</h3>
<p>Master Services acts as a platform connecting partners with clients. We are not liable for disputes between partners and clients beyond our role as intermediary.</p>

<h3>10. Governing Law</h3>
<p>This agreement is governed by the laws of England and Wales.</p>'
),
(
  'self_bill_agreement',
  '2026-04-12',
  'Self-Billing Agreement',
  '<h2>Self-Billing Agreement</h2>
<p><strong>Effective Date:</strong> 12 April 2026</p>

<p>This Self-Billing Agreement is made between <strong>Master Services Trades Ltd</strong> ("the Customer") and the undersigned partner ("the Supplier").</p>

<h3>1. Agreement to Self-Bill</h3>
<p>The Supplier agrees that the Customer will raise self-bill invoices on behalf of the Supplier for all services provided through the Master Services Platform. The Supplier will not issue separate invoices for these services.</p>

<h3>2. VAT Registration</h3>
<p>The Supplier confirms their current VAT registration status as declared in their partner profile on the Platform. The Supplier agrees to notify Master Services immediately of any change in VAT registration status.</p>

<h3>3. Self-Bill Invoice Details</h3>
<p>Each self-bill invoice will include:</p>
<ul>
  <li>The Supplier''s name and address</li>
  <li>The Supplier''s VAT registration number (if applicable)</li>
  <li>A unique invoice number</li>
  <li>Date of supply and invoice date</li>
  <li>Description of services</li>
  <li>Total amount payable including VAT breakdown (if applicable)</li>
</ul>

<h3>4. HMRC Compliance</h3>
<p>This agreement complies with HMRC requirements for self-billing arrangements as set out in VAT Notice 700/62. Both parties agree to:</p>
<ul>
  <li>Maintain this agreement for the duration of the trading relationship.</li>
  <li>Retain copies of all self-bill invoices for a minimum of 6 years.</li>
  <li>Notify the other party if they change VAT registration status or cease to be VAT registered.</li>
</ul>

<h3>5. Acceptance of Self-Bill Invoices</h3>
<p>The Supplier agrees to accept the self-bill invoices issued by the Customer as the definitive record of supply for VAT purposes. The Supplier will not raise alternative VAT invoices for the same supplies.</p>

<h3>6. Duration</h3>
<p>This agreement remains in force until terminated by either party with 30 days written notice, or until the Supplier ceases to supply services through the Platform.</p>

<h3>7. Governing Law</h3>
<p>This agreement is governed by the laws of England and Wales and complies with UK VAT legislation.</p>'
);
