/**
 * A agenda da temporada: 52 e-mails, duas vezes por semana, seis meses.
 *
 * ── Por que a peça sai da DATA e não do contador da pessoa ──────────────────
 *
 * O motor de sequências sabe girar: manda, soma um no ciclo, volta. Se a peça
 * viesse do ciclo, quem entrasse em janeiro receberia em janeiro o e-mail de
 * "prepare a casa para o frio" escrito para outubro, e o de spring clean em
 * julho. Conteúdo de estação exige calendário, não contador.
 *
 * Então a peça é função da data: a temporada começa em `INICIO_DA_TEMPORADA` e
 * anda uma casa a cada 3,5 dias, que é o que dá duas por semana. Todo mundo que
 * está dentro naquele intervalo recebe a MESMA peça, como um jornal. Quem entra
 * no meio começa do número da semana, e não perde nada: cada peça se explica
 * sozinha.
 *
 * ── A estratégia, em uma linha por tipo ────────────────────────────────────
 *
 *   Home notes    conselho de casa que serve mesmo sem comprar nada. É o que
 *                 compra o direito de mandar as outras.
 *   Offer         cupom de verdade, com código que existe na Stripe e prazo.
 *   Landlords     quem tem imóvel alugado, que é o cliente que volta todo ano.
 *   Moving out    saída de imóvel, o serviço âncora do B2C.
 *
 * Dois terços das peças são úteis ou de estação e um terço carrega oferta. A
 * proporção é deliberada: lista que só recebe promoção vira lista morta em
 * dois meses, e o custo disso não é o clique perdido, é a marcação de spam.
 *
 * Os códigos aqui vêm de `@/lib/marketing/cupons`, que é o mesmo arquivo que o
 * script usa para criar os cupons na Stripe. Nunca escreva um código solto.
 */

import type { Bloco } from "@/lib/emails/campanha-layout";
import { INICIO_DA_TEMPORADA } from "@/lib/marketing/cupons";

export type Etiqueta = "Home notes" | "Offer" | "Landlords" | "Moving out";

export type PecaDaAgenda = {
  /** 1 a 52. É o número da edição, e aparece no painel. */
  n: number;
  key: string;
  etiqueta: Etiqueta;
  assunto: string;
  preheader: string;
  titulo: string;
  blocos: Bloco[];
  cta: string;
  /** Código em `cupons.ts`. A caixa da oferta só aparece quando existe. */
  cupom?: string;
};

const t = (html: string): Bloco => ({ tipo: "texto", html });
const l = (titulo: string, itens: string[]): Bloco => ({ tipo: "lista", titulo, itens });
const q = (texto: string, autor: string): Bloco => ({ tipo: "citacao", texto, autor });

