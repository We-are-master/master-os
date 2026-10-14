/**
 * As 26 edições do clube B2C: cada uma mostra UM serviço que a Fixfy faz.
 *
 * Decisão do dono em 14/10/2026: nada de mudança de casa (saída e entrada de
 * imóvel) para o cliente final, e nada de dica genérica de casa. O clube é a
 * vitrine: limpeza, reparos, pintura e, de vez em quando, certificados, em
 * rodízio, cada edição com um ângulo próprio.
 *
 * Só entra o que o site vende e fecha pelo link: deep clean, after builders,
 * reparos (meia diária e diária), pintura (retoque, cômodo, diária) e os três
 * certificados. Preços do site em 14/10/2026, com VAT. Garantia de volta grátis:
 * 3 dias na limpeza, 14 dias em reparos e pintura. Material de reparo é cotado
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
    assunto: "Stop calling three people to sort one home",
    preheader: "Cleaner, handyman and painter in one booking. 10% off your first job.",
    titulo: "One booking. Cleaned, fixed and painted.",
    blocos: [
      t("You know how it goes. One person to clean, another to fix the tap, a third to paint the hallway. Three quotes, three diaries, three people who may or may not turn up."),
      t("Fixfy is one team for all of it. You book online, see the price before you pay, and a vetted, insured professional turns up on the day you chose."),
      l("What you can book today", [
        "<strong>Deep cleaning</strong> from £174, products and equipment included",
        "<strong>A handyman</strong> for half a day (£180) or a full day (£329)",
        "<strong>Painting</strong>: touch-ups from £215, a full room from £450",
        "<strong>Certificates</strong>: Gas Safety £79, EICR from £129, EPC from £95",
      ]),
      t("If something is not right, we come back free of charge. And your first booking is <strong>10% off</strong> with the code below."),
    ],
    cta: "Book with 10% off",
    cupom: "WELCOME10",
  },
  {
    key: "half_day_list",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "What fits in half a day with our handyman",
    preheader: "3.5 hours, £180, and usually the whole list.",
    titulo: "The half day that clears the list",
    blocos: [
      t("Most homes have five or six small jobs waiting. One at a time they never get done. Handed over together, they usually fit in one half day."),
      l("A typical half day, 3.5 hours, £180", [
        "A shelf, a mirror and two pictures put up straight",
        "A door that sticks, eased and rehung",
        "A dripping tap and a running toilet sorted",
        "Fresh silicone around the bath or shower",
      ]),
      t("Tools are included. Any parts are agreed with you before we buy them. Write your list when you book and our handyman arrives ready for it."),
    ],
    cta: "Book a half day",
    cupom: "HANDY10",
  },
  {
    key: "room_450",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "What £450 buys you: one room, painted properly",
    preheader: "Two coats, edges cut in by hand, furniture back in place.",
    titulo: "A room, done the right way",
    blocos: [
      t("The difference between a room that looks freshly painted and one that looks painted over is all in the preparation."),
      l("What is included in a room (£450)", [
        "Furniture moved and covered, floors protected",
        "Holes filled, cracks caulked, walls sanded",
        "Two full coats on the walls, edges cut in by hand",
        "Everything put back and the room left clean",
      ]),
      t("Paint and materials can be added as a pack for £130, or you choose your own colour and we use it. If anything is not right, we come back within 14 days."),
    ],
    cta: "Book a room",
  },
  {
    key: "autumn_deep_clean",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "The autumn deep clean, 15% off this month",
    preheader: "Windows shut, heating on, and everything the weekly clean skips.",
    titulo: "The clean that gets the whole home ready",
    blocos: [
      t("From now until March the windows stay shut and the heating stays on. A deep clean resets the home for the whole winter."),
      l("What our deep clean reaches", [
        "Behind and underneath the fridge, washer and cooker",
        "Inside every cupboard and drawer",
        "Limescale on screens, taps, tiles and the shower head",
        "Skirting, door frames, switches, vents and extractor filters",
      ]),
      t("Studio from £174, one bedroom from £194, products and equipment included. This month it is 15% off."),
    ],
    cta: "Book a deep clean",
    cupom: "AUTUMN15",
  },
  {
    key: "bathroom_refresh",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "The bathroom refresh, without a new bathroom",
    preheader: "Silicone, grout, taps and the extractor. Half a day.",
    titulo: "Make the bathroom feel new again",
    blocos: [
      t("Most bathrooms do not need replacing. They need the small things that make them look tired put right."),
      l("What our handyman does in a bathroom refresh", [
        "Old, mouldy silicone cut out and replaced",
        "A dripping tap or a loose toilet seat fixed",
        "The extractor fan cleaned or replaced",
        "Towel rails, mirrors and cabinets put up or tightened",
      ]),
      t("Most bathrooms take half a day, £180. Pair it with a deep clean the same week and it will look like a different room."),
    ],
    cta: "Book a bathroom refresh",
  },
  {
    key: "touch_ups",
    preset: "s=paint&paint=touchup",
    etiqueta: "Painting",
    assunto: "The scuffs in the hallway, gone in one visit",
    preheader: "Touch-ups from £215: walls, doors and skirting.",
    titulo: "Touch-ups, without repainting everything",
    blocos: [
      t("The hallway, the stairs, the door frames. The places everyone walks past get scuffed first, and they are what makes a home look worn."),
      l("What a touch-up visit covers (up to 3.5 hours, £215)", [
        "Scuffs and marks on walls, filled and repainted",
        "Doors, frames and skirting refreshed",
        "Small cracks and nail holes filled and sanded",
        "Matched to the colour already on the wall",
      ]),
      t("No need to clear the house. Our painter works room by room and leaves everything as it was."),
    ],
    cta: "Book a touch-up",
  },
  {
    key: "gas_safety",
    preset: "s=cert&cert=gas",
    etiqueta: "Certificates",
    assunto: "Gas Safety certificate, £79",
    preheader: "A Gas Safe registered engineer, the certificate by email.",
    titulo: "The gas check, booked in two minutes",
    blocos: [
      t("If you let a property, the gas safety check is due every 12 months. If you own your home, it is still the easiest way to know your boiler and hob are safe before winter."),
      l("What you get", [
        "A Gas Safe registered engineer",
        "Every gas appliance checked and tested",
        "The certificate sent to you by email",
        "£79 for one appliance, VAT included",
      ]),
      t("Landlords: book it with the EICR and EPC and the bundle is 10% off with the code below."),
    ],
    cta: "Book a gas check",
    cupom: "LANDLORD10",
  },
  {
    key: "after_builders",
    preset: "s=clean&size=1&kind=after",
    etiqueta: "Cleaning",
    assunto: "The builders left. The dust did not.",
    preheader: "After builders cleaning from £204, top to bottom.",
    titulo: "The clean after the work",
    blocos: [
      t("Building dust gets everywhere: inside cupboards, on top of door frames, into the window tracks. It keeps settling for days after the builders leave."),
      l("What our after builders clean covers", [
        "Fine dust removed from every surface, high to low",
        "Paint spots and plaster marks taken off floors and glass",
        "Inside cupboards, drawers and appliances",
        "Bathrooms and kitchen cleaned to move-in standard",
      ]),
      t("Studio from £204, one bedroom from £227, products and equipment included."),
    ],
    cta: "Book an after builders clean",
  },
  {
    key: "hang_it_all",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "TV, mirrors, shelves, blinds: all up in one visit",
    preheader: "Level, secure and the right fixings for London walls.",
    titulo: "Hang it all, properly",
    blocos: [
      t("London walls are a mix of plasterboard, brick and old lath. The wrong fixing is why shelves sag and mirrors end up on the floor."),
      l("What our handyman puts up", [
        "TVs on wall brackets, cables tidied",
        "Mirrors, pictures and frames, level and secure",
        "Shelves, curtain poles and blinds",
        "Coat hooks, towel rails and bathroom accessories",
      ]),
      t("Half a day is £180 and covers most homes. Have the items and brackets ready and we bring the rest."),
    ],
    cta: "Book a handyman",
  },
  {
    key: "room_two_days",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "£50 off a room, painted before the holidays",
    preheader: "Book now for November or December. Code PAINT50.",
    titulo: "One room, ready for the holidays",
    blocos: [
      t("A freshly painted living room or spare room changes how the whole home feels, and it costs a fraction of new furniture."),
      l("How it works", [
        "You choose the room and the colour, or ask us to bring the paint",
        "Our painter preps, fills and sands before any paint goes on",
        "Two full coats, edges cut in by hand",
        "Furniture back in place when we finish",
      ]),
      t("A room is £450. With the code below, <strong>£50 off</strong> any painting booking of £300 or more."),
    ],
    cta: "Book a room",
    cupom: "PAINT50",
  },
  {
    key: "clean_extras",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Five things you can add to any clean",
    preheader: "Carpets, the fridge, windows and more, same visit.",
    titulo: "The extras most people do not know about",
    blocos: [
      t("Every Fixfy clean can take extras on the same visit, priced per item, so you are not booking a second company for the bits that matter."),
      l("Popular extras", [
        "Carpet steam clean: £38 per room",
        "Inside the fridge and freezer: £43",
        "Windows, outside: £35",
        "Balcony, terrace or patio: £57",
      ]),
      t("Add them when you book your deep clean. Carpets are 10% off until March with the code below."),
    ],
    cta: "Build my clean",
    cupom: "CARPET10",
  },
  {
    key: "fixfy_friday",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Fixfy",
    assunto: "Fixfy Friday: 15% off everything, this week only",
    preheader: "Cleaning, repairs, painting and certificates. Book now, use it before March.",
    titulo: "Our one big discount of the year",
    blocos: [
      t("We do not run constant sales, because a price that changes every week was never a real price. Once a year we do this properly instead."),
      t("<strong>15% off any service booked this week</strong>: cleaning, repairs, painting and certificates. Book now and the work itself can be any time before March."),
      l("Most people use it on", [
        "A deep clean before Christmas",
        "The handyman list before the family arrives",
        "A room painted in January",
      ]),
    ],
    cta: "Use the code",
    cupom: "FIXFYFRIDAY15",
  },
  {
    key: "flat_pack",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "Bought it flat. We will build it.",
    preheader: "Wardrobes, beds, desks and drawers, assembled and fixed to the wall.",
    titulo: "Flat-pack, without the lost weekend",
    blocos: [
      t("The Black Friday delivery is the easy part. Building it is the weekend nobody wants."),
      l("What our handyman assembles", [
        "Wardrobes and chests of drawers, anchored to the wall",
        "Beds, desks and dining tables",
        "Shelving units, TV units and bookcases",
        "Old furniture taken apart so it can go",
      ]),
      t("Half a day (£180) builds most bedrooms. A full day (£329) does the whole flat."),
    ],
    cta: "Book assembly",
  },
  {
    key: "doors_and_woodwork",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "Doors, frames and skirting: the fastest way to lift a home",
    preheader: "A full day of painting, £465. Woodwork that looks new.",
    titulo: "Paint the woodwork, not just the walls",
    blocos: [
      t("Yellowed skirting and chipped doors make freshly painted walls look tired. Woodwork is what painters notice first, and what most homes skip."),
      l("What our painter can do in a full day (£465)", [
        "Internal doors and frames, sanded and painted",
        "Skirting boards throughout a floor",
        "Banisters and spindles",
        "Window frames on the inside",
      ]),
      t("Pick one floor or the whole hallway and stairs. We protect the floors and leave it ready to use."),
    ],
    cta: "Book a painter",
  },
  {
    key: "festive_deep_clean",
    preset: "s=clean&size=2&kind=deep",
    etiqueta: "Cleaning",
    assunto: "House full this Christmas? 10% off the deep clean",
    preheader: "The last two weeks of December always go first.",
    titulo: "Ready before everyone arrives",
    blocos: [
      t("December slots go in order, and the last two weeks fill first every year. If people are coming to you, this is the week to book."),
      l("What we get done before the guests arrive", [
        "Kitchen and bathrooms deep cleaned, limescale and grease gone",
        "Inside the fridge, ready for the big shop",
        "Carpets steam cleaned in the living room and the spare room",
        "Every surface, switch and skirting, top to bottom",
      ]),
      t("Deep clean from £174. 10% off with the code below on anything booked for December."),
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
      t("Guests notice the small things. The handle that comes off in your hand, the blind that will not go down, the tap that drips all night."),
      l("Our pre-Christmas handyman list", [
        "Loose handles, hinges and cupboard doors",
        "Blinds and curtain poles that have come away",
        "A dripping tap or a toilet that keeps running",
        "The wobbly table and the spare bed that needs building",
        "Tired silicone in the bathroom",
        "Hooks and rails for extra coats and towels",
      ]),
      t("All six usually fit in half a day, £180, with 10% off using the code below."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    key: "spare_room",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "The spare room, painted in time for guests",
    preheader: "£50 off with PAINT50. Last December slots.",
    titulo: "Make the spare room a guest room",
    blocos: [
      t("Every home has the room that became storage. A fresh coat is what turns it back into a room people want to stay in."),
      l("What we do", [
        "Walls prepared, filled and sanded",
        "Two coats in the colour you choose",
        "Woodwork touched up so it all matches",
        "Room left clean and ready for the bed",
      ]),
      t("A room is £450, with <strong>£50 off</strong> any painting booking of £300 or more using the code below."),
    ],
    cta: "Book the spare room",
    cupom: "PAINT50",
  },
  {
    key: "eicr",
    preset: "s=cert&cert=eicr",
    etiqueta: "Certificates",
    assunto: "Before the lights go up: what an EICR checks",
    preheader: "Electrical Installation Condition Report from £129.",
    titulo: "Know your electrics are safe",
    blocos: [
      t("An EICR is a full inspection of the fixed wiring in your home. Landlords need one every five years. Homeowners book it when they buy, after building work, or when the fuse board is old."),
      l("What the electrician checks", [
        "The fuse board and every circuit",
        "Sockets, switches and light fittings",
        "Earthing and bonding",
        "Signs of overheating, damage or wear",
      ]),
      t("From £129 for a studio or one bedroom, with the report sent to you by email."),
    ],
    cta: "Book an EICR",
  },
  {
    key: "january_list",
    preset: "s=fix&fix=day",
    etiqueta: "Repairs",
    assunto: "Start January with the list already booked",
    preheader: "Book now for the first weeks of the year.",
    titulo: "The new year list",
    blocos: [
      t("January is when people finally do the jobs they have been walking past all year. The first two weeks book up early."),
      l("What people book us for in January", [
        "A full day to clear the whole list, £329",
        "New shelves and storage for the things Christmas brought",
        "Doors, handles and hinges that have given up",
        "Bathroom silicone and small plumbing jobs",
      ]),
      t("Book now and pick a date in January."),
    ],
    cta: "Book for January",
    cupom: "HANDY10",
  },
  {
    key: "january_colour",
    preset: "s=paint&paint=rooms:1",
    etiqueta: "Painting",
    assunto: "New year, new colour: book your room for January",
    preheader: "£50 off with PAINT50. January slots open now.",
    titulo: "Pick the room for January",
    blocos: [
      t("January is the quietest month for painters, which means more choice of dates and no rush. It is the best month to finally change that colour."),
      l("Ideas people book", [
        "The living room, in a warmer colour for the dark months",
        "The bedroom, walls and ceiling",
        "The hallway and stairs, walls and woodwork",
      ]),
      t("A room is £450. <strong>£50 off</strong> any painting booking of £300 or more with the code below."),
    ],
    cta: "Book a painter",
    cupom: "PAINT50",
  },
  {
    key: "quiet_week_reset",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "The quiet week reset, 10% off",
    preheader: "Our diary is free, your home is not. Good timing for both of us.",
    titulo: "Between Christmas and the new year",
    blocos: [
      t("The week between the holidays is the one week nobody books anything, which means you can have almost any slot you want."),
      t("It is also the week the home is at its worst: full house, big meals and everything out of place. A deep clean that week starts January properly."),
    ],
    cta: "Book the reset",
    cupom: "RESET10",
  },
  {
    key: "what_broke",
    preset: "s=fix&fix=half",
    etiqueta: "Repairs",
    assunto: "Whatever broke over Christmas, we can fix",
    preheader: "The blind, the hinge, the toilet seat. Half a day.",
    titulo: "After the holidays",
    blocos: [
      t("A full house is hard on a home. Something always gives: a blind, a cupboard hinge, the toilet seat, the shelf the presents went on."),
      l("Common January fixes", [
        "Blinds and curtain poles back up",
        "Hinges, handles and cupboard doors",
        "Toilet seats, taps and leaking traps",
        "Scuffed walls touched up before they get worse",
      ]),
      t("Half a day, £180, with 10% off using the code below."),
    ],
    cta: "Book a handyman",
    cupom: "HANDY10",
  },
  {
    key: "january_reset",
    preset: "s=clean&size=1&kind=deep",
    etiqueta: "Cleaning",
    assunto: "Start the year with the home sorted: 15% off",
    preheader: "Our biggest January discount, on the deep clean.",
    titulo: "The January reset",
    blocos: [
      t("January is the month people actually change things. We would rather help with the home than sell you a gym membership."),
      l("The reset, in one visit", [
        "Kitchen deep cleaned, inside the cupboards and appliances",
        "Bathrooms descaled properly: tiles, grout and screens",
        "Every cupboard emptied, wiped and put back",
        "Floors, skirting, frames and switches, top to bottom",
      ]),
      t("15% off for January, our largest discount apart from Fixfy Friday."),
    ],
    cta: "Book the reset",
    cupom: "JANUARY15",
  },
  {
    key: "hallway",
    preset: "s=paint&paint=touchup",
    etiqueta: "Painting",
    assunto: "The most scuffed wall in every home",
    preheader: "Hallway and stairs, refreshed in one visit.",
    titulo: "Start with the hallway",
    blocos: [
      t("It is the first thing you see when you open the door and the last thing anyone repaints. Bags, buggies and bikes mark it every day."),
      l("A hallway refresh", [
        "Walls filled, sanded and repainted",
        "Skirting, frames and the front door on the inside",
        "Banisters and stair spindles",
        "A hard-wearing finish that wipes clean",
      ]),
      t("A touch-up visit starts at £215, a full day of painting is £465."),
    ],
    cta: "Book a painter",
  },
  {
    key: "landlord_bundle",
    preset: "s=cert&cert=gas,eicr,epc",
    etiqueta: "Certificates",
    assunto: "Landlords: gas, EICR and EPC in one booking",
    preheader: "10% off the bundle with LANDLORD10.",
    titulo: "All three certificates, one booking",
    blocos: [
      t("If you let a property, three certificates matter and each runs on its own clock. Booking them together saves the chasing."),
      l("The three", [
        "Gas Safety: every 12 months, from £79",
        "EICR: every 5 years, from £129",
        "EPC: valid 10 years, from £95",
      ]),
      t("Every certificate sent to you by email. 10% off when you book the bundle with the code below."),
    ],
    cta: "Book the bundle",
    cupom: "LANDLORD10",
  },
  {
    key: "full_day",
    preset: "s=fix&fix=day",
    etiqueta: "Repairs",
    assunto: "One full day, the whole list done",
    preheader: "7 hours of handyman time for £329.",
    titulo: "The full day",
    blocos: [
      t("When the list is long, half days add up. A full day gives our handyman the time to work through everything in one go."),
      l("What a full day often covers", [
        "Flat-pack, shelves and pictures across the whole home",
        "Doors eased, handles and hinges replaced",
        "Taps, toilets and silicone in the bathroom and kitchen",
        "Small repairs to walls and woodwork",
      ]),
      t("Seven hours, £329, tools included. Parts are agreed with you before we buy them."),
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
