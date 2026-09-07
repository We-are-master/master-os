-- 284 — os domínios de e-mail que provam uma organização.
--
-- O Harvey só age quando sabe de qual organização veio o pedido (dono,
-- 03/09/2026). A prova é o DOMÍNIO do remetente, e não o nome da empresa
-- escrito no texto: os pedidos reais da Kvadrat em agosto foram "Cupboard fix"
-- e "Door handle + Painter", e nenhum deles diz Kvadrat.
--
-- Até aqui o único domínio disponível era o de `accounts.email`, que é o
-- contato principal e não a lista de quem pode escrever pela empresa. Uma
-- coluna própria porque:
--
--   * uma organização escreve de vários domínios (o Checkatrade manda de
--     clicks., email., services. e updates.);
--   * o escritório precisa poder corrigir sem deploy;
--   * `email` continua sendo o contato, e o significado dele não muda.

alter table public.accounts
  add column if not exists domains text[] not null default '{}'::text[];

comment on column public.accounts.domains is
  'Domínios de e-mail que provam esta organização (minúsculas, sem @). Subdomínio casa sozinho: cadastrar checkatrade.com cobre email.checkatrade.com. Um domínio pertence a UMA organização só.';

-- ─── Seed a partir do contato principal ────────────────────────────────────
--
-- Um domínio pertence a UMA organização, e a regra vale desde o seed.
--
-- `checkatrade.com` estava em duas contas: Checkatrade (217 jobs) e Express
-- (12). Dois donos para o mesmo domínio é uma pergunta sem resposta certa, e o
-- dono decidiu em 03/09/2026: tudo em Checkatrade, Express deixa de disputar.
-- Aqui isso não é um caso especial escrito à mão — quem tem mais job fica com
-- o domínio, e o desempate é o nome. Cadastro novo que repita um domínio já
-- usado simplesmente não recebe, em vez de criar um segundo dono calado.
--
-- Domínio pessoal e o nosso ficam de fora: quem tem gmail no cadastro não
-- ganha regra de organização, e e-mail encaminhado por nós não é do cliente.
with candidatas as (
  select
    a.id,
    lower(split_part(a.email, '@', 2)) as dominio,
    row_number() over (
      partition by lower(split_part(a.email, '@', 2))
      order by (
        select count(*) from public.jobs j
          join public.clients c on c.id = j.client_id
         where c.source_account_id = a.id and j.deleted_at is null
      ) desc, a.company_name asc
    ) as posicao
  from public.accounts a
  where a.deleted_at is null
    and coalesce(a.domains, '{}') = '{}'
    and a.email like '%@%'
    and lower(split_part(a.email, '@', 2)) not in (
      'gmail.com','googlemail.com','hotmail.com','hotmail.co.uk','outlook.com',
      'outlook.co.uk','live.com','live.co.uk','yahoo.com','yahoo.co.uk','ymail.com',
      'icloud.com','me.com','mac.com','aol.com','aol.co.uk','protonmail.com',
      'proton.me','gmx.com','msn.com','btinternet.com','sky.com','teste.com',
      'getfixfy.com'
    )
)
update public.accounts a
   set domains = array[c.dominio]
  from candidatas c
 where a.id = c.id
   and c.posicao = 1;

-- A busca por domínio é a pergunta que todo ticket vai fazer.
create index if not exists accounts_domains_idx on public.accounts using gin (domains);