export const AGENDA: PecaDaAgenda[] = [
  /* ══════════════════ OUTUBRO ══════════════════ */
  {
    n: 1,
    key: "welcome_notes",
    etiqueta: "Home notes",
    assunto: "Something useful, twice a week, from your London trades team",
    preheader: "What these notes are, and how to stop them in one click.",
    titulo: "Hello from the Fixfy team",
    blocos: [
      t("From today we are sending a short note twice a week through to the spring. Half of it is practical: the small jobs that stop big ones, what actually works on damp, when to book what. The other half is what we can do for you, with a proper discount attached."),
      l("What you can expect", [
        "Two short emails a week, never more",
        "Real seasonal advice you can use without booking anything",
        "Discount codes that work on our normal prices, not on inflated ones",
        "One click to stop, at the bottom of every email",
      ]),
      t("If that sounds useful, stay with us. If not, the unsubscribe link at the bottom works instantly and we will not chase you."),
    ],
    cta: "See our prices",
  },
  {
    n: 2,
    key: "autumn_deep_clean",
    etiqueta: "Offer",
    assunto: "The autumn deep clean, 15% off this month",
    preheader: "Windows shut, heating on, and everything the weekly clean skips.",
    titulo: "The clean that gets the whole flat ready",
    blocos: [
      t("From now until March the windows stay shut and the heating stays on. Whatever is in the carpets, the vents and the corners is staying in there with you."),
      l("What a deep clean gets to that a weekly one does not", [
        "Behind and underneath the fridge, washer and cooker",
        "Inside every cupboard, drawer and the fridge itself",
        "Limescale on screens, taps, tiles and the shower head",
        "Skirting, door frames, switches, vents and extractor filters",
      ]),
      t("It is the one clean that resets a flat for the whole winter, and this month it is fifteen percent off."),
    ],
    cta: "Book a deep clean",
    cupom: "AUTUMN15",
  },
  {
    n: 3,
    key: "condensation",
    etiqueta: "Home notes",
    assunto: "The window you wipe every morning is telling you something",
    preheader: "Condensation, in plain terms, and the three fixes that work.",
    titulo: "Wet windows in October",
    blocos: [
      t("Wet windows in the morning are not a fault in the glass. They are warm, damp air meeting cold glass overnight, and a London flat makes about ten litres of that damp air a week from showers, cooking and drying clothes."),
      l("Three things that actually help", [
        "Open the bathroom window or run the fan for 20 minutes after a shower, door closed",
        "Put the lid on the pan. Boiling pasta uncovered puts a pint of water in the air",
        "Never dry clothes on a radiator without a window open in that room",
      ]),
      t("If it is already black in the corners, do not paint over it. Reply to this email and we will tell you whether it is a clean, a seal or a ventilation job."),
    ],
    cta: "Ask us about damp",
  },
  {
    n: 4,
    key: "oven_before_winter",
    etiqueta: "Offer",
    assunto: "Nobody enjoys the oven. We will do it for you, 10% off",
    preheader: "Two hours, dismantled properly, no smell left behind.",
    titulo: "The job everyone puts off",
    blocos: [
      t("Roasting season is here and every oven in London is about to be used twice as much. The grease that is already in there is what makes the kitchen smoke and smell the moment you turn it up."),
      t("We take the door apart, lift out the racks and the fan cover, and soak the parts properly instead of spraying and wiping. It takes about two hours and the oven goes back together looking like the showroom."),
      q("Booked it on the Tuesday, cleaned on the Thursday, and I stopped being embarrassed to open the oven door in front of guests.", "Verified Fixfy customer, North London"),
    ],
    cta: "Book an oven clean",
    cupom: "OVEN10",
  },
  {
    n: 5,
    key: "gutters_leaves",
    etiqueta: "Home notes",
    assunto: "Ten minutes on the gutters now, no damp wall in February",
    preheader: "The cheapest bit of maintenance there is, and the most skipped.",
    titulo: "Before the leaves settle",
    blocos: [
      t("Every winter we get called to damp patches on internal walls that turn out to be a blocked gutter overflowing down the brick since October. The repair inside costs many times what clearing the gutter would have."),
      l("What to look for from the ground", [
        "Plants growing out of the gutter line, the clearest sign there is",
        "Staining or green growth on the wall under a joint",
        "Water running over the front edge instead of down the pipe when it rains",
      ]),
      t("If you can see any of those from the pavement, it is worth doing before the heavy rain. We bring the reach poles, so no ladders leaning on your brickwork."),
    ],
    cta: "Book a gutter clear",
  },
  {
    n: 6,
    key: "landlord_autumn",
    etiqueta: "Landlords",
    assunto: "Landlords: the three dates that cost money if you miss them",
    preheader: "Gas yearly, EICR every five, EPC on every new let.",
    titulo: "Paperwork, before it is urgent",
    blocos: [
      t("If you let a property, the dates creep up quietly and the penalty does not. Worse, an out of date certificate can block a section 21 and complicate an insurance claim."),
      l("The three that matter", [
        "Gas safety, every 12 months, and the tenant gets a copy within 28 days",
        "EICR, every 5 years or at change of tenancy, with remedial work signed off",
        "EPC, valid 10 years, required before you advertise a new let",
      ]),
      t("Send us the address and we will tell you what is due and when. Book the three together and the bundle is ten percent off, with the certificates in your inbox the same week."),
    ],
    cta: "Get a landlord quote",
    cupom: "LANDLORD10",
  },
  {
    n: 7,
    key: "moving_autumn",
    etiqueta: "Moving out",
    assunto: "Moving this autumn? This is where deposits go",
    preheader: "The checklist agents actually use, and what it costs to pass it.",
    titulo: "Getting the full deposit back",
    blocos: [
      t("Cleaning is the single most common deduction from a London deposit, and the check is not subjective. Agents look at the same list every time, in the same order."),
      l("What gets checked first, every time", [
        "The oven, inside the door glass and under the trays",
        "Limescale on taps, screens and tiles",
        "Inside cupboards, the fridge and the freezer",
        "Skirting, window frames, extractor fans and light switches",
      ]),
      t("Our end of tenancy clean covers all of it, and if the agent flags something in the first 48 hours we come back at no cost. Ten percent off with the code below."),
    ],
    cta: "Get a move-out price",
    cupom: "MOVEOUT10",
  },
  {
    n: 8,
    key: "five_minute_jobs",
    etiqueta: "Home notes",
    assunto: "Five jobs that take five minutes and save a call-out",
    preheader: "No booking needed. Just useful.",
    titulo: "Five minutes each, worth doing this weekend",
    blocos: [
      t("No pitch in this one. These are the five things we most often find that could have been done by anyone with a cloth and a spanner."),
      l("Worth doing yourself", [
        "Pull the extractor filter out and wash it in hot soapy water",
        "Clear the washing machine filter, bottom front corner, bowl underneath",
        "Run a hot empty cycle with a cup of white vinegar in the drum",
        "Check the boiler pressure gauge sits between 1 and 1.5 bar when cold",
        "Wipe the fridge door seal and check it still grips a sheet of paper",
      ]),
      t("If any of those turns into something bigger, that is what we are for."),
    ],
    cta: "See what we fix",
  },

  /* ══════════════════ NOVEMBRO ══════════════════ */
  {
    n: 9,
    key: "boiler_service",
    etiqueta: "Home notes",
    assunto: "Book the boiler service now, not in January",
    preheader: "Every January we get the same calls. Most were preventable in November.",
    titulo: "Before the first cold snap",
    blocos: [
      t("Boilers do not fail in mild weather. They fail on the first properly cold night, which is also the night every engineer in London is already booked."),
      l("Signs it needs looking at now", [
        "Pressure that keeps dropping and needs topping up every few weeks",
        "Radiators warm at the bottom and cold at the top",
        "A rumbling or kettling noise when the heating fires up",
        "Hot water that runs lukewarm before it runs hot",
      ]),
      t("A service takes under an hour. Reply with your postcode and we will tell you the next slot we have."),
    ],
    cta: "Book a boiler service",
  },
  {
    n: 10,
    key: "radiators_bleed",
    etiqueta: "Home notes",
    assunto: "Cold at the top, warm at the bottom: a ten minute fix",
    preheader: "How to bleed a radiator properly, in five steps.",
    titulo: "Bleeding a radiator, properly",
    blocos: [
      t("Air trapped at the top of a radiator is the most common heating complaint we hear, and one of the few worth doing yourself."),
      l("The five steps", [
        "Turn the heating off and let the radiators go cold",
        "Put a cloth and a bowl under the valve at the top corner",
        "Open the valve a quarter turn with the key until air hisses out",
        "Close it the moment water comes out, and do not overtighten",
        "Check the boiler pressure afterwards and top up to 1.2 bar if it dropped",
      ]),
      t("If it is still cold at the top after that, it is sludge rather than air, and that one does need us."),
    ],
    cta: "Ask about a power flush",
  },
  {
    n: 11,
    key: "winter_prep_visit",
    etiqueta: "Offer",
    assunto: "One visit, the whole winter list, 10% off",
    preheader: "Gutters, draughts, pipes and the outside tap, in one go.",
    titulo: "The winter prep visit",
    blocos: [
      t("Calling someone out for one job never makes sense. Calling them out for six does, and November is the month where the six are obvious."),
      l("What we do in a winter prep visit", [
        "Clear the gutters and check the downpipes run",
        "Lag exposed pipes in the loft and at the outside tap",
        "Draught-proof the letterbox, the loft hatch and any door that whistles",
        "Bleed and balance the radiators, check boiler pressure",
        "Service the extractor fans so condensation has somewhere to go",
      ]),
      t("Half a day for most homes, fixed price agreed before we start, ten percent off this month."),
    ],
    cta: "Book a winter visit",
    cupom: "WINTER10",
  },
  {
    n: 12,
    key: "draughts",
    etiqueta: "Home notes",
    assunto: "Where the heat actually leaves your flat",
    preheader: "It is rarely the windows. Here is the real order.",
    titulo: "Find the draught, keep the heat",
    blocos: [
      t("People replace windows to fix a cold flat and are surprised when it stays cold. In most London conversions the heat leaves somewhere cheaper to fix."),
      l("The usual order, worst first", [
        "The loft hatch, if it is not sealed and insulated on top",
        "The letterbox and any unused keyhole",
        "Floorboard gaps and the skirting line in a ground floor flat",
        "Chimney breasts that were never capped or blocked",
        "Only then, the windows",
      ]),
      t("A candle held near the edges on a windy day finds all of them in ten minutes. Most are an afternoon of handyman work, not a renovation."),
    ],
    cta: "Book a handyman",
  },
  {
    n: 13,
    key: "carpets_before_guests",
    etiqueta: "Offer",
    assunto: "Before you replace the carpet, let us try it",
    preheader: "Hot water extraction lifts what hoovering cannot. 10% off.",
    titulo: "The hallway path, gone",
    blocos: [
      t("People replace carpets that were only ever dirty. The grey path down the hallway, the ring by the sofa, the mark the dog made two winters ago: almost all of that lifts."),
      t("We use hot water extraction, which means the dirt comes out of the pile rather than moving around in it. The room is usable the same evening and it costs a small fraction of new carpet."),
      q("I had the quote for new carpet in my hand. They cleaned it instead and I put the quote in the bin.", "Verified Fixfy customer, South East London"),
    ],
    cta: "Book a carpet clean",
    cupom: "CARPET10",
  },
  {
    n: 14,
    key: "handyman_list",
    etiqueta: "Offer",
    assunto: "Everyone has the list. Ours is 10% off this month",
    preheader: "The door that sticks, the shelf that never went up, the tap that drips.",
    titulo: "Bundle the small jobs",
    blocos: [
      t("Every home has the list. The door that catches, the loose handle, the shelf still in its box, the tap that drips and the light that flickers."),
      t("One at a time, each one costs a call-out and never gets done. Written down and handed over in one go, most homes clear the entire list in half a day."),
      l("Things we cleared last month, in one visit each", [
        "Six pictures hung, a curtain pole and two flat-pack units",
        "Two internal doors eased and rehung, three handles replaced",
        "A dripping mixer tap, a running toilet and a silicone reseal",
      ]),
      t("Write your list, reply with it, and we will price the visit."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    n: 15,
    key: "damp_vs_condensation",
    etiqueta: "Home notes",
    assunto: "Damp, condensation or a leak? Tell them apart in a minute",
    preheader: "The three look the same on a wall and cost very different money.",
    titulo: "What that patch actually is",
    blocos: [
      t("Three different problems make a dark patch on a wall, and the fix for one is useless on the others. This is how a tradesperson tells them apart before touching anything."),
      l("The quick test", [
        "Condensation: worst in corners and behind furniture, on outside walls, black speckled mould, appears in the cold months",
        "Rising damp: a tide mark up to about a metre, on ground floor only, often with salt crystals",
        "A leak: a defined patch that grows after rain or after someone showers upstairs, and it does not match the season",
      ]),
      t("If you are not sure, take a photo and reply to this email. We would rather tell you it is condensation than sell you a damp proof course you do not need."),
    ],
    cta: "Send us a photo",
  },
  {
    n: 16,
    key: "fixfy_friday",
    etiqueta: "Offer",
    assunto: "Our one big discount of the year: 15% off, this week only",
    preheader: "Any service, booked this week, for work any time before March.",
    titulo: "Fixfy Friday",
    blocos: [
      t("We do not run constant sales, because a price that changes every week was never a real price. Once a year we do this properly instead."),
      t("Fifteen percent off any service booked this week. Cleaning, handyman, painting, electrics, plumbing, certificates. Book now and the work itself can be any time before March, so this also covers your Christmas and new year jobs."),
      l("Most people use it on", [
        "A pre-Christmas deep clean, booked now for December",
        "The handyman list before the family arrives",
        "A room repainted in January, when we have more slots",
      ]),
    ],
    cta: "Use the code",
    cupom: "FIXFYFRIDAY15",
  },

  /* ══════════════════ DEZEMBRO ══════════════════ */
  {
    n: 17,
    key: "festive_deep_clean",
    etiqueta: "Offer",
    assunto: "House full next week? The pre-Christmas clean, 10% off",
    preheader: "Book the slot now. The last two weeks of December always go first.",
    titulo: "Ready before everyone arrives",
    blocos: [
      t("December slots go in order, and the last two weeks fill first every single year. If people are coming to you, this is the week to put it in the diary."),
      l("What most people book before Christmas", [
        "A deep clean of the kitchen and both bathrooms",
        "The oven, before it does the heavy lifting on the day",
        "Carpets and the spare room, so it is ready for guests",
        "Windows inside, because the low winter sun shows everything",
      ]),
      t("Ten percent off with the code below, on anything booked for December."),
    ],
    cta: "Book my slot",
    cupom: "FESTIVE10",
  },
  {
    n: 18,
    key: "guest_ready_day",
    etiqueta: "Home notes",
    assunto: "Guest-ready in one day, in the right order",
    preheader: "Doing it in this order saves about two hours.",
    titulo: "The order that saves you a morning",
    blocos: [
      t("If you are doing it yourself this year, the order matters more than the effort. Most people clean top to bottom in the wrong rooms and end up redoing the floors."),
      l("The order we use", [
        "Strip beds and start the first wash before anything else",
        "Spray the bathroom and the oven, then walk away for twenty minutes",
        "Dust and wipe high to low in every room, floors untouched",
        "Come back to the bathroom and oven, which now wipe off with no scrubbing",
        "Hoover the whole flat last, then mop backwards out of each room",
      ]),
      t("And leave the spare room until the end, because it is where everything gets dumped while you clean."),
    ],
    cta: "Or let us do it",
  },
  {
    n: 19,
    key: "oven_after_roast",
    etiqueta: "Offer",
    assunto: "After the roast, before the new year",
    preheader: "Oven cleans, 10% off, with slots in the quiet week.",
    titulo: "The week after is the best week to book",
    blocos: [
      t("The week between Christmas and new year is the quietest week in our diary and the dirtiest week for your oven. Those two facts belong together."),
      t("We strip it, soak the parts and rebuild it, usually in about two hours, and you start January with a kitchen that does not smoke when you turn the heat up."),
    ],
    cta: "Book an oven clean",
    cupom: "OVEN10",
  },
  {
    n: 20,
    key: "paint_before_family",
    etiqueta: "Offer",
    assunto: "One room repainted changes more than new furniture",
    preheader: "£50 off a room, prep done properly, two days start to finish.",
    titulo: "The cheapest way to make a place feel new",
    blocos: [
      t("New sofa, new kitchen, new flat. All expensive. A room repainted properly costs a fraction of any of them and changes how the whole place feels."),
      l("What proper prep means, and why the price differs", [
        "Fill, sand and caulk every gap before any paint goes on",
        "Two full coats, not one thick one",
        "Furniture moved and covered, edges cut in by hand",
        "Everything back in place the same evening we finish",
      ]),
      t("Most single rooms take two days. Fifty pounds off with the code below."),
    ],
    cta: "Get a painting quote",
    cupom: "PAINT50",
  },
  {
    n: 21,
    key: "christmas_cover",
    etiqueta: "Home notes",
    assunto: "What to do if something goes wrong over Christmas",
    preheader: "Stopcock, fuse board, and the two numbers worth saving.",
    titulo: "The five minutes that save a bad day",
    blocos: [
      t("Most Christmas emergencies are made worse by not knowing where things are. Five minutes now, while everything is calm."),
      l("Find these today", [
        "The stopcock, usually under the kitchen sink. Check it actually turns",
        "The fuse board and which switch is which, written on a label",
        "The gas emergency number, 0800 111 999, saved in your phone",
        "Your boiler model and when it was last serviced",
      ]),
      t("We are around over the period for our own customers. If something goes wrong, reply to this email and we will tell you honestly whether it can wait."),
    ],
    cta: "Save our details",
  },
  {
    n: 22,
    key: "between_reset",
    etiqueta: "Offer",
    assunto: "The quiet week reset, 10% off",
    preheader: "Our diary is empty, your flat is not. Good timing for both of us.",
    titulo: "Between Christmas and new year",
    blocos: [
      t("The week between the holidays is the one week nobody books anything, which means our best partners are free and you can have any slot you want."),
      t("It is also the week the flat is at its worst: full house, big meals, and everything moved somewhere it does not live. A reset clean in that week starts January properly."),
    ],
    cta: "Book the reset",
    cupom: "RESET10",
  },
  {
    n: 23,
    key: "fridge_reset",
    etiqueta: "Home notes",
    assunto: "The fridge, the freezer and the food nobody will eat",
    preheader: "A 30 minute job that stops the smell before it starts.",
    titulo: "Reset the fridge before January",
    blocos: [
      t("Half a jar of something, two open packets and a plate covered in foil. Every fridge in the country looks the same this week."),
      l("Thirty minutes, in this order", [
        "Everything out onto the counter, bin the obvious",
        "Shelves and drawers into warm soapy water, never hot on cold glass",
        "Wipe the walls with warm water and a spoon of bicarb, not bleach",
        "Wipe the door seal, which is where mould starts, and dry it",
        "Everything back with the oldest at the front",
      ]),
      t("If the seal no longer grips a sheet of paper, replacing it costs far less than the electricity a bad one wastes."),
    ],
    cta: "See our cleaning prices",
  },
  {
    n: 24,
    key: "new_year_slots",
    etiqueta: "Home notes",
    assunto: "January fills in the first week. A heads up",
    preheader: "Our customer list gets the slots before the website does.",
    titulo: "Planning January",
    blocos: [
      t("Every January the first full week fills within days: regular cleans starting up, deep cleans, and the painting people put off all year."),
      t("You are on our customer list, which means you get first refusal on those slots before they go on the website. If you already know what you need, reply with the rough date and we will hold it."),
    ],
    cta: "Check availability",
  },

  /* ══════════════════ JANEIRO ══════════════════ */
  {
    n: 25,
    key: "january_reset",
    etiqueta: "Offer",
    assunto: "Start the year with the flat sorted: 15% off",
    preheader: "Our biggest January discount, on the deep clean.",
    titulo: "The January reset",
    blocos: [
      t("January is the month people actually change things. We would rather help with the flat than sell you a gym membership."),
      l("The reset, in one visit", [
        "Kitchen deep cleaned, oven included, inside and out",
        "Bathrooms descaled properly, tiles, grout and screens",
        "Every cupboard emptied, wiped and put back",
        "Floors, skirting, frames and switches, top to bottom",
      ]),
      t("Fifteen percent off for January, which is the largest discount we run all year apart from Fixfy Friday."),
    ],
    cta: "Book the reset",
    cupom: "JANUARY15",
  },
  {
    n: 26,
    key: "declutter",
    etiqueta: "Home notes",
    assunto: "Where to actually take the stuff in London",
    preheader: "Charity, recycling and the things that need booking.",
    titulo: "Getting rid of it, properly",
    blocos: [
      t("Decluttering stalls at the same point every year: the pile by the door that nobody knows what to do with. This is the short version for London."),
      l("Where things go", [
        "Clothes and books: most charity shops take them, but ring first in January, they get swamped",
        "Electricals: council recycling centres take them free, and many take them from the kerb by appointment",
        "Furniture: your council bulky waste collection, usually a small fee and a two week wait, so book before you start",
        "Paint and chemicals: never the bin, and never the drain. Recycling centre only",
      ]),
      t("If it needs two people and a van, we can quote a clearance as part of a visit."),
    ],
    cta: "Ask about a clearance",
  },
  {
    n: 27,
    key: "frozen_pipes",
    etiqueta: "Home notes",
    assunto: "If a pipe freezes, do this. And do not do that",
    preheader: "The one mistake that turns a frozen pipe into a burst one.",
    titulo: "Cold snap, frozen pipe",
    blocos: [
      t("A frozen pipe is an inconvenience. A burst one is a ceiling. The difference is usually what somebody did in the first ten minutes."),
      l("If nothing comes out of the tap", [
        "Turn off the stopcock first, before anything else",
        "Open the cold tap nearest the freeze so melting water has somewhere to go",
        "Warm the pipe slowly with a hot water bottle or towels soaked in warm water, starting at the tap end",
        "Never use a blowtorch, a heat gun or boiling water. That is what splits the pipe",
      ]),
      t("If it has already burst, stopcock off, electrics off if water is anywhere near them, then call us."),
    ],
    cta: "Save our number",
  },
  {
    n: 28,
    key: "regular_clean_habit",
    etiqueta: "Offer",
    assunto: "The cheapest clean is the regular one. 10% off to start",
    preheader: "Same cleaner, fortnightly, learns your place. Best value we do.",
    titulo: "Regular beats rescue",
    blocos: [
      t("A one-off deep clean after three months always costs more than keeping on top of it, and it is a worse day for everyone involved."),
      t("A fortnightly visit with the same cleaner, who learns where things live and what you care about, is our most popular booking and the best value on the list. Weekly if you have a full house."),
      q("Same person every other Tuesday for a year now. I do not think about it any more, which is the whole point.", "Verified Fixfy customer, West London"),
      t("Ten percent off while you settle into it."),
    ],
    cta: "Set up a regular clean",
    cupom: "REGULAR10",
  },
  {
    n: 29,
    key: "landlord_january",
    etiqueta: "Landlords",
    assunto: "Landlords: get the year's compliance done in one week",
    preheader: "Gas, EICR and EPC together, 10% off the bundle.",
    titulo: "One week, all the paperwork",
    blocos: [
      t("January is the quietest month for tenant turnover, which makes it the easiest month to get access and get the compliance done without rushing anybody."),
      l("Booked together, one visit each, one invoice", [
        "Gas safety certificate, valid 12 months",
        "EICR, valid 5 years, with any remedial work quoted before we do it",
        "EPC, valid 10 years, needed before you advertise",
        "A handyman hour on top, for the small things the tenant has been asking about",
      ]),
      t("Ten percent off the bundle, certificates in your inbox the same week."),
    ],
    cta: "Book the bundle",
    cupom: "LANDLORD10",
  },
  {
    n: 30,
    key: "mould_after_holidays",
    etiqueta: "Home notes",
    assunto: "Black spots in the corner: what actually removes them",
    preheader: "And why painting over it always comes back.",
    titulo: "Mould, properly dealt with",
    blocos: [
      t("Mould on a wall is the visible end of a moisture problem. Removing it without fixing the moisture means it is back by March, usually in the same corner."),
      l("What works, in order", [
        "Wipe it off with a proper fungicidal wash, not bleach. Bleach lifts the colour and leaves the roots",
        "Dry the area completely, with heat and air movement for a day or two",
        "Fix the moisture: ventilation, insulation, or the leak that is feeding it",
        "Only then redecorate, with a mould resistant paint on that wall",
      ]),
      t("If it covers more than about a square metre, or it comes back every winter in the same place, it is worth having someone look properly."),
    ],
    cta: "Book a damp check",
  },
  {
    n: 31,
    key: "paint_in_winter",
    etiqueta: "Offer",
    assunto: "Winter is the right time to paint inside. £50 off",
    preheader: "Heating on, windows cracked, and our best slots of the year.",
    titulo: "Why decorators like January",
    blocos: [
      t("People wait for summer to paint indoors, which is backwards. Modern water based paint dries best in a warm room with a little air moving, which is exactly a London flat with the heating on and a window on the latch."),
      t("It is also the month we have the most slots, so you get the decorator you want on the date you want. Fifty pounds off a room with the code below."),
    ],
    cta: "Get a painting quote",
    cupom: "PAINT50",
  },
  {
    n: 32,
    key: "january_moves",
    etiqueta: "Moving out",
    assunto: "Moving in January? Book the clean before the van",
    preheader: "The order that gets the full deposit back.",
    titulo: "Moving out, in the right order",
    blocos: [
      t("The most common mistake is booking the clean for the same day as the van. The flat needs to be empty for a proper end of tenancy clean, and the check-out inspection usually happens within a day of the keys going back."),
      l("The order that works", [
        "Van and everything out, ideally the morning before",
        "End of tenancy clean on the empty flat, same day or the next",
        "Any small repairs the same visit: filled holes, touched up paint, a working bulb in every fitting",
        "Check-out inspection after that, with your photos taken on the way out",
      ]),
      t("Ten percent off the end of tenancy clean, and we come back free if the agent flags anything in the first 48 hours."),
    ],
    cta: "Get a move-out price",
    cupom: "MOVEOUT10",
  },

  /* ══════════════════ FEVEREIRO ══════════════════ */
  {
    n: 33,
    key: "eicr_explained",
    etiqueta: "Landlords",
    assunto: "What an EICR actually checks, in plain English",
    preheader: "C1, C2, C3 and FI, and which ones you have to act on.",
    titulo: "Reading an EICR without a dictionary",
    blocos: [
      t("Landlords get the certificate, see a list of codes and have no idea which ones cost money. Here is the whole thing in four lines."),
      l("The codes", [
        "C1: danger present. Must be made safe immediately, usually on the day",
        "C2: potentially dangerous. Must be fixed for the report to be satisfactory",
        "C3: improvement recommended. You do not have to act, and a report can still pass",
        "FI: further investigation needed, and that does have to be followed up",
      ]),
      t("A report with only C3 items is a pass. If someone quotes you for a full rewire off the back of C3s, get a second opinion, and we are happy to be it."),
    ],
    cta: "Book an EICR",
  },
  {
    n: 34,
    key: "half_term_carpets",
    etiqueta: "Offer",
    assunto: "Half term, wet shoes, and the carpet. 10% off",
    preheader: "February is the worst month for floors. It lifts, we promise.",
    titulo: "The worst month for floors",
    blocos: [
      t("February is mud, wet shoes and everyone indoors. Carpets take the whole of it, and hoovering just moves the fine stuff deeper into the pile."),
      t("Hot water extraction pulls it out instead. Rooms are walkable within a couple of hours and properly dry by the evening. Ten percent off this month."),
    ],
    cta: "Book a carpet clean",
    cupom: "CARPET10",
  },
  {
    n: 35,
    key: "boiler_midwinter",
    etiqueta: "Home notes",
    assunto: "Radiators cold again? Check these three things first",
    preheader: "Two of them you can fix in ten minutes without calling anyone.",
    titulo: "Before you call an engineer",
    blocos: [
      t("Mid-winter is when heating problems appear. Three of the most common have nothing to do with the boiler itself."),
      l("Check these first", [
        "Boiler pressure when cold. Below 1 bar and the system will not heat properly. Top up with the filling loop",
        "The thermostatic valve on the cold radiator. They stick open or shut in winter. Pull the head off and press the pin in and out a few times",
        "The room thermostat batteries, which fail silently and look exactly like a broken boiler",
      ]),
      t("If all three are fine and it is still cold, then it is worth a visit, and you will have saved yourself a call-out fee for something you could have done."),
    ],
    cta: "Book a heating visit",
  },
  {
    n: 36,
    key: "handyman_half_day",
    etiqueta: "Offer",
    assunto: "Half a day, the whole list, 10% off",
    preheader: "Bring us the list you have been ignoring since November.",
    titulo: "The list, cleared",
    blocos: [
      t("You wrote the list in November. It is February. This is the nudge."),
      t("Half a day of handyman time clears most of what has been sitting there: the sticking door, the shelf, the dripping tap, the flickering light, the silicone that has gone black."),
      t("Reply with your list, however rough, and we will tell you if it fits in half a day or needs a full one. Ten percent off with the code."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    n: 37,
    key: "deposit_guide",
    etiqueta: "Moving out",
    assunto: "Your deposit: what they can and cannot take",
    preheader: "Fair wear and tear, in practice, with examples.",
    titulo: "What a landlord can actually deduct",
    blocos: [
      t("Deposits are protected by law and deductions have to be justified. Plenty of them are not, and tenants pay because nobody explained the line."),
      l("They cannot charge you for", [
        "Fair wear and tear: worn carpet in a hallway after three years, faded paint, small scuffs",
        "Anything that was already recorded in the check-in inventory",
        "Betterment: a brand new carpet to replace a ten year old one you stained",
      ]),
      l("They usually can charge you for", [
        "Cleaning below the standard at check-in, which is the most common deduction by far",
        "Damage beyond wear: a burn, a broken door, a hole in the plaster",
        "Rubbish or belongings left behind",
      ]),
      t("A professional clean with a receipt removes the argument on the big one. If you want the receipt to say Fixfy, we are here."),
    ],
    cta: "Get a move-out price",
  },
  {
    n: 38,
    key: "windows_winter",
    etiqueta: "Offer",
    assunto: "Low winter sun shows everything. 10% off windows",
    preheader: "Inside and out, with reach poles, no ladders on your brickwork.",
    titulo: "The month the glass looks worst",
    blocos: [
      t("Low winter sun comes in at an angle that shows every mark on the glass. Nothing changed about the windows. The light did."),
      t("We do inside and out with pure water and reach poles, which means no ladders against your walls and no streaks when it dries. Flats up to four floors, most homes done in a morning."),
    ],
    cta: "Book a window clean",
    cupom: "WINDOW10",
  },
  {
    n: 39,
    key: "kitchen_deep",
    etiqueta: "Home notes",
    assunto: "The five places in a kitchen that never get cleaned",
    preheader: "And the two minute fix for each one.",
    titulo: "The bits everyone misses",
    blocos: [
      t("Kitchens get wiped daily and deep cleaned rarely, so the same five places build up in every home we visit."),
      l("Worth ten minutes each", [
        "The extractor filter, which is usually the source of the smell people blame on the bin",
        "The top of the wall units, where grease and dust make a sticky film",
        "The rubber seal and the filter in the dishwasher, bottom of the tub",
        "Under the fridge, where the coils clog and push the electricity bill up",
        "The kettle and the shower head, both of which are mostly limescale by now",
      ]),
      t("Any of those turn from ten minutes into an hour, that is our job rather than yours."),
    ],
    cta: "Book a kitchen deep clean",
  },
  {
    n: 40,
    key: "landlord_bundle",
    etiqueta: "Landlords",
    assunto: "One partner for the whole property, one invoice",
    preheader: "Clean, fix, certify and turn around, without four suppliers.",
    titulo: "Stop juggling four trades",
    blocos: [
      t("Most landlords we meet have a cleaner, a handyman, an electrician and a gas engineer, all with different diaries, different invoices and different excuses when something slips."),
      l("What one partner changes", [
        "One booking for the turnaround, cleaning and repairs on the same day",
        "One invoice, one VAT position, one place to chase",
        "Certificates filed and emailed to you the same week",
        "Photos of the work, so you do not need to visit the property",
      ]),
      t("Ten percent off the certificate bundle while you try us on one property."),
    ],
    cta: "Talk to us about your portfolio",
    cupom: "LANDLORD10",
  },

  /* ══════════════════ MARÇO ══════════════════ */
  {
    n: 41,
    key: "spring_clean",
    etiqueta: "Offer",
    assunto: "The spring clean, 15% off",
    preheader: "Windows open, everything that winter left behind, gone.",
    titulo: "Open the windows, start again",
    blocos: [
      t("Six months of closed windows and heating leaves a flat dull in a way that daily cleaning does not touch. The spring clean is the one that lifts it."),
      l("What is in it", [
        "Every window inside, frames, sills and tracks",
        "Curtains and blinds taken down, dusted and rehung",
        "Behind and under all the furniture and appliances",
        "Carpets and hard floors done properly, not just passed over",
        "The kitchen and bathrooms deep cleaned rather than wiped",
      ]),
      t("Fifteen percent off through March, our last big discount of the season."),
    ],
    cta: "Book a spring clean",
    cupom: "SPRING15",
  },
  {
    n: 42,
    key: "spring_windows",
    etiqueta: "Offer",
    assunto: "Windows, frames and the bit of the track nobody does",
    preheader: "10% off, inside and out, before the pollen arrives.",
    titulo: "Do the glass before the pollen",
    blocos: [
      t("There is a two or three week window in March when the winter grime is off and the pollen has not started. That is the moment to do the glass."),
      t("We do frames, sills and the runners as well as the glass, which is what makes the difference between clean windows and a clean flat."),
    ],
    cta: "Book a window clean",
    cupom: "WINDOW10",
  },
  {
    n: 43,
    key: "outside_tidy",
    etiqueta: "Home notes",
    assunto: "The outside jobs, in the order that makes sense",
    preheader: "Cheaper together than one at a time, and March is the month.",
    titulo: "One trip outside, five jobs done",
    blocos: [
      t("Outside work is priced by the visit as much as by the job, because most of the cost is getting the kit there and setting it up. So doing them together is genuinely cheaper, not just convenient."),
      l("The usual March list", [
        "Gutters cleared of the winter leaves and checked for joint leaks",
        "The path and patio cleaned before it gets slippery in the next rain",
        "Fascia, soffits and the front door frame washed down",
        "Outside lights and the bell checked after the winter damp",
        "Fence panels and gates that loosened in the storms",
      ]),
      t("Reply with a photo of the front and back and we will price the lot in one go."),
    ],
    cta: "Ask for an outside quote",
  },
  {
    n: 44,
    key: "april_moves",
    etiqueta: "Moving out",
    assunto: "April moving season starts now. Book early, pay less",
    preheader: "10% off end of tenancy, and the good slots go first.",
    titulo: "Moving in the spring rush",
    blocos: [
      t("London tenancies cluster, and the end of March through April is the busiest stretch of the year. Cleaners, vans and check-out inspections all compete for the same three days at the end of the month."),
      t("Booking two weeks out gets you the slot you want, a proper window either side of the van, and ten percent off with the code below."),
    ],
    cta: "Get a move-out price",
    cupom: "MOVEOUT10",
  },
  {
    n: 45,
    key: "paint_spring",
    etiqueta: "Offer",
    assunto: "A fresh coat before the light comes back. £50 off",
    preheader: "Spring light shows every mark. It also shows fresh paint.",
    titulo: "Paint, before the light gets bright",
    blocos: [
      t("Spring light is unforgiving on walls. Every scuff from the winter, the marks behind the sofa, the patch by the light switch: all of it shows up in March."),
      t("It also makes fresh paint look its best, which is why March and April are our busiest decorating months. Fifty pounds off a room, and prep done properly so it lasts."),
    ],
    cta: "Get a painting quote",
    cupom: "PAINT50",
  },
  {
    n: 46,
    key: "dust_allergies",
    etiqueta: "Home notes",
    assunto: "Hay fever season: what actually helps indoors",
    preheader: "Four things that work, and two that do not.",
    titulo: "Keeping the pollen outside",
    blocos: [
      t("Pollen comes in on clothes, hair and open windows, and then lives in soft furnishings until something removes it. A few small habits make a real difference indoors."),
      l("Worth doing", [
        "Dry washing indoors during high pollen days, even though it feels wrong",
        "Wipe surfaces with a damp cloth rather than dusting them into the air",
        "Wash bedding weekly at 60 degrees through the season",
        "Hoover with a HEPA filter, slowly, and empty it outside",
      ]),
      t("A deep clean of the soft surfaces, carpets, curtains, mattress and sofa, at the start of the season is the single biggest change most people notice."),
    ],
    cta: "Book a deep clean",
  },
  {
    n: 47,
    key: "landlord_spring",
    etiqueta: "Landlords",
    assunto: "Landlords: the spring checklist before the turnover",
    preheader: "Ten things worth checking between tenancies.",
    titulo: "Between tenants, in one visit",
    blocos: [
      t("The gap between tenancies is short and expensive. This is the list we work through when a landlord hands us a property for a turnaround."),
      l("The turnaround list", [
        "Full clean including the oven, inside cupboards and the appliances",
        "Smoke and carbon monoxide alarms tested and dated",
        "Every bulb working, every socket and switch checked",
        "Silicone and grout in the bathroom renewed if it has gone",
        "Filled holes, touched up paint, doors easing properly",
        "Certificates in date and filed",
      ]),
      t("One visit, one invoice, photos of everything so you do not have to attend."),
    ],
    cta: "Book a turnaround",
  },
  {
    n: 48,
    key: "refer_friend",
    etiqueta: "Offer",
    assunto: "£20 for you, £20 for them",
    preheader: "The only marketing that has ever really worked for us.",
    titulo: "Pass us on",
    blocos: [
      t("Most of our work comes from someone telling a neighbour. We would rather spend the money there than on advertising, so here it is."),
      t("Send a friend our way and you both get twenty pounds: theirs off their first job, yours off your next one. They use the code below, and we credit your account when their job is done."),
      t("No limit on how many people you send us, and it never expires while you are a customer."),
    ],
    cta: "Share Fixfy",
    cupom: "REFER20",
  },

  /* ══════════════════ FIM DA TEMPORADA ══════════════════ */
  {
    n: 49,
    key: "best_of_notes",
    etiqueta: "Home notes",
    assunto: "The six tips from this season worth keeping",
    preheader: "One email with everything useful we sent since October.",
    titulo: "The season, in one page",
    blocos: [
      t("We have sent a lot of these since October. Here are the six that people replied to most, in one place, so you can keep this one."),
      l("Worth remembering", [
        "Wipe the fridge door seal monthly. It is where mould starts and it fails silently",
        "Boiler pressure lives between 1 and 1.5 bar when cold",
        "Plants in the gutter means water down your wall by February",
        "Bleach lifts the colour of mould and leaves the roots. Use a fungicidal wash",
        "A frozen pipe: stopcock off, warm slowly from the tap end, never a blowtorch",
        "A professional clean with a receipt is what settles deposit arguments",
      ]),
      t("Reply with anything you want us to cover next season. We read all of them."),
    ],
    cta: "See our services",
  },
  {
    n: 50,
    key: "feedback",
    etiqueta: "Home notes",
    assunto: "What should we do more of?",
    preheader: "Two questions, one reply, no form to fill in.",
    titulo: "A quick question, honestly asked",
    blocos: [
      t("We are planning the next six months, and we would rather ask than guess."),
      l("Two questions", [
        "Which of these emails did you actually find useful?",
        "What job in your home is still not done, and what has stopped you?",
      ]),
      t("Hit reply and tell us in a line. There is no form and no survey. Every answer comes to a person here, and the second question often turns into us just telling you how to do it yourself."),
    ],
    cta: "Or see our prices",
  },
  {
    n: 51,
    key: "loyalty_thanks",
    etiqueta: "Offer",
    assunto: "Thank you, properly: 15% off your next job",
    preheader: "For everyone who booked with us this season.",
    titulo: "Thank you for this season",
    blocos: [
      t("You booked with us, which is not a small thing when there are a hundred companies with a van and a website."),
      t("So this one is simple: fifteen percent off your next job, whatever it is, any time before the end of the season. No minimum, no catch, and it works alongside our normal prices rather than a marked up version of them."),
    ],
    cta: "Book your next job",
    cupom: "LOYAL15",
  },
  {
    n: 52,
    key: "season_finale",
    etiqueta: "Home notes",
    assunto: "That is the season. Here is what happens next",
    preheader: "Fewer emails from here, and how to reach us any time.",
    titulo: "Until the next one",
    blocos: [
      t("That is the last note of this season. Thanks for reading them, and particularly to everyone who replied with questions, photos of suspicious walls and lists of jobs."),
      t("We will be back with the next season, and in the meantime the door is open: reply to this email with anything at all about your home and a person here will answer, whether or not it turns into a job."),
      t("If you would rather not hear from us again, the link at the bottom stops everything in one click, and we will not take it personally."),
    ],
    cta: "Book any time",
  },
];

/* ═══════════════════════ Que peça sai hoje ═══════════════════════ */

const DIA_MS = 24 * 60 * 60 * 1000;
/** 3,5 dias por edição, que é o que dá duas por semana. */
const PASSO_MS = 3.5 * DIA_MS;

/** O índice da edição da vez. Fora da temporada, a agenda recomeça. */
export function indiceDaData(quando: Date = new Date()): number {
  const inicio = new Date(`${INICIO_DA_TEMPORADA}T00:00:00Z`).getTime();
  const passos = Math.floor((quando.getTime() - inicio) / PASSO_MS);
  if (!Number.isFinite(passos) || passos < 0) return 0;
  return passos % AGENDA.length;
}

export function pecaDaData(quando: Date = new Date()): PecaDaAgenda {
  return AGENDA[indiceDaData(quando)];
}

/** Quando a edição `n` sai. Serve ao painel, para mostrar o calendário. */
export function dataDaPeca(n: number): Date {
  const inicio = new Date(`${INICIO_DA_TEMPORADA}T00:00:00Z`).getTime();
  return new Date(inicio + (n - 1) * PASSO_MS);
}

/** A temporada já virou pelo menos uma volta? O painel avisa para reescrever. */
export function temporadaVencida(quando: Date = new Date()): boolean {
  const inicio = new Date(`${INICIO_DA_TEMPORADA}T00:00:00Z`).getTime();
  return quando.getTime() - inicio > AGENDA.length * PASSO_MS;
}
