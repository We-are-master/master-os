/**
 * As 26 edições do clube B2C: cada uma mostra UM serviço que a Fixfy faz.
 *
 * Decisão do dono em 14/10/2026: nada de mudança de casa (saída e entrada de
 * imóvel) para o cliente final, e nada de dica genérica de casa. O clube é a
 * vitrine: limpeza, reparos, pintura e, de vez em quando, certificados, em
 * rodízio, cada edição com um ângulo próprio.
 *
 * Voz do Victor (dono, 15/10/2026): primeira pessoa, frases curtas, convite
 * para responder. O remetente é ele e a resposta cai em victor@getfixfy.com.
 *
 * Só entra o que o site vende e fecha pelo link: deep clean, after builders,
 * reparos (meia diária e diária), pintura (retoque, cômodo, diária) e os três
 * certificados. Preços do site em 14/10/2026 (o preço da tela é o total: no
 * modelo de agente o B2C nunca diz "VAT included"). Garantia: 14 dias (dono, 14/10). Material de reparo é cotado
 * à parte. Nada de trabalho em altura.
 */

import type { Bloco } from "@/lib/emails/campanha-layout";

export type PecaDoClube = {
  key: string;
  etiqueta: "Cleaning" | "Repairs" | "Painting" | "Certificates" | "Fixfy";
  assunto: string;
  preheader: string;
  titulo: string;
  blocos: Bloco[];
  cta: string;
  cupom?: string;
  /**
   * O que a home do site abre já selecionado (`quotePreset` do site). Sem isto
   * a home abre no padrão dela, que é saída de imóvel: exatamente o que o
   * clube B2C não vende.
   */
  preset: string;
};

const t = (html: string): Bloco => ({ tipo: "texto", html });
const l = (titulo: string, itens: string[]): Bloco => ({ tipo: "lista", titulo, itens });

