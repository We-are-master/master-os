#!/usr/bin/env python3
"""Fixfy-branded materials list (links, quantities, no prices) using the repo's PDF layout constants."""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, KeepTogether)
from reportlab.lib.utils import ImageReader

OUT = "/home/user/master-os/quotes/Fixfy-Bathroom-Materials-List.pdf"
LOGO_WHITE = "/home/user/master-os/public/logos/fixfy-wordmark-white-trim.png"

# fixfy-pdf-layout.tsx constants
PAD_H = 48
PAGE_GAP = 28
FOOTER_H = 72
LOGO_W, LOGO_H = 132, 40
NAVY = colors.HexColor("#020040")
ORANGE = colors.HexColor("#ED4B00")
INK = colors.HexColor("#1A1A1A")
SLATE = colors.HexColor("#4A4A55")
LABEL = colors.HexColor("#6B6E7B")
MUTED = colors.HexColor("#9A9AA8")
CARD_BG = colors.HexColor("#F7F7FA")
LAVENDER = colors.HexColor("#F2F0FA")
BORDER = colors.HexColor("#E8E8EE")
HAIRLINE = colors.HexColor("#F2F0FA")
ORANGE_TINT = colors.HexColor("#FFF1EA")
FOOTER_INFO = colors.HexColor("#AAAAD0")
HEADER_H = 14 + LOGO_H + 14
ORANGE_BAR = 4

W, H = A4

# ---------- styles ----------
eyebrow = ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=ORANGE,
                         spaceAfter=6)
headline = ParagraphStyle("headline", fontName="Helvetica-Bold", fontSize=19, leading=24, textColor=NAVY,
                          spaceAfter=8)
intro = ParagraphStyle("intro", fontName="Helvetica", fontSize=10, leading=15.5, textColor=SLATE)
section = ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=NAVY,
                         spaceAfter=8)
th = ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=LABEL)
td = ParagraphStyle("td", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
td_num = ParagraphStyle("tdnum", parent=td, textColor=MUTED, fontName="Helvetica-Bold", fontSize=8.5)
td_sub = ParagraphStyle("tdsub", fontName="Helvetica", fontSize=8, leading=11, textColor=MUTED)
td_qty = ParagraphStyle("tdqty", parent=td, fontName="Helvetica-Bold", textColor=NAVY, alignment=TA_CENTER)
ref_label = ParagraphStyle("reflabel", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=LABEL)
ref_value = ParagraphStyle("refvalue", fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=NAVY,
                           alignment=2)
ref_value_n = ParagraphStyle("refvaluen", parent=ref_value, fontName="Helvetica", fontSize=10)
note_title = ParagraphStyle("notetitle", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=ORANGE,
                            spaceAfter=4)
note_text = ParagraphStyle("notetext", fontName="Helvetica", fontSize=9.5, leading=14, textColor=NAVY)
help_title = ParagraphStyle("helptitle", fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=NAVY,
                            spaceAfter=3)
help_text = ParagraphStyle("helptext", fontName="Helvetica", fontSize=9, leading=13, textColor=SLATE)
footer_style = ParagraphStyle("footer", fontName="Helvetica", fontSize=7.5, leading=11, textColor=FOOTER_INFO,
                              alignment=TA_CENTER)


def sp(text, letter=0):
    return text


def link(label, url):
    return f'<a href="{url}" color="#020040"><u>{label}</u></a>'


# ---------- content ----------
FIXTURES = [
    ("Thermostatic bar mixer shower, hot/cold, with fixed head and handset, chrome",
     "Cruze Modern Round Thermostatic Bar Shower Valve + Riser Kit", "Victorian Plumbing",
     "https://victorianplumbing.co.uk/modern-round-thermostatic-bar-shower-valve-riser-kit-chrome", 1),
    ("Shower tray, cut to size 1000 x 600 mm (recess is max. 630 mm wide)",
     "Tissino Giorgio2 cut-to-size slate-effect tray 1200 x 800, white", "Bathroom City",
     "https://bathroomcity.co.uk/product/giorgio-rectangle-shower-tray-1200-white-slate", 1),
    ("Sliding shower door 1000 mm, 6 mm glass, chrome, for recess",
     "Orchard Chrome 1000 x 1850 mm Sliding Shower Door", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/orchard-chrome-1000-x-1850-mm-sliding-shower-door", 1),
    ("Basin with vanity unit, 600 mm, gloss white, floor-standing",
     "Toreno 600 mm High Gloss White Basin Unit", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/bathroom-furniture/vanity-units/600-vanity-units", 1),
    ("Basin mixer tap, hot/cold, with click-clack waste, chrome",
     "Vado Matrix Mono Basin Mixer with waste", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/vado-matrix-mono-basin-mixer-universal-basin-waste", 1),
    ("Basin bottle trap 32 mm (waste connection)",
     "McAlpine 32 mm Shallow Basin Bottle Trap E10", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/mcalpine-32mm-shallow-basin-bottle-trap-e10", 1),
    ("Mirror cabinet 600 mm, gloss white, 2 doors",
     "Brooklyn 600 mm Gloss White Mirror Cabinet", "Victorian Plumbing",
     "https://victorianplumbing.co.uk/brooklyn-600mm-gloss-white-bathroom-mirror-cabinet-2-door?sku=B6GWM", 1),
    ("Heated towel rail radiator 1200 x 500 mm, chrome",
     "The Heating Co 1200 x 500 mm Chrome Heated Towel Rail", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/the-heating-co-1200-x-500-mm-chrome-heated-towel-rail", 1),
    ("Radiator valves, angled, chrome (pair)",
     "The Heating Co Round Angled Radiator Valves", "Victorian Plumbing",
     "https://www.victorianplumbing.co.uk/the-heating-co-round-angled-radiator-valves-chrome", 1),
    ("Shower waste 90 mm high flow, chrome (if the tray's own waste is not used)",
     "90 mm High Flow Chrome Shower Waste with flexible pipe", "Victorian Plumbing",
     "https://victorianplumbing.co.uk/90mm-high-flow-chrome-shower-waste-with-extendable-flexible-waste-pipe", 1),
    ("Extractor fan 100 mm with timer, quiet (27 dB)",
     "Manrose QF100T Quiet Fan 100 mm with timer", "B&Q",
     "https://www.diy.com/departments/manrose-qf100t-extractor-fan-dia-100mm/630896_BQ.prd", 1),
    ("Extractor fan ducting kit 100 mm (3 m flexible duct, external grille, clips)",
     "Sensio Aquilo 100 mm Ducting Kit", "Screwfix",
     "https://www.screwfix.com/p/sensio-aquilo-ducting-kit-for-ventilation-fans-100mm/883lc", 1),
]

MATERIALS = [
    ("Sanitary silicone, white, anti-mould, 310 ml", "No Nonsense White Sanitary Silicone", "B&Q",
     "https://www.diy.com/departments/no-nonsense-white-silicone-based-sanitary-sealant-310ml/36229_BQ.prd", 2),
    ("15 mm push-fit elbow, hot and cold", "Flomasta 90° Push-fit Elbow 15 mm", "B&Q",
     "https://www.diy.com/departments/flomasta-90-pipe-elbow-dia-15mm/3663602477372_BQ.prd", 8),
    ("15 mm push-fit straight coupling", "JG Speedfit Coupling 15 mm", "B&Q",
     "https://www.diy.com/departments/john-guest-speedfit-coupling-15mm/5055003858405_BQ.prd", 4),
    ("15 mm push-fit equal tee", "Flomasta Push-fit Tee 15 mm", "B&Q",
     "https://www.diy.com/departments/flomasta-white-equal-pipe-tee-dia-15mm-x-15mm-x-15mm/3663602477549_BQ.prd", 2),
    ("Flexible tap connectors 15 mm x 300 mm (pack of 2)", "Hep2O Flexi Tap Connector 15 x 300 mm", "Wickes",
     "https://www.wickes.co.uk/Hep2O-HD125A-15W-Flexi-Tap-Connector---15-x-300mm---Pack-of-2/p/149156", 1),
    ("15 mm isolating valves (pack of 2)", "Flomasta Isolating Valve 15 mm, 2-pack", "Screwfix",
     "https://www.screwfix.com/p/flomasta-isolating-valve-15mm-2-pack/65251", 2),
    ("15 mm barrier pipe, 3 m length", "JG Speedfit PEX Barrier Pipe 15 mm x 3 m", "Wickes",
     "https://www.wickes.co.uk/JG-Speedfit-15BPEX-10X3L-PEX-Pipe---15mm-x-3m/p/117407", 4),
    ("WC pan connector 110 mm, straight", "Wirquin Push-fit Pan Connector 110 mm", "B&Q",
     "https://www.diy.com/departments/wirquin-push-fit-pan-connector-dia-110mm/1502088_BQ.prd", 1),
    ("Soil pipe 110 mm x 3 m, black", "FloPlast Ring Seal Soil Pipe 110 mm x 3 m", "B&Q",
     "https://www.diy.com/departments/floplast-ring-seal-soil-black-single-socket-soil-pipe-dia-110mm-l-3000mm/80963_BQ.prd", 1),
    ("Soil bend 110 mm 90°", "FloPlast Solvent Weld 90° Soil Bend 110 mm", "Screwfix",
     "https://www.screwfix.com/p/floplast-solvent-weld-90-single-socket-soil-bend-black-110mm/115en", 1),
    ("Soil coupling 110 mm, double socket", "FloPlast 110 mm Double Socket Coupling", "Wickes",
     "https://www.wickes.co.uk/FloPlast-110mm-Black-Double-Socket-Coupling/p/435224", 1),
    ("Solvent cement 250 ml (soil and waste pipe)", "FloPlast SC250 Solvent Cement 250 ml", "Wickes",
     "https://www.wickes.co.uk/FloPlast-SC250-Solvent-Cement---250ml/p/175692", 1),
    ("Waste pipe 40 mm x 3 m, white (shower and basin)", "FloPlast Solvent Weld Waste Pipe 40 mm x 3 m", "B&Q",
     "https://www.diy.com/departments/floplast-abs-solvent-weld-waste-pipe-dia40mm-white/109192_BQ.prd", 2),
    ("Waste bend 40 mm 87.5°", "FloPlast Solvent Weld Bend 40 mm", "B&Q",
     "https://www.diy.com/departments/floplast-white-solvent-weld-87-5-waste-pipe-bend-dia-40mm/152678_BQ.prd", 4),
    ("Waste tee 40 mm", "FloPlast Solvent Weld Tee 40 mm", "B&Q",
     "https://www.diy.com/departments/white-solvent-weld-87-5-waste-pipe-tee-dia-40mm/262327_BQ.prd", 1),
    ("Waste reducer 40 x 32 mm", "FloPlast WS38W Reducer 40 x 32 mm", "Wickes",
     "https://www.wickes.co.uk/FloPlast-WS38W-White-Solvent-Weld-Waste-Reducer---40-x-32mm/p/175694", 1),
    ("Waste pipe 32 mm x 3 m (basin)", "FloPlast WS01W Waste Pipe 32 mm x 3 m", "Wickes",
     "https://www.wickes.co.uk/FloPlast-WS01W-Solvent-Weld-Waste-Pipe---White-32mm-x-3m/p/431981", 1),
    ("CLS timber 38 x 63 mm x 2.4 m (shower recess frame)", "C16 CLS Timber 38 x 63 mm x 2.4 m", "B&Q",
     "https://www.diy.com/departments/essentials-smooth-planed-c16-whitewood-spruce-cls-timber-l-2-4m-w-63mm-t-38mm/1798294_BQ.prd", 9),
    ("Chipboard flooring P5 T&G 18 mm, 2400 x 600 mm (finish the floor)", "Chipboard Tongue & Groove Floorboard 18 mm", "B&Q",
     "https://www.diy.com/departments/chipboard-tongue-groove-floorboard-l-2-4m-w-600mm-t-18mm/1696267_BQ.prd", 3),
    ("Plywood 12 mm, 2440 x 1220 mm (close the shower recess)", "Hardwood Plywood 12 mm 2440 x 1220", "B&Q",
     "https://www.diy.com/departments/hardwood-plywood-l-2440mm-w-1220mm-t-12mm/1696275_BQ.prd", 2),
    ("MDF 12 mm (1/2\"), 2440 x 1220 mm", "MDF 12 mm 2440 x 1220", "Beesley & Fildes",
     "https://www.beesleyandfildes.co.uk", 1),
    ("Wood screws 4 x 40 mm, box of 500", "TurboDrive PZ Wood Screw 4 x 40 mm", "B&Q",
     "https://www.diy.com/departments/turbodrive-pozidriv-yellow-passivated-steel-screw-dia-4mm-l-40mm-pack-of-500/3663602746942_BQ.prd", 1),
    ("Wood screws 4 x 60 mm, box of 100", "TurboDrive PZ Wood Screw 4 x 60 mm", "B&Q",
     "https://www.diy.com/departments/turbodrive-pz-double-countersunk-yellow-passivated-steel-wood-screw-dia-4mm-l-60mm-pack-of-100/3663602747161_BQ.prd", 1),
    ("Plasterboard screws 3.5 x 38 mm, box of 1000", "Easydrive Plasterboard Screw 3.5 x 38 mm", "B&Q",
     "https://www.diy.com/departments/easydrive-bright-zinc-plated-plasterboard-screw-dia-3-5mm-l-38mm-pack-of-1000/28498_BQ.prd", 1),
]


def esc(s):
    return s.replace("&", "&amp;")


def items_table(rows, start):
    content_w = W - 2 * PAD_H
    col_w = [34, content_w - 34 - 190 - 40, 190, 40]
    data = [[Paragraph("#", th), Paragraph("ITEM", th), Paragraph("PRODUCT (TAP TO OPEN)", th),
             Paragraph("QTY", ParagraphStyle("thc", parent=th, alignment=TA_CENTER))]]
    for i, (item, product, shop, url, qty) in enumerate(rows, start):
        prod = Paragraph(link(esc(product), url) + f'<br/><font size="8" color="#9A9AA8">{esc(shop)}</font>', td)
        data.append([Paragraph(str(i), td_num), Paragraph(esc(item), td), prod, Paragraph(str(qty), td_qty)])
    t = Table(data, colWidths=col_w, repeatRows=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 1, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), CARD_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 1, BORDER),
        ("TOPPADDING", (0, 0), (-1, 0), 8), ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 1), (-1, -1), 8), ("BOTTOMPADDING", (0, 1), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (0, -1), 8), ("RIGHTPADDING", (0, 0), (0, -1), 2),
    ]
    for r in range(2, len(data)):
        style.append(("LINEABOVE", (0, r), (-1, r), 1, HAIRLINE))
    t.setStyle(TableStyle(style))
    return t


def card(flowables, bg, left_bar=None, pad=(12, 16)):
    t = Table([[flowables]], colWidths=[W - 2 * PAD_H])
    st = [("BACKGROUND", (0, 0), (-1, -1), bg),
          ("TOPPADDING", (0, 0), (-1, -1), pad[0]), ("BOTTOMPADDING", (0, 0), (-1, -1), pad[0]),
          ("LEFTPADDING", (0, 0), (-1, -1), pad[1]), ("RIGHTPADDING", (0, 0), (-1, -1), pad[1])]
    if left_bar:
        st.append(("LINEBEFORE", (0, 0), (0, -1), 3, left_bar))
    t.setStyle(TableStyle(st))
    return t


def ref_bar():
    rows = [[Paragraph("DATE", ref_label), Paragraph("11 October 2026", ref_value)],
            [Paragraph("PROJECT", ref_label), Paragraph("Bathroom refit, London", ref_value_n)],
            [Paragraph("PREPARED BY", ref_label), Paragraph("Fixfy", ref_value_n)]]
    t = Table(rows, colWidths=[120, W - 2 * PAD_H - 120 - 32])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return card([t], LAVENDER, pad=(8, 16))


# ---------- page furniture ----------
logo = ImageReader(LOGO_WHITE)
lw, lh = logo.getSize()


def draw_logo(c, x, y, box_w, box_h):
    scale = min(box_w / lw, box_h / lh)
    w, h = lw * scale, lh * scale
    c.drawImage(logo, x, y + (box_h - h) / 2, width=w, height=h, mask="auto")


def on_page(c, doc):
    c.saveState()
    # header
    c.setFillColor(NAVY)
    c.rect(0, H - HEADER_H, W, HEADER_H, stroke=0, fill=1)
    draw_logo(c, PAD_H, H - HEADER_H + 14, LOGO_W, LOGO_H)
    c.setFillColor(ORANGE)
    c.rect(0, H - HEADER_H - ORANGE_BAR, W, ORANGE_BAR, stroke=0, fill=1)
    # footer
    c.setFillColor(NAVY)
    c.rect(0, 0, W, FOOTER_H, stroke=0, fill=1)
    draw_logo(c, (W - 68) / 2, FOOTER_H - 14 - 18, 68, 18)
    c.setFillColor(FOOTER_INFO)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(W / 2, 24, "Getfixfy Ltd · Co. No. 15406523 · VAT No. 478 1027 82 · 124 City Road, London EC1V 2NX, United Kingdom")
    c.drawCentredString(W / 2, 13, "getfixfy.com · support@getfixfy.com · 020 4538 4668")
    c.setFillColor(FOOTER_INFO)
    c.drawRightString(W - PAD_H, 13, f"Page {doc.page}")
    c.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=PAD_H, rightMargin=PAD_H,
                      topMargin=HEADER_H + ORANGE_BAR + PAGE_GAP, bottomMargin=FOOTER_H + PAGE_GAP,
                      title="Bathroom Refit – Materials List", author="Fixfy (Getfixfy Ltd)",
                      subject="Materials list with product links")
frame = Frame(doc.leftMargin, doc.bottomMargin, W - 2 * PAD_H, H - doc.topMargin - doc.bottomMargin,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="fixfy", frames=[frame], onPage=on_page)])

