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
