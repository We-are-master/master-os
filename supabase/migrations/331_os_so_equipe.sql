-- 331 · O OS é só da equipe (15/10/2026)
--
-- O que estava aberto:
--   1. O portal do parceiro cria o login com user_metadata.role = 'external_partner'
--      (sem user_type). handle_new_user só pulava user_type = 'external_partner',
--      então todo parceiro ganhava uma linha em profiles com role 'operator'.
--   2. is_internal_staff() olhava só se existe linha em profiles, sem is_active.
--      Resultado: 47 logins de parceiro liam jobs, faturas, self-bills etc.
--      Desativar o perfil (is_active = false) não mudava nada.
--
-- O que muda:
--   1. is_internal_staff() exige perfil ATIVO e que o login não seja de um parceiro.
--      Quem está desativado ou é parceiro deixa de passar em toda policy que usa a função.
--   2. handle_new_user também pula quem chega com role = 'external_partner' no
--      metadata (o que o portal manda hoje) e quem já é parceiro pelo e-mail.

CREATE OR REPLACE FUNCTION public.is_internal_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND coalesce(p.is_active, true) = true
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.partners pa
    JOIN public.profiles p2 ON p2.id = pa.auth_user_id
    WHERE pa.auth_user_id = auth.uid()
      -- Equipe que tem um parceiro de teste ligado ao próprio login continua equipe.
      AND lower(coalesce(p2.email, '')) !~ '@(getfixfy\.com|wearemaster\.com)$'
  );
$$;

COMMENT ON FUNCTION public.is_internal_staff() IS
  'Equipe da Fixfy: perfil ativo em profiles e login que não é de parceiro (exceto e-mails da casa). Base das policies do OS.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_type text;
  v_role text;
BEGIN
  v_user_type := coalesce(NEW.raw_user_meta_data->>'user_type', '');
  v_role := coalesce(NEW.raw_user_meta_data->>'role', '');

  -- Parceiro e cliente do portal têm tabela própria: nunca viram equipe.
  IF v_user_type IN ('external_partner', 'account_portal') OR v_role = 'external_partner' THEN
    RETURN NEW;
  END IF;

  -- Login criado para um e-mail que já é de parceiro também não é equipe.
  IF EXISTS (
    SELECT 1 FROM public.partners pa
    WHERE lower(pa.email) = lower(coalesce(NEW.email, ''))
  ) AND lower(coalesce(NEW.email, '')) !~ '@(getfixfy\.com|wearemaster\.com)$' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'operator'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Regras de leitura e escrita abertas para qualquer login (achado 15/10/2026)
-- =============================================================================
-- Policies permissivas somam com OR: uma regra "true" anulava as restritas.
-- Conferido antes: o portal do parceiro só lê/edita a própria linha de partners
-- (o resto passa pelo service role) e nenhum portal lê clients ou profiles com
-- a sessão do usuário.

-- clients: a regra "manage" liberava tudo; ficam as *_staff e a de leitura por conta do portal.
DROP POLICY IF EXISTS "Authenticated users can manage clients" ON public.clients;

-- partners: só a equipe vê, cria e edita todos; o parceiro continua com a própria linha.
DROP POLICY IF EXISTS "Authenticated users can view partners" ON public.partners;
DROP POLICY IF EXISTS "Authenticated users can update partners" ON public.partners;
DROP POLICY IF EXISTS "Authenticated users can insert partners" ON public.partners;

DROP POLICY IF EXISTS partners_select_staff ON public.partners;
CREATE POLICY partners_select_staff ON public.partners
  FOR SELECT TO authenticated USING (public.is_internal_staff());

DROP POLICY IF EXISTS partners_update_staff ON public.partners;
CREATE POLICY partners_update_staff ON public.partners
  FOR UPDATE TO authenticated USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

DROP POLICY IF EXISTS partners_insert_staff ON public.partners;
CREATE POLICY partners_insert_staff ON public.partners
  FOR INSERT TO authenticated WITH CHECK (public.is_internal_staff());