export const PECAS_DO_CLUBE: PecaDoClube[] = [
  {
    key: "meet_fixfy",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Fixfy",
    assunto: "Quick one from Victor at Fixfy",
    preheader: "Why I started Fixfy, and 10% off your first booking.",
    titulo: "Why I started Fixfy",
    blocos: [
      t("Victor here. I run Fixfy, here in London."),
      t("I started it because sorting out one home meant calling three people. Someone to clean, someone for the tap, someone for the hallway. Three quotes, three diaries, and at least one of them never turned up."),
      t("So we built one team for all of it. You pick the job online, you see the price before you pay, and someone vetted and insured turns up on the day you chose."),
      l("What people book with us most", [
        "A deep clean, from £174",
        "A handyman for half a day (£180) or a full day (£329)",
        "Painting: touch-ups from £215, a room from £450",
        "Gas Safety £79, EICR from £129, EPC from £95",
      ]),
      t("If anything isn't right, tell me within 14 days and we'll come back and fix it, free."),
      t("And your first booking is <strong>10% off</strong> with the code below."),
    ],
    cta: "Book with 10% off",
    cupom: "WELCOME10",
  },
  {
    key: "half_day_list",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "The list on your fridge",
    preheader: "It probably fits in half a day.",
    titulo: "The list on your fridge",
    blocos: [
      t("Almost every home has the same list. A shelf that never went up, a door that sticks, a tap that drips, silicone that's gone black."),
      t("One at a time, none of it gets done. All together, it's usually half a day."),
      t("Half a day with our handyman is 3.5 hours for £180, tools included. Write the list when you book and they turn up ready for it. If something needs parts, we agree it with you before buying anything."),
      t("10% off this month with <strong>HANDY10</strong>. Not sure it all fits? Reply with your list and I'll tell you."),
    ],
    cta: "Book a half day",
    cupom: "HANDY10",
  },
  {
    key: "room_450",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "Why most painted rooms look tired in a year",
    preheader: "It's the bit before the paint. One room, £450.",
    titulo: "It's all in the prep",
    blocos: [
      t("You can always tell a room that's been painted over from one that's been painted properly. The difference is the hour before anyone opens a tin."),
      t("So that's where our painters start. Furniture moved and covered, floors protected, holes filled, cracks caulked, walls sanded. Then two full coats, edges cut in by hand, and the room put back the way it was."),
      t("A room is £450. Add the paint and materials pack for £150, or pick your own colour and we'll use it."),
      t("Painting comes with 3 months' cover: if anything isn't right, we come back and sort it, free."),
    ],
    cta: "Book a room",
  },
  {
    key: "autumn_deep_clean",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Before the windows stay shut till March",
    preheader: "The autumn deep clean, 15% off this month.",
    titulo: "The clean before winter",
    blocos: [
      t("Windows shut, heating on, everyone indoors. From now on the flat gets lived in a lot harder, and the weekly clean never reaches the bits that matter."),
      t("A deep clean does. Behind and under the fridge, washer and cooker. Inside every cupboard and drawer. The limescale on the taps, screens and shower head. Skirting, frames, switches and the extractor filter nobody's touched."),
      t("Studio from £174, one bedroom from £194, products and equipment included. 15% off this month with <strong>AUTUMN15</strong>."),
    ],
    cta: "Book a deep clean",
    cupom: "AUTUMN15",
  },
  {
    key: "bathroom_refresh",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "Your bathroom probably doesn't need replacing",
    preheader: "It needs half a day. Silicone, taps, the fan.",
    titulo: "Half a day, a different bathroom",
    blocos: [
      t("Most bathrooms I see don't need ripping out. They need the small stuff that makes them look tired put right."),
      t("Old mouldy silicone cut out and redone. The dripping tap and the loose toilet seat fixed. The extractor fan cleaned or swapped. Towel rails, mirrors and cabinets put up or tightened."),
      t("That's half a day with our handyman, £180. Book a deep clean the same week and you won't recognise it."),
    ],
    cta: "Book a bathroom refresh",
  },
  {
    key: "touch_ups",
    preset: "s=paint&paint=touchup",
    etiqueta: "Painting",
    assunto: "That hallway you walk past every day",
    preheader: "Touch-ups from £215. No need to repaint the lot.",
    titulo: "Touch-ups, not a full repaint",
    blocos: [
      t("The hallway, the stairs, the door frames. The places everyone brushes past are the first to scuff, and they're what makes a home look worn."),
      t("You don't need to repaint the whole place. A touch-up visit is up to 3.5 hours, £215. Our painter fills the marks and small cracks, sands them, refreshes doors, frames and skirting, and matches the colour that's already on the wall."),
      t("No need to clear the house. They work room by room and leave it as they found it."),
    ],
    cta: "Book a touch-up",
  },
  {
    key: "gas_safety",
    preset: "s=cert&cert=gas",
    etiqueta: "Certificates",
    assunto: "When did someone last check your boiler?",
    preheader: "Gas Safety certificate, £79, before the cold kicks in.",
    titulo: "The gas check, before winter",
    blocos: [
      t("If you let a property, the gas safety check is due every 12 months. If it's your own home, it's still the easiest way to know the boiler and hob are safe before you lean on them all winter."),
      t("A Gas Safe registered engineer checks and tests every gas appliance, and the certificate lands in your inbox. £79 for one appliance, and that's the total."),
      t("Landlords: book it together with the EICR and EPC and the bundle is 10% off with <strong>LANDLORD10</strong>."),
    ],
    cta: "Book a gas check",
    cupom: "LANDLORD10",
  },
  {
    key: "after_builders",
    preset: "s=clean&size=1&kind=after",
    etiqueta: "Cleaning",
    assunto: "The builders left. The dust didn't.",
    preheader: "After builders cleaning from £204, top to bottom.",
    titulo: "The clean after the work",
    blocos: [
      t("Anyone who's had work done knows this one. The builders pack up, and the dust keeps settling for days. Inside cupboards, on top of door frames, in the window tracks."),
      t("Our after builders clean goes top to bottom. Fine dust off every surface, paint spots and plaster marks off floors and glass, inside cupboards, drawers and appliances, and the kitchen and bathrooms left ready to use."),
      t("Studio from £204, one bedroom from £227, products and equipment included."),
    ],
    cta: "Book an after builders clean",
  },
  {
    key: "hang_it_all",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "The TV still on the floor?",
    preheader: "TV, mirrors, shelves, blinds. All up in one visit.",
    titulo: "Get it all on the wall",
    blocos: [
      t("London walls are a lottery. Plasterboard, brick, old lath, sometimes all three in one room. The wrong fixing is why shelves sag and mirrors end up on the floor."),
      t("Our handyman brings the right ones. TVs on brackets with the cables tidied, mirrors and frames level, shelves, curtain poles and blinds, hooks and towel rails."),
      t("Half a day is £180 and covers most homes. Have the items and brackets ready and we'll bring the rest."),
    ],
    cta: "Book a handyman",
  },
  {
    key: "room_two_days",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "£50 off a room before the holidays",
    preheader: "Book now for November or December. Code PAINT50.",
    titulo: "One room, ready for the holidays",
    blocos: [
      t("If you've been meaning to repaint the living room or the spare room, now's the time. It changes how the whole place feels, for a fraction of new furniture."),
      t("You pick the room and the colour, or ask us to bring the paint. Our painter preps, fills and sands first, then two full coats, edges by hand, and the furniture goes back where it was."),
      t("A room is £450, and <strong>PAINT50</strong> takes £50 off any painting booking of £300 or more."),
    ],
    cta: "Book a room",
    cupom: "PAINT50",
  },
  {
    key: "clean_extras",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Five things you can add to any clean",
    preheader: "Carpets, the fridge, windows. Same visit.",
    titulo: "The extras most people miss",
    blocos: [
      t("Here's something most people don't know: any Fixfy clean can take extras on the same visit. No second company, no second booking."),
      l("The ones people add most", [
        "Carpet steam clean: £38 per room",
        "Inside the fridge and freezer: £43",
        "Windows, outside: £35",
        "Balcony, terrace or patio: £57",
      ]),
      t("Just tick them when you book your deep clean. Carpets are 10% off until March with <strong>CARPET10</strong>."),
    ],
    cta: "Build my clean",
    cupom: "CARPET10",
  },
  {
    key: "fixfy_friday",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Fixfy",
    assunto: "We don't do sales. Except this week.",
    preheader: "Fixfy Friday: 15% off everything. Book now, use it before March.",
    titulo: "Our one discount of the year",
    blocos: [
      t("I don't like constant sales. A price that changes every week was never a real price."),
      t("So once a year we do it properly. This week only, <strong>15% off any service</strong>: cleaning, repairs, painting, certificates. Book now and the work itself can be any time before March."),
      t("Most people use it on a deep clean before Christmas, the handyman list before the family arrives, or a room painted in January."),
    ],
    cta: "Use the code",
    cupom: "FIXFYFRIDAY15",
  },
  {
    key: "flat_pack",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "Bought it flat? We'll build it.",
    preheader: "Wardrobes, beds, desks. Assembled and fixed to the wall.",
    titulo: "Flat-pack, without losing a weekend",
    blocos: [
      t("The Black Friday delivery is the easy bit. Building it is the weekend nobody wants."),
      t("Our handyman does wardrobes and chests of drawers (anchored to the wall), beds, desks, tables, shelving and TV units. They'll take the old stuff apart too, so it can go."),
      t("Half a day (£180) builds most bedrooms. A full day (£329) does the whole flat."),
    ],
    cta: "Book assembly",
  },
  {
    key: "doors_and_woodwork",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "Paint the skirting, not just the walls",
    preheader: "A full day of painting, £400. Woodwork that looks new.",
    titulo: "The woodwork is what people notice",
    blocos: [
      t("Fresh walls with yellowed skirting and chipped doors still look tired. Painters notice the woodwork first, and it's what most homes skip."),
      t("In a full day (£400) our painter can do the internal doors and frames, the skirting across a floor, banisters and spindles, and the window frames on the inside. Sanded first, floors protected, ready to use when they leave."),
      t("Pick one floor, or just the hallway and stairs."),
    ],
    cta: "Book a painter",
  },
  {
    key: "festive_deep_clean",
    preset: "s=clean&size=2&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Having people over this Christmas?",
    preheader: "The last two weeks of December always go first. 10% off.",
    titulo: "Ready before everyone arrives",
    blocos: [
      t("Every year the same thing happens: the last two weeks of December fill up first. If people are coming to you, this is the week to grab a slot."),
      t("We'll get the kitchen and bathrooms deep cleaned, limescale and grease gone, the fridge emptied and ready for the big shop, carpets steamed in the living room and spare room, and every surface, switch and skirting done."),
      t("Deep clean from £174, and 10% off anything booked for December with <strong>FESTIVE10</strong>."),
    ],
    cta: "Book my slot",
    cupom: "FESTIVE10",
  },
  {
    key: "before_guests_list",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "Six things to fix before the family arrives",
    preheader: "The handle, the blind, the tap. One half day.",
    titulo: "The guest list, for the house",
    blocos: [
      t("Guests always find the small things. The handle that comes off in your hand, the blind that won't go down, the tap that drips all night."),
      l("Our pre-Christmas list", [
        "Loose handles, hinges and cupboard doors",
        "Blinds and curtain poles that have come away",
        "A dripping tap or a toilet that keeps running",
        "The wobbly table and the spare bed that needs building",
        "Tired silicone in the bathroom",
        "Hooks and rails for extra coats and towels",
      ]),
      t("All six usually fit in half a day, £180, and <strong>HANDY10</strong> takes 10% off."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    key: "spare_room",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "The spare room, before the guests",
    preheader: "£50 off with PAINT50. Last December slots.",
    titulo: "Turn the box room back into a guest room",
    blocos: [
      t("Every home has one. The room that slowly became storage. A fresh coat is what turns it back into somewhere people actually want to stay."),
      t("Walls prepped, filled and sanded, two coats in the colour you pick, woodwork touched up so it all matches, and the room left clean and ready for the bed."),
      t("A room is £450, and <strong>PAINT50</strong> takes £50 off any painting booking of £300 or more."),
    ],
    cta: "Book the spare room",
    cupom: "PAINT50",
  },
  {
    key: "eicr",
    preset: "s=cert&cert=eicr",
    etiqueta: "Certificates",
    assunto: "Before the fairy lights go up",
    preheader: "What an EICR actually checks. From £129.",
    titulo: "Know your electrics are safe",
    blocos: [
      t("An EICR is a full check of the fixed wiring in your home. Landlords need one every five years. Homeowners usually book it when they buy, after building work, or when the fuse board looks older than they are."),
      t("The electrician checks the fuse board and every circuit, sockets, switches and light fittings, earthing and bonding, and any sign of overheating or wear."),
      t("From £129 for a studio or one bedroom, with the report emailed to you."),
    ],
    cta: "Book an EICR",
  },
  {
    key: "january_list",
    preset: "s=fix&fix=day",
    etiqueta: "Repairs",
    assunto: "Get January's list booked now",
    preheader: "The first two weeks of the year go fast.",
    titulo: "The new year list",
    blocos: [
      t("January is when everyone finally does the jobs they've walked past all year. Which means the first two weeks book up early."),
      t("What people book us for: a full day to clear the whole list (£329), shelves and storage for everything Christmas brought, doors and hinges that have given up, and the bathroom silicone and small plumbing bits."),
      t("Book now, pick a date in January, and take 10% off with <strong>HANDY10</strong>."),
    ],
    cta: "Book for January",
    cupom: "HANDY10",
  },
  {
    key: "january_colour",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "January is the best month to paint",
    preheader: "More dates, no rush. £50 off with PAINT50.",
    titulo: "Pick the room for January",
    blocos: [
      t("Here's a tip: January is the quietest month for painters. More dates to choose from, nobody in a hurry. It's the best time to finally change that colour."),
      t("People usually go for the living room in something warmer for the dark months, the bedroom with the ceiling, or the hallway and stairs, walls and woodwork."),
      t("A room is £450, and <strong>PAINT50</strong> takes £50 off any painting booking of £300 or more."),
    ],
    cta: "Book a painter",
    cupom: "PAINT50",
  },
  {
    key: "quiet_week_reset",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "The week nobody books anything",
    preheader: "Our diary is free, your home isn't. 10% off.",
    titulo: "Between Christmas and New Year",
    blocos: [
      t("The week between the holidays is the one week nobody books anything. So you can have pretty much any slot you want."),
      t("It's also the week the place is at its worst. Full house, big meals, everything out of place. A deep clean now means January starts properly."),
      t("10% off with <strong>RESET10</strong>."),
    ],
    cta: "Book the reset",
    cupom: "RESET10",
  },
  {
    key: "what_broke",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "What broke over Christmas?",
    preheader: "The blind, the hinge, the toilet seat. Half a day.",
    titulo: "After the holidays",
    blocos: [
      t("A full house is hard on a home. Something always gives. The blind, a cupboard hinge, the toilet seat, the shelf the presents went on."),
      t("Our handyman puts the blinds and poles back up, sorts hinges, handles and cupboard doors, fixes toilet seats, taps and leaking traps, and touches up the scuffed walls before they get worse."),
      t("Half a day, £180, and 10% off with <strong>HANDY10</strong>."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    key: "january_reset",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Skip the gym. Sort the flat.",
    preheader: "15% off the deep clean, our biggest January discount.",
    titulo: "The January reset",
    blocos: [
      t("January is the month people actually change things. I'd rather help you with your home than sell you a gym membership."),
      t("One visit: the kitchen deep cleaned inside the cupboards and appliances, bathrooms properly descaled (tiles, grout, screens), every cupboard emptied, wiped and put back, and floors, skirting, frames and switches top to bottom."),
      t("15% off for January with <strong>JANUARY15</strong>. Our biggest discount after Fixfy Friday."),
    ],
    cta: "Book the reset",
    cupom: "JANUARY15",
  },
  {
    key: "hallway",
    preset: "s=paint&paint=touchup",
    etiqueta: "Painting",
    assunto: "The most scuffed wall in your home",
    preheader: "Hallway and stairs, refreshed in one visit.",
    titulo: "Start with the hallway",
    blocos: [
      t("It's the first thing you see when you open the front door, and the last thing anyone repaints. Bags, buggies and bikes mark it every single day."),
      t("A hallway refresh: walls filled, sanded and repainted, skirting, frames and the inside of the front door, banisters and spindles, in a hard-wearing finish that wipes clean."),
      t("A touch-up visit starts at £215, and a full day of painting is £400."),
    ],
    cta: "Book a painter",
  },
  {
    key: "landlord_bundle",
    preset: "s=cert&cert=gas,eicr,epc",
    etiqueta: "Certificates",
    assunto: "Landlords: three certificates, one booking",
    preheader: "Gas, EICR and EPC. 10% off with LANDLORD10.",
    titulo: "All three, in one go",
    blocos: [
      t("If you let a property, three certificates matter, and each one runs on its own clock. Booking them together saves the chasing."),
      l("The three", [
        "Gas Safety: every 12 months, from £79",
        "EICR: every 5 years, from £129",
        "EPC: valid 10 years, from £95",
      ]),
      t("Every certificate emailed to you, and 10% off the bundle with <strong>LANDLORD10</strong>."),
    ],
    cta: "Book the bundle",
    cupom: "LANDLORD10",
  },
  {
    key: "full_day",
    preset: "s=fix&fix=day",
    etiqueta: "Repairs",
    assunto: "When the list is too long for half a day",
    preheader: "7 hours of handyman time, £329.",
    titulo: "The full day",
    blocos: [
      t("When the list gets long, half days add up. A full day gives our handyman the time to work through the lot in one go."),
      t("A full day usually covers flat-pack, shelves and pictures across the whole home, doors eased, handles and hinges replaced, taps, toilets and silicone in the kitchen and bathroom, and small repairs to walls and woodwork."),
      t("Seven hours, £329, tools included. Parts agreed with you before we buy them, and 10% off with <strong>HANDY10</strong>."),
    ],
    cta: "Book a full day",
    cupom: "HANDY10",
  },
];

export function pecaDoClube(key: string): PecaDoClube {
  const p = PECAS_DO_CLUBE.find((x) => x.key === key);
  if (!p) throw new Error(`peça do clube "${key}" não existe`);
  return p;
}
