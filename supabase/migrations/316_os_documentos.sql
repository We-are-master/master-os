-- 316: tabela de preços e regras no OS (dono, 07/10/2026).
--
-- Um documento por tipo, versionado: cada salvamento é uma linha nova e a versão
-- em vigor é a de maior id. O site lê a tabela de preços ao vivo
-- (/api/public/tabela-de-precos) e os agentes leem as regras. Desfazer é salvar
-- de novo uma versão antiga. Só o service role lê e escreve (RLS sem política).
create table if not exists public.os_documentos (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('tabela_de_precos', 'regras')),
  documento   jsonb not null,
  nota        text,
  criado_em   timestamptz not null default now(),
  criado_por  text
);
create index if not exists os_documentos_tipo_id on public.os_documentos (tipo, id desc);
alter table public.os_documentos enable row level security;

-- Versão 1 da tabela: a do site em 07/10/2026, valores idênticos; 6 a 10 quartos desligados.
insert into public.os_documentos (tipo, documento, nota, criado_por)
select 'tabela_de_precos', $doc${
  "formato": 1,
  "moeda": "GBP",
  "sizes": [
    {
      "id": "studio",
      "label": "Studio",
      "short": "Studio",
      "tiny": "Studio",
      "ativo": true
    },
    {
      "id": "1",
      "label": "1 bedroom",
      "short": "1 bed",
      "tiny": "1",
      "ativo": true
    },
    {
      "id": "2",
      "label": "2 bedrooms",
      "short": "2 bed",
      "tiny": "2",
      "ativo": true
    },
    {
      "id": "3",
      "label": "3 bedrooms",
      "short": "3 bed",
      "tiny": "3",
      "ativo": true
    },
    {
      "id": "4",
      "label": "4 bedrooms",
      "short": "4 bed",
      "tiny": "4",
      "ativo": true
    },
    {
      "id": "5",
      "label": "5+ bedrooms",
      "short": "5+ bed",
      "tiny": "5+",
      "ativo": true
    },
    {
      "id": "6",
      "label": "6 bedrooms",
      "short": "6 bed",
      "tiny": "6",
      "ativo": false
    },
    {
      "id": "7",
      "label": "7 bedrooms",
      "short": "7 bed",
      "tiny": "7",
      "ativo": false
    },
    {
      "id": "8",
      "label": "8 bedrooms",
      "short": "8 bed",
      "tiny": "8",
      "ativo": false
    },
    {
      "id": "9",
      "label": "9 bedrooms",
      "short": "9 bed",
      "tiny": "9",
      "ativo": false
    },
    {
      "id": "10",
      "label": "10+ bedrooms",
      "short": "10 bed",
      "tiny": "10",
      "ativo": false
    }
  ],
  "bathroomOptions": [
    1,
    2,
    3,
    4
  ],
  "defaultCleanKind": "eot",
  "clean": {
    "id": "clean",
    "verb": "Clean",
    "includedBathrooms": 1,
    "ovenIncluded": true,
    "productsIncluded": true,
    "teamOfTwoFromSize": "2",
    "extraBathroomSteps": [
      42,
      52,
      66
    ],
    "extras": [
      {
        "id": "carpet",
        "label": "Carpet steam clean",
        "detail": "Per room, hallway or staircase",
        "price": 38,
        "unit": "room",
        "max": 8
      },
      {
        "id": "fridge",
        "label": "Fridge freezer",
        "detail": "Defrosted, cleaned inside and out",
        "price": 43
      },
      {
        "id": "windows",
        "label": "Windows outside",
        "detail": "Ground floor and safely reachable",
        "price": 35
      },
      {
        "id": "balcony",
        "label": "Balcony or patio",
        "detail": "Swept, washed and wiped down",
        "price": 57
      }
    ],
    "kinds": [
      {
        "id": "eot",
        "name": "End of tenancy clean",
        "short": "Moving out",
        "tiny": "Moving out",
        "hint": "Oven included",
        "detail": "For an empty property, cleaned for check-out day",
        "prices": {
          "1": 223,
          "2": 266,
          "3": 318,
          "4": 384,
          "5": 451,
          "6": 518,
          "7": 585,
          "8": 652,
          "9": 719,
          "10": 786,
          "studio": 200
        },
        "osTitle": "End of Tenancy Clean"
      },
      {
        "id": "deep",
        "name": "Deep clean",
        "short": "Deep clean",
        "tiny": "Deep",
        "hint": "Oven included",
        "detail": "For the home you live in: moving in, a spring clean, or just overdue",
        "prices": {
          "1": 194,
          "2": 237,
          "3": 289,
          "4": 356,
          "5": 422,
          "6": 488,
          "7": 554,
          "8": 620,
          "9": 686,
          "10": 752,
          "studio": 174
        },
        "osTitle": "Deep Clean"
      },
      {
        "id": "after",
        "name": "After builders clean",
        "short": "After builders",
        "tiny": "After works",
        "hint": "Dust and residue",
        "detail": "For a property that has just had building, refit or renovation work",
        "prices": {
          "1": 227,
          "2": 269,
          "3": 322,
          "4": 388,
          "5": 455,
          "6": 522,
          "7": 589,
          "8": 656,
          "9": 723,
          "10": 790,
          "studio": 204
        },
        "osTitle": "After Builders Clean"
      }
    ]
  },
  "paint": {
    "id": "paint",
    "verb": "Paint",
    "name": "Fresh coat",
    "osTitle": "Painter",
    "options": [
      {
        "id": "touchup",
        "label": "Touch-ups",
        "detail": "Holes filled, marks and scuffs touched up across the property. Up to 3.5 hours.",
        "price": 215
      },
      {
        "id": "rooms",
        "label": "Full repaint",
        "detail": "Walls in two coats, priced per room.",
        "price": 450,
        "unit": "room",
        "max": 8
      }
    ],
    "materials": {
      "id": "materials",
      "label": "Paint and materials pack",
      "detail": "Paint in white or magnolia, filler, sandpaper, tape and dust sheets",
      "price": 130
    }
  },
  "fix": {
    "id": "fix",
    "verb": "Fix",
    "name": "Repairs",
    "osTitle": "General Maintenance",
    "packages": [
      {
        "id": "half",
        "label": "Half day",
        "detail": "Up to 3.5 hours",
        "minutes": 210,
        "price": 180
      },
      {
        "id": "day",
        "label": "Full day",
        "detail": "Up to 7 hours",
        "minutes": 420,
        "price": 329
      }
    ],
    "toolsIncluded": true,
    "tasks": [
      {
        "id": "holes",
        "label": "Fill holes and nail marks",
        "minutes": 30
      },
      {
        "id": "silicone",
        "label": "Reseal a bath or shower",
        "minutes": 60
      },
      {
        "id": "handles",
        "label": "Handles, hinges and door stops",
        "minutes": 20
      },
      {
        "id": "rails",
        "label": "Curtain rails and blinds",
        "minutes": 30
      },
      {
        "id": "brackets",
        "label": "Take down a TV bracket or shelves",
        "minutes": 45
      },
      {
        "id": "flatpack",
        "label": "Take apart flat-pack furniture",
        "minutes": 45
      },
      {
        "id": "doors",
        "label": "Sticking doors and cupboards",
        "minutes": 30
      },
      {
        "id": "tap",
        "label": "Dripping tap",
        "minutes": 45
      },
      {
        "id": "bulbs",
        "label": "Replace bulbs",
        "minutes": 15
      },
      {
        "id": "other",
        "label": "Something else",
        "minutes": 30
      }
    ]
  },
  "cert": {
    "id": "cert",
    "verb": "Certify",
    "name": "Landlord certificates",
    "items": [
      {
        "id": "gas",
        "label": "Gas safety certificate (CP12)",
        "short": "Gas safety (CP12)",
        "detail": "Boiler and every gas appliance checked by a Gas Safe registered engineer",
        "valid": "Renew every 12 months",
        "price": 79,
        "osTitle": "Gas Safety Certificate"
      },
      {
        "id": "eicr",
        "label": "Electrical safety report (EICR)",
        "short": "Electrical safety (EICR)",
        "detail": "Every circuit tested and signed off by a NICEIC or NAPIT registered electrician",
        "valid": "Renew every 5 years",
        "prices": {
          "1": 129,
          "2": 165,
          "3": 195,
          "4": 225,
          "5": null,
          "6": null,
          "7": null,
          "8": null,
          "9": null,
          "10": null,
          "studio": 129
        },
        "osTitle": "Electrical Safety Report"
      },
      {
        "id": "epc",
        "label": "Energy performance certificate (EPC)",
        "short": "Energy performance (EPC)",
        "detail": "Accredited assessor visits, rates the property and lodges the certificate on the national register",
        "valid": "Valid for 10 years",
        "prices": {
          "1": 95,
          "2": 95,
          "3": 99,
          "4": 109,
          "5": 130,
          "6": null,
          "7": null,
          "8": null,
          "9": null,
          "10": null,
          "studio": 95
        },
        "osTitle": "Energy Performance Certificate"
      }
    ]
  }
}$doc$::jsonb, 'Imported from the website price list (pricing.js)', 'system'
where not exists (select 1 from public.os_documentos where tipo = 'tabela_de_precos');