-- O parceiro edita o próprio cadastro (área, trades, rate card, disponibilidade),
-- mas não o que a Fixfy decide: status, banco, plano, contadores, notas internas.
CREATE OR REPLACE FUNCTION public.partners_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service role (auth.uid() nulo) e equipe passam direto.
  IF auth.uid() IS NULL OR public.is_internal_staff() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.partner_status_reasons IS DISTINCT FROM OLD.partner_status_reasons
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.permission IS DISTINCT FROM OLD.permission
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.compliance_score IS DISTINCT FROM OLD.compliance_score
     OR NEW.jobs_completed IS DISTINCT FROM OLD.jobs_completed
     OR NEW.total_earnings IS DISTINCT FROM OLD.total_earnings
     OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.bank_sort_code IS DISTINCT FROM OLD.bank_sort_code
     OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
     OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
     OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
     OR NEW.payouts_enabled IS DISTINCT FROM OLD.payouts_enabled
     OR NEW.wise_recipient_id IS DISTINCT FROM OLD.wise_recipient_id
     OR NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.default_partner_cancel_fee_gbp IS DISTINCT FROM OLD.default_partner_cancel_fee_gbp
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.billing_ready IS DISTINCT FROM OLD.billing_ready
     OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.zendesk_organization_id IS DISTINCT FROM OLD.zendesk_organization_id
     OR NEW.zendesk_user_id IS DISTINCT FROM OLD.zendesk_user_id
     OR NEW.usage_period_start IS DISTINCT FROM OLD.usage_period_start
     OR NEW.leads_used IS DISTINCT FROM OLD.leads_used
     OR NEW.jobs_used IS DISTINCT FROM OLD.jobs_used
     OR NEW.quotes_used IS DISTINCT FROM OLD.quotes_used
  THEN
    RAISE EXCEPTION 'Only Fixfy can change this partner field' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_guard_self_update ON public.partners;
CREATE TRIGGER partners_guard_self_update
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.partners_guard_self_update();

-- profiles: cada um vê o próprio; a equipe vê todos.
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self_or_staff ON public.profiles;
CREATE POLICY profiles_select_self_or_staff ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_internal_staff());

-- "Users can update own profile" deixava qualquer um se reativar ou virar admin.
-- Papel, ativo e permissões só mudam por admin ativo (ou service role).
CREATE OR REPLACE FUNCTION public.profiles_guard_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles a
       WHERE a.id = auth.uid() AND a.role = 'admin' AND coalesce(a.is_active, true)
     )
  THEN
    RAISE EXCEPTION 'Only an admin can change role, access or permissions' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privileges();

-- =============================================================================
-- Tabelas que qualquer login lia inteiras (varredura de 15/10/2026, login de
-- parceiro sem perfil). Policy RESTRICTIVE soma com AND: por mais que exista uma
-- regra "true" antiga, quem não é equipe só passa pela exceção da própria linha.
-- =============================================================================

-- Só equipe, sem exceção.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_service_prices', 'admin_config', 'commission_pool_shares', 'commission_tiers',
    'email_suppressions', 'invoice_payment_installments', 'job_extra_entries',
    'job_recurrence_series', 'job_visits', 'labour_prices', 'marketing_touches',
    'outreach_campaign_recipients', 'outreach_campaigns', 'outreach_templates',
    'payroll_internal_costs', 'self_bill_payment_installments', 'service_material_kits',
    'service_pricebook', 'short_links', 'supplier_prices', 'workforce_contract_signatures',
    'workforce_onboarding_requests'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS staff_only ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY staff_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff())', t);
  END LOOP;
END $$;

-- O parceiro mexe só no que é dele (assinaturas, rate card, pedidos de documento).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner_contract_signatures', 'partner_service_prices', 'partner_document_requests'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS staff_or_own_partner ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY staff_or_own_partner ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (public.is_internal_staff() OR partner_id IN (SELECT id FROM public.partners WHERE auth_user_id = auth.uid()))
         WITH CHECK (public.is_internal_staff() OR partner_id IN (SELECT id FROM public.partners WHERE auth_user_id = auth.uid()))', t);
  END LOOP;
END $$;

-- users (cadastro do app do parceiro): cada um a própria linha.
DROP POLICY IF EXISTS staff_or_self ON public.users;
CREATE POLICY staff_or_self ON public.users AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_internal_staff() OR id = auth.uid())
  WITH CHECK (public.is_internal_staff() OR id = auth.uid());

-- Catálogos que o portal lê (contratos a assinar, categorias): leitura livre para
-- quem está logado, escrita só da equipe.
DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_versions', 'service_categories'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_write_' || lower(c), t);
      IF c = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.is_internal_staff())', 'staff_write_insert', t);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated USING (public.is_internal_staff())', 'staff_write_' || lower(c), t, c);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- clients: a regra de INSERT não mostra o WITH CHECK; recria fechada (equipe ou a própria conta do portal).
DROP POLICY IF EXISTS clients_insert_staff ON public.clients;
CREATE POLICY clients_insert_staff ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_internal_staff() OR source_account_id = public.current_portal_account_id());