story = []
story += [Paragraph("M A T E R I A L S &nbsp;L I S T", eyebrow),
          Paragraph("Your bathroom refit, item by item", headline),
          Paragraph("Here is the full list of materials for your bathroom: WC connections, basin with vanity unit, "
                    "shower recess 0.63 m x 1.00–1.10 m, heated towel rail and extractor fan. Each line links to the "
                    "product page so you can see exactly what will be fitted. Quantities are shown; "
                    "pricing is in your separate quote.", intro),
          Spacer(1, 16), ref_bar(), Spacer(1, 14)]

story += [Paragraph("F I X T U R E S &nbsp;A N D &nbsp;F I T T I N G S", section),
          items_table(FIXTURES, 1), Spacer(1, 14)]
story += [Paragraph("B U I L D I N G &nbsp;A N D &nbsp;P L U M B I N G &nbsp;M A T E R I A L S", section),
          items_table(MATERIALS, 13), Spacer(1, 14)]

story += [KeepTogether([
    card([Paragraph("S H O W E R &nbsp;T R A Y", note_title),
          Paragraph("The shower recess is 630 mm wide at most, and no standard tray is narrower than 700 mm. "
                    "Item 2 is therefore cut to size (1000 x 600 mm). If the recess can be built 70 mm wider "
                    "during the works, a standard 1000 x 700 mm tray fits instead and costs considerably less. "
                    "We will confirm this with you on site before ordering.", note_text)],
         ORANGE_TINT, left_bar=ORANGE, pad=(10, 14)),
    Spacer(1, 14),
    Paragraph("N O T E S", section),
    card([Paragraph("• The sliding door adjusts between 950 and 990 mm, so the recess opening will be built to that width. "
                    "No side panel is needed because the recess is closed with the plywood wall.<br/>"
                    "• Products are from Victorian Plumbing, B&amp;Q, Screwfix and Wickes. If an item is out of stock "
                    "on the day, we will replace it with an equivalent of the same or better specification and let you know.<br/>"
                    "• Not included in this list: WC, tiles, tile adhesive and grout, and paint.", help_text)],
         CARD_BG, pad=(12, 16)),
    Spacer(1, 10),
    card([Paragraph("Questions about this list?", help_title),
          Paragraph('Reply to the message this list was sent with, or contact us at '
                    '<font name="Helvetica-Bold" color="#020040">support@getfixfy.com</font> &nbsp;·&nbsp; '
                    '<font name="Helvetica-Bold" color="#020040">020 4538 4668</font>', help_text)],
         LAVENDER, pad=(10, 14)),
])]

doc.build(story)
print("ok", OUT)