-- Versão 1 das regras: o que já valia (termos do site 06/10/2026, contrato do parceiro 22/09/2026).
insert into public.os_documentos (tipo, documento, nota, criado_por)
select 'regras', $doc${
  "formato": 1,
  "publicos": {
    "cliente": [
      { "id": "how_it_works", "titulo": "How Fixfy works", "texto": "Fixfy books the customer with a vetted independent professional in London. The professional carries out the job and the contract for the work is with them. Fixfy finds and books the professional, takes the payment as their agent and stays the customer's contact from start to finish." },
      { "id": "payment", "titulo": "Payment", "texto": "Prices are fixed and include VAT where it applies: nothing is added on top. To confirm a booking the customer pays a 50% deposit by secure card link; the other 50% is paid after the job. The booking is only confirmed once the deposit is paid. We never take card details in a chat or by phone." },
      { "id": "cancellation", "titulo": "Changes and cancellations", "texto": "Free changes or cancellation up to 48 hours before the booked day. Inside 48 hours, 50% of the price is charged and goes to the professional, who kept the slot free." },
      { "id": "no_access", "titulo": "No access on the day", "texto": "If the professional cannot get in within 30 minutes of the start of the arrival window, it counts as a late cancellation." },
      { "id": "guarantee", "titulo": "Guarantee", "texto": "Every job has a 7 day guarantee from the professional who did it: if something is not right, it is put right. Cleaning: a free re-clean of the missed areas reported within 7 days. Longer guarantees: painting and decorating 3 months, tiling 3 months, wall treatments 6 months, woodwork and structural work 6 months." },
      { "id": "coverage", "titulo": "Where and when", "texto": "London only. No same day bookings and no Sundays: the earliest day is the next free day in the diary." },
      { "id": "materials", "titulo": "Materials", "texto": "Handyman and repair work includes tools and no call out fee. Materials and parts are not included: the customer supplies them, or the professional quotes them at cost and only buys them with the customer's approval. Painting has an optional paint and materials pack." },
      { "id": "complaints", "titulo": "Complaints", "texto": "We reply to every complaint within 2 working days and aim to resolve it within 14 days. Complaints always go to a person from the team, never handled by an agent alone." },
      { "id": "big_jobs", "titulo": "Jobs outside the price list", "texto": "Anything not in the price list (5+ bedroom cleans unless the size is listed, leaks, renovations, bespoke work) gets a quote from the team, usually from photos." }
    ],
    "parceiro": [
      { "id": "model", "titulo": "Working with Fixfy", "texto": "Partners are independent professionals. The customer's contract for the work is with the partner; Fixfy books the job and collects the payment as the partner's agent, keeping its commission." },
      { "id": "documents", "titulo": "Documents to start", "texto": "To receive jobs a partner needs three documents approved: photo ID, public liability insurance and right to work. A British or Irish passport counts as both ID and right to work. Partners also sign the Contractor Service Agreement, the Terms of Use and the Self-Billing agreement in the partner app." },
      { "id": "jobs", "titulo": "Getting jobs", "texto": "Job offers arrive in the partner portal (partners.getfixfy.com). Accepting, the day, the arrival window and the address all live there." },
      { "id": "cancellation", "titulo": "Cancelling a job", "texto": "Cancelling an accepted job less than 24 hours before the start costs £50, deducted from the next self-bill." },
      { "id": "reports", "titulo": "Reports and photos", "texto": "Every job ends with the report in the partner portal: before and after photos of each room or area worked on. The job is only paid once the report is complete." },
      { "id": "pay", "titulo": "How partners are paid", "texto": "Fixfy issues one self-bill per partner per fortnight covering the completed jobs of that fortnight, and pays it on payday. Deductions (cancellation fees, adjustments) are listed on the self-bill." },
      { "id": "conduct", "titulo": "On the job", "texto": "Arrive inside the arrival window, keep the customer informed through Fixfy, never take payment directly from the customer and never share their details." }
    ],
    "conta": [
      { "id": "booking", "titulo": "Booking for an account", "texto": "Accounts (letting agents, landlords, property managers) book through their contact at Fixfy or by email. Each booking becomes a job in the OS under the account." },
      { "id": "prices", "titulo": "Prices", "texto": "Accounts pay the price list unless a different rate is agreed on the account. Agreed rates live on the account page in the OS." },
      { "id": "invoices", "titulo": "Invoices", "texto": "Invoices follow the payment terms set on the account. Completed jobs are confirmed to the account when the final check is done." }
    ]
  }
}
$doc$::jsonb, 'First version: website terms and partner agreement', 'system'
where not exists (select 1 from public.os_documentos where tipo = 'regras');
