#!/usr/bin/env python3
"""Generate Le Arabia Restaurant Business Intelligence Dossier PDF."""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)

OUTPUT_PATH = "/Users/nihaf/Documents/Tech/HN-Hotels-Site/Shamshi_Research_Data.pdf"

# ── Colors ─────────────────────────────────────────────────────────
DARK = colors.HexColor("#1a1a2e")
ACCENT = colors.HexColor("#16213e")
HEADER_BG = colors.HexColor("#0f3460")
ROW_ALT = colors.HexColor("#f0f4f8")
NEW_BADGE = colors.HexColor("#e74c3c")
ACTIVE_GREEN = colors.HexColor("#27ae60")
INACTIVE_RED = colors.HexColor("#c0392b")
SECTION_BG = colors.HexColor("#1a1a2e")
LIGHT_BORDER = colors.HexColor("#bdc3c7")


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        "DocTitle", parent=styles["Title"],
        fontSize=20, textColor=colors.white, alignment=TA_CENTER,
        spaceAfter=6, fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "DocSubtitle", parent=styles["Normal"],
        fontSize=10, textColor=colors.HexColor("#cccccc"), alignment=TA_CENTER,
        spaceAfter=12, fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "SectionHead", parent=styles["Heading1"],
        fontSize=13, textColor=colors.white, fontName="Helvetica-Bold",
        spaceBefore=16, spaceAfter=8, leftIndent=6,
        backColor=SECTION_BG, borderPadding=(4, 6, 4, 6)
    ))
    styles.add(ParagraphStyle(
        "SubHead", parent=styles["Heading2"],
        fontSize=11, textColor=DARK, fontName="Helvetica-Bold",
        spaceBefore=10, spaceAfter=4
    ))
    styles.add(ParagraphStyle(
        "CellText", parent=styles["Normal"],
        fontSize=7, leading=9, fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "CellBold", parent=styles["Normal"],
        fontSize=7, leading=9, fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "CellSmall", parent=styles["Normal"],
        fontSize=6.5, leading=8, fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "BodyText2", parent=styles["Normal"],
        fontSize=9, leading=12, fontName="Helvetica", alignment=TA_JUSTIFY
    ))
    styles.add(ParagraphStyle(
        "Note", parent=styles["Normal"],
        fontSize=8, leading=10, fontName="Helvetica-Oblique",
        textColor=colors.HexColor("#555555")
    ))
    styles.add(ParagraphStyle(
        "NewBadge", parent=styles["Normal"],
        fontSize=6.5, leading=8, fontName="Helvetica-Bold",
        textColor=colors.white, backColor=NEW_BADGE
    ))
    return styles


def make_header_cell(text, styles):
    return Paragraph(f"<b>{text}</b>", ParagraphStyle(
        "HeaderCell", parent=styles["CellText"],
        textColor=colors.white, fontName="Helvetica-Bold", fontSize=7
    ))


def make_cell(text, styles, bold=False):
    style = styles["CellBold"] if bold else styles["CellText"]
    return Paragraph(str(text), style)


def make_small_cell(text, styles):
    return Paragraph(str(text), styles["CellSmall"])


def std_table_style(has_header=True):
    base = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGHT_BORDER),
    ]
    if has_header:
        base += [
            ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ]
    # Alternating rows
    return base


def add_alt_rows(style_cmds, data, start_row=1):
    for i in range(start_row, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    return style_cmds


def section_header(text, styles):
    """Create a colored section header bar."""
    t = Table(
        [[Paragraph(text, styles["SectionHead"])]],
        colWidths=[525]
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def build_pdf():
    styles = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT_PATH, pagesize=A4,
        leftMargin=35, rightMargin=35,
        topMargin=40, bottomMargin=40
    )
    story = []
    W = 525  # usable width

    # ── TITLE BLOCK ───────────────────────────────────────────────
    title_table = Table(
        [
            [Paragraph("LE ARABIA RESTAURANT", styles["DocTitle"])],
            [Paragraph("Business Intelligence Dossier", styles["DocSubtitle"])],
            [Paragraph("Report Date: 2 April 2026  |  Classification: CONFIDENTIAL", styles["DocSubtitle"])],
        ],
        colWidths=[W]
    )
    title_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("TOPPADDING", (0, 0), (-1, 0), 20),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 14),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(title_table)
    story.append(Spacer(1, 14))

    # ── SECTION 1: SUBJECT PROFILE ────────────────────────────────
    story.append(section_header("1. SUBJECT PROFILE", styles))
    story.append(Spacer(1, 6))

    profile_data = [
        ["Full Name", "Mohammad Samshuddin (alt spelling: Shamsuddin; goes by \"Shamz Mohd\")"],
        ["Name on FSSAI", "MOHAMMAD SAMSHUDDIN (confirmed via FoSCoS license lookup)"],
        ["Father's Name", "S/o Aboobakkar"],
        ["Age", "41 years (as of March 2024)"],
        ["Aadhaar Number", "8046 6249 2675"],
        ["Phone", "8891111174 / 88911 11174"],
        ["Wife / Family", "Naznin Niyaf (PAN: BQRPN9730L)"],
        ["Permanent Address", "No. 1-199, Soudath Manzil, Koila, Bantwal, Koila P.O., Dakshina Kannada, Karnataka - 574211"],
        ["Current Address", "Flat No. 1403, Aparna Elina Apartments, Near Yeswanthpur Railway Station, Tumkur Road, Bangalore - 560022"],
        ["Known Email", "info@learabia.in (generic; domain expired) — Personal email NOT YET OBTAINED"],
        ["Domain (expired)", "learabia.in (EXPIRED - available for registration)"],
        ["Domain (Instagram)", "learabiarestaurant.com (parked/squatted domain, NOT the real site)"],
        ["Facebook", "facebook.com/learabiabengaluru"],
        ["Instagram", "@learabia.restaurant (10.1K followers, 318 posts)"],
    ]
    profile_rows = [[make_cell(r[0], styles, bold=True), make_cell(r[1], styles)] for r in profile_data]
    t = Table(profile_rows, colWidths=[120, W - 120])
    ts = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGHT_BORDER),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<i>Source: Deed of Settlement dated 14 March 2024 (Karnataka Govt e-stamp), GST records, Zomato/Swiggy listings.</i>",
        styles["Note"]
    ))

    story.append(PageBreak())

    # ── SECTION 2: GST REGISTRATIONS ──────────────────────────────
    story.append(section_header("2. GST REGISTRATIONS", styles))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Confirmed Le Arabia Registrations (5)</b>", styles["SubHead"]))

    gst_header = [
        make_header_cell("GSTIN", styles),
        make_header_cell("PAN", styles),
        make_header_cell("State", styles),
        make_header_cell("Business Name", styles),
        make_header_cell("Type", styles),
        make_header_cell("Reg Date", styles),
        make_header_cell("Status", styles),
        make_header_cell("Address", styles),
    ]

    def status_cell(text, styles):
        color = "#27ae60" if "Active" in text else "#c0392b"
        return Paragraph(f'<font color="{color}"><b>{text}</b></font>', styles["CellText"])

    def new_tag(text, is_new, styles):
        tag = ' <font color="#e74c3c"><b>[NEW]</b></font>' if is_new else ""
        return Paragraph(f"{text}{tag}", styles["CellText"])

    gst_rows = [
        [
            make_small_cell("29AAHFL8416C1ZA", styles),
            make_small_cell("AAHFL8416C", styles),
            make_cell("Karnataka", styles),
            make_cell("LE ARABIA RESTAURANT", styles, bold=True),
            make_cell("Partnership", styles),
            make_cell("2018-11-20", styles),
            status_cell("CANCELLED suo-moto 26/12/2019", styles),
            make_small_cell("No. 15, Bannerghatta Rd, JP Nagar 3rd Phase, 560076", styles),
        ],
        [
            make_small_cell("29AAJFL0868L1ZP", styles),
            make_small_cell("AAJFL0868L", styles),
            make_cell("Karnataka", styles),
            new_tag("LE ARABIA RESTAURANT", True, styles),
            make_cell("Partnership", styles),
            make_cell("2021-12-16", styles),
            status_cell("Active", styles),
            make_small_cell("5th Block No. 60, 60ft Rd, Koramangala, 560034", styles),
        ],
        [
            make_small_cell("32BQRPN9730L1Z6", styles),
            make_small_cell("BQRPN9730L", styles),
            make_cell("Kerala", styles),
            make_cell("LE ARABIA RESTAURANT (Naznin Niyaf)", styles),
            make_cell("Proprietorship", styles),
            make_cell("2020-10-07", styles),
            status_cell("INACTIVE", styles),
            make_small_cell("Kazhakuttom TC I/3852, Trivandrum, 695582", styles),
        ],
        [
            make_small_cell("32AAIFL0411G1ZZ", styles),
            make_small_cell("AAIFL0411G", styles),
            make_cell("Kerala", styles),
            new_tag("LE ARABIA RESTAURANT", True, styles),
            make_cell("Partnership", styles),
            make_cell("2019-08-01", styles),
            status_cell("Active", styles),
            make_small_cell("Zum Zum Towers, Vandipetta Jn, Bilathikulam, Calicut 673011", styles),
        ],
        [
            make_small_cell("32ABIFR8802J1Z1", styles),
            make_small_cell("ABIFR8802J", styles),
            make_cell("Kerala", styles),
            new_tag("M/s ROYAL LE ARABIA", True, styles),
            make_cell("Partnership", styles),
            make_cell("2024-04-30", styles),
            status_cell("Active", styles),
            make_small_cell("TC 1/3852-1, Kazhakuttom Rd, TVM, 695582", styles),
        ],
    ]

    gst_data = [gst_header] + gst_rows
    col_w = [78, 58, 42, 80, 46, 46, 38, 137]
    t = Table(gst_data, colWidths=col_w, repeatRows=1)
    ts = std_table_style()
    ts = add_alt_rows(ts, gst_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 10))

    # Possibly unrelated
    story.append(Paragraph("<b>Possibly Unrelated</b>", styles["SubHead"]))
    unrel_data = [
        [
            make_header_cell("GSTIN", styles),
            make_header_cell("PAN", styles),
            make_header_cell("State", styles),
            make_header_cell("Business Name", styles),
            make_header_cell("Type", styles),
            make_header_cell("Address", styles),
            make_header_cell("Note", styles),
        ],
        [
            make_small_cell("33BPRPS8052R1ZS", styles),
            make_small_cell("BPRPS8052R", styles),
            make_cell("Tamil Nadu", styles),
            make_cell("HOTEL LE ARABIA", styles),
            make_cell("Proprietorship", styles),
            make_small_cell("4/100A Mainroad, Kanyakumari, 629702", styles),
            make_cell("Different PAN & owner. Likely unrelated.", styles),
        ],
    ]
    t = Table(unrel_data, colWidths=[78, 58, 48, 80, 56, 105, 100])
    ts = std_table_style()
    t.setStyle(TableStyle(ts))
    story.append(t)

    story.append(PageBreak())

    # ── SECTION 3: PAN SUMMARY ────────────────────────────────────
    story.append(section_header("3. PAN SUMMARY", styles))
    story.append(Spacer(1, 6))

    pan_header = [
        make_header_cell("PAN", styles),
        make_header_cell("Holder", styles),
        make_header_cell("Type", styles),
        make_header_cell("GSTINs", styles),
        make_header_cell("States", styles),
        make_header_cell("Discovery", styles),
    ]
    pan_rows = [
        [make_cell("BQRPN9730L", styles, bold=True), make_cell("Naznin Niyaf (wife)", styles), make_cell("Individual", styles), make_cell("1", styles), make_cell("Kerala (INACTIVE)", styles), make_cell("Previously Known", styles)],
        [make_cell("AAHFL8416C", styles, bold=True), make_cell("LE ARABIA FOODS", styles), make_cell("Firm", styles), make_cell("1", styles), make_cell("Karnataka (JP Nagar)", styles), make_cell("Previously Known", styles)],
        [make_cell("AAJFL0868L", styles, bold=True), new_tag("LE ARABIA RESTAURANT (Koramangala)", True, styles), make_cell("Firm", styles), make_cell("1", styles), make_cell("Karnataka (Koramangala)", styles), Paragraph('<font color="#e74c3c"><b>NEW</b></font>', styles["CellText"])],
        [make_cell("AAIFL0411G", styles, bold=True), new_tag("LE ARABIA RESTAURANT (Calicut)", True, styles), make_cell("Firm", styles), make_cell("1", styles), make_cell("Kerala (Calicut)", styles), Paragraph('<font color="#e74c3c"><b>NEW</b></font>', styles["CellText"])],
        [make_cell("ABIFR8802J", styles, bold=True), new_tag("M/s ROYAL LE ARABIA", True, styles), make_cell("Firm", styles), make_cell("1", styles), make_cell("Kerala (Trivandrum)", styles), Paragraph('<font color="#e74c3c"><b>NEW</b></font>', styles["CellText"])],
    ]
    pan_data = [pan_header] + pan_rows
    t = Table(pan_data, colWidths=[72, 140, 52, 40, 110, 111])
    ts = std_table_style()
    ts = add_alt_rows(ts, pan_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 14))

    # ── SECTION 4: OUTLET MAP ─────────────────────────────────────
    story.append(section_header("4. OUTLET MAP (Active Locations)", styles))
    story.append(Spacer(1, 6))

    story.append(Paragraph("<b>BANGALORE - 7 Outlets</b>", styles["SubHead"]))
    blr_header = [make_header_cell("#", styles), make_header_cell("Location", styles), make_header_cell("Address", styles), make_header_cell("Phone", styles), make_header_cell("Source", styles)]
    blr_rows = [
        ["1", "Basaveshwar Nagar", "881/B-1, WOC Road", "080 2323 3000", "Zomato, Swiggy"],
        ["2", "JP Nagar", "No.15, Bannerghatta Main Rd, 3rd Phase", "080 4141 0082", "Zomato, Swiggy"],
        ["3", "Marathahalli", "Munekolala Village, ORR", "7274056056", "Zomato"],
        ["4", "Koramangala 5th Block", "No. 60, 60ft Road", "-", "Zomato, Swiggy"],
        ["5", "Vijay Nagar", "-", "-", "Zomato"],
        ["6", "Peenya", "-", "-", "Zomato"],
        ["7", "Chandra Layout", "-", "-", "Swiggy"],
    ]
    blr_data = [blr_header] + [[make_cell(c, styles) for c in r] for r in blr_rows]
    t = Table(blr_data, colWidths=[25, 105, 180, 90, 125])
    ts = std_table_style()
    ts = add_alt_rows(ts, blr_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>KERALA - 5 Outlets</b>", styles["SubHead"]))
    ker_header = [make_header_cell("#", styles), make_header_cell("Location", styles), make_header_cell("Address", styles), make_header_cell("Phone", styles), make_header_cell("Source", styles)]
    ker_rows = [
        ["1", "Trivandrum - Kazhakkoottam", "Enjakkal Bypass Rd", "0471 241 2999", "Swiggy"],
        ["2", "Trivandrum - Vazhuthacaud", "City Chef Building", "0471 406 7777", "Zomato"],
        ["3", "Trivandrum - Kulathoor", "-", "-", "Zomato"],
        ["4", "Calicut - Nadakkave", "Opp Bismi Hypermarket", "0495 4856262", "Zomato, JustDial"],
        ["5", "Calicut - Govindapuram", "KB Tower, Opp MIMS", "8137000150", "Known data"],
    ]
    ker_data = [ker_header] + [[make_cell(c, styles) for c in r] for r in ker_rows]
    t = Table(ker_data, colWidths=[25, 120, 170, 90, 120])
    ts = std_table_style()
    ts = add_alt_rows(ts, ker_data)
    t.setStyle(TableStyle(ts))
    story.append(t)

    story.append(PageBreak())

    # ── SECTION 5: GST-TO-OUTLET MAPPING ──────────────────────────
    story.append(section_header("5. GST-TO-OUTLET MAPPING", styles))
    story.append(Spacer(1, 6))

    map_header = [make_header_cell("GSTIN", styles), make_header_cell("Likely Covers", styles), make_header_cell("Notes", styles)]
    map_rows = [
        [make_small_cell("29AAHFL8416C1ZA", styles), make_cell("JP Nagar, Basaveshwar Nagar, Marathahalli, Vijay Nagar, Peenya", styles), make_cell("Main Bangalore partnership firm (PAN: AAHFL8416C)", styles)],
        [make_small_cell("29AAJFL0868L1ZP", styles), make_cell("Koramangala 5th Block, Chandra Layout (?)", styles), make_cell("Separate partnership for Koramangala cluster (PAN: AAJFL0868L)", styles)],
        [make_small_cell("32AAIFL0411G1ZZ", styles), make_cell("Calicut - Nadakkave, Calicut - Govindapuram", styles), make_cell("Calicut partnership firm (PAN: AAIFL0411G)", styles)],
        [make_small_cell("32ABIFR8802J1Z1", styles), make_cell("TVM Kazhakkoottam, TVM Vazhuthacaud, TVM Kulathoor", styles), make_cell("Replaced inactive 32BQRPN9730L1Z6 (PAN: ABIFR8802J)", styles)],
        [make_small_cell("32BQRPN9730L1Z6", styles), make_cell("(Former TVM outlets)", styles), Paragraph('<font color="#c0392b"><b>INACTIVE</b></font> since May 2022', styles["CellText"])],
    ]
    map_data = [map_header] + map_rows
    t = Table(map_data, colWidths=[95, 205, 225])
    ts = std_table_style()
    ts = add_alt_rows(ts, map_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 14))

    # ── SECTION 6: FSSAI LICENSES ─────────────────────────────────
    story.append(section_header("6. FSSAI LICENSES — Verified via FoSCoS Portal", styles))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "FSSAI license numbers were extracted from Swiggy listings, then <b>verified on the official FoSCoS portal</b> (foscos.fssai.gov.in). "
        "The FoSCoS lookup confirmed the registered FBO name as <b>MOHAMMAD SAMSHUDDIN</b>.",
        styles["BodyText2"]
    ))
    story.append(Spacer(1, 6))

    fssai_header = [
        make_header_cell("FSSAI License No.", styles),
        make_header_cell("FBO/Registered Name", styles),
        make_header_cell("Type", styles),
        make_header_cell("Address (from FoSCoS)", styles),
        make_header_cell("Status", styles),
    ]
    fssai_rows = [
        [
            Paragraph('<font color="#0f3460"><b>11217332000026</b></font>', styles["CellText"]),
            Paragraph('<b>LE-ARABIA RESTAURANT / MOHAMMAD SAMSHUDDIN</b>', styles["CellText"]),
            make_cell("State License", styles),
            make_small_cell("No.881/B&B1, Eramma Phulekar Nilaya, Basaveshwara Nagar, 2nd Stage, WOC Road, Rajajinagara, B.B.M.P West, Karnataka-560086", styles),
            Paragraph('<font color="#c0392b"><b>EXPIRED</b></font>', styles["CellText"]),
        ],
        [
            Paragraph('<font color="#0f3460"><b>11222334001147</b></font>', styles["CellText"]),
            Paragraph('<b>LE ARABIA RESTAURANT / MOHAMMAD SAMSHUDDIN</b>', styles["CellText"]),
            make_cell("State License", styles),
            make_small_cell("No 60, 60 Feet Road, Behind Sukh Sagar Hotel, 5th Block, Koramangala, Bangalore, BTM Layout, B.B.M.P South, Karnataka-560034", styles),
            Paragraph('<font color="#c0392b"><b>EXPIRED</b></font>', styles["CellText"]),
        ],
        [
            Paragraph('<font color="#0f3460"><b>11316001001616</b></font>', styles["CellText"]),
            Paragraph('<b>LE ARABIA RESTAURANT</b>', styles["CellText"]),
            make_cell("State License", styles),
            make_small_cell("2/1053(8),(9), Kazhakoottam, Trivandrum, Kazhakoottam Circle, Thiruvananthapuram, Kerala-695582", styles),
            Paragraph('<font color="#c0392b"><b>EXPIRED</b></font>', styles["CellText"]),
        ],
    ]
    fssai_data = [fssai_header] + fssai_rows
    t = Table(fssai_data, colWidths=[90, 120, 52, 185, 78])
    ts = std_table_style()
    ts = add_alt_rows(ts, fssai_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Key Finding: Name Spelling Confirmed</b>", styles["SubHead"]))
    story.append(Paragraph(
        'The FSSAI registration confirms the owner\'s name is spelled <b>"MOHAMMAD SAMSHUDDIN"</b> (not "Shamsuddin" as in the settlement deed). '
        "Both Bangalore licenses explicitly list this name. All three licenses have <b>expired</b>, suggesting either renewal under new numbers or "
        "non-compliance. The outlets continue to operate on Swiggy/Zomato displaying these expired license numbers.",
        styles["BodyText2"]
    ))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>FSSAI-to-GSTIN Cross-Reference:</b>", styles["SubHead"]))
    fssai_to_gstin_header = [
        make_header_cell("FSSAI License", styles),
        make_header_cell("Outlet", styles),
        make_header_cell("Likely GSTIN", styles),
        make_header_cell("Reasoning", styles),
    ]
    fssai_to_gstin_rows = [
        [make_cell("11217332000026", styles, bold=True), make_cell("Basaveshwar Nagar", styles), make_cell("29AAHFL8416C1ZA", styles), make_cell("Main BLR firm, FSSAI issued 2017. GST now CANCELLED.", styles)],
        [make_cell("11222334001147", styles, bold=True), make_cell("Koramangala", styles), make_cell("29AAJFL0868L1ZP", styles), make_cell("FSSAI issued 2022, matches Koramangala GST reg (Dec 2021)", styles)],
        [make_cell("11316001001616", styles, bold=True), make_cell("Kazhakkoottam, TVM", styles), make_cell("32ABIFR8802J1Z1", styles), make_cell("FSSAI issued 2016 (pre-GST). Now under Royal Le Arabia.", styles)],
    ]
    fssai_gstin_data = [fssai_to_gstin_header] + fssai_to_gstin_rows
    t = Table(fssai_gstin_data, colWidths=[90, 95, 120, 220])
    ts = std_table_style()
    ts = add_alt_rows(ts, fssai_gstin_data)
    t.setStyle(TableStyle(ts))
    story.append(t)

    story.append(PageBreak())

    # ── SECTION 7: DATA GAPS ──────────────────────────────────────
    story.append(section_header("7. DATA GAPS — What We Still Don't Have", styles))
    story.append(Spacer(1, 6))

    gap_header = [make_header_cell("Data Point", styles), make_header_cell("Status", styles), make_header_cell("How to Obtain", styles)]
    gap_rows = [
        ["Personal Email", "NOT OBTAINED", "Best options: Truecaller Premium (phone lookup), Gmail forgot-password probe, SignalHire, Apollo.io"],
        ["FSSAI License Numbers", "OBTAINED (3/12)", "3 verified via FoSCoS — all EXPIRED. Remaining outlets need Zomato Order Online check"],
        ["FSSAI — Active/Renewed Licenses", "NOT OBTAINED", "Expired licenses on Swiggy suggest renewal under new numbers. Search FoSCoS by name"],
        ["Partnership Deed / Partners List", "NOT OBTAINED", "Registrar of Firms, Karnataka & Kerala — physical/online application"],
        ["Income Tax Returns / Turnover", "NOT OBTAINED", "Requires authorized access via IT portal"],
        ["Bank Account Details", "NOT OBTAINED", "Not publicly available"],
        ["Samshuddin's Personal PAN", "NOT OBTAINED", "Not discoverable from public records; check partnership deeds"],
        ["MCA / Company Registration", "CONFIRMED: NONE", "Searched MCA, Tofler, ZaubaCorp — no company/LLP exists"],
        ["Registrant Email (learabia.in)", "NOT RECOVERABLE", "Domain expired; Wayback Machine had no cached data"],
        ["GST Filing History (GSTR-1/3B)", "NOT OBTAINED", "Requires GST portal login or paid API (MasterIndia, ClearTax)"],
        ["GST Status Verification", "DONE (1 of 5)", "29AAHFL8416C1ZA confirmed CANCELLED suo-moto 26/12/2019 via GST portal"],
    ]
    gap_data = [gap_header] + [[make_cell(c, styles) for c in r] for r in gap_rows]
    t = Table(gap_data, colWidths=[140, 100, 285])
    ts = std_table_style()
    ts = add_alt_rows(ts, gap_data)
    # Color the status column
    for i, row in enumerate(gap_rows, start=1):
        if "NOT" in row[1]:
            ts.append(("TEXTCOLOR", (1, i), (1, i), INACTIVE_RED))
        elif "PARTIAL" in row[1]:
            ts.append(("TEXTCOLOR", (1, i), (1, i), colors.HexColor("#e67e22")))
        elif "CONFIRMED" in row[1]:
            ts.append(("TEXTCOLOR", (1, i), (1, i), ACTIVE_GREEN))
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 14))

    # ── SECTION 8: ENTITY STRUCTURE ANALYSIS ──────────────────────
    story.append(section_header("8. ENTITY STRUCTURE ANALYSIS", styles))
    story.append(Spacer(1, 8))

    analysis_text = """The Le Arabia restaurant chain operates through <b>multiple separate partnership firms</b> rather than a single corporate entity.
Each geographic cluster has its own firm PAN and GST registration, creating a deliberately compartmentalized structure:"""
    story.append(Paragraph(analysis_text, styles["BodyText2"]))
    story.append(Spacer(1, 8))

    struct_data = [
        [make_header_cell("Cluster", styles), make_header_cell("Entity Structure", styles), make_header_cell("PAN", styles), make_header_cell("Outlets", styles)],
        [make_cell("Bangalore Main", styles, bold=True), make_cell("Partnership Firm", styles), make_cell("AAHFL8416C", styles), make_cell("5 outlets (JP Nagar hub)", styles)],
        [make_cell("Bangalore Koramangala", styles, bold=True), make_cell("Partnership Firm", styles), make_cell("AAJFL0868L", styles), make_cell("1-2 outlets", styles)],
        [make_cell("Calicut", styles, bold=True), make_cell("Partnership Firm", styles), make_cell("AAIFL0411G", styles), make_cell("2 outlets", styles)],
        [make_cell("Trivandrum (current)", styles, bold=True), make_cell("Partnership Firm", styles), make_cell("ABIFR8802J", styles), make_cell("2-3 outlets", styles)],
        [make_cell("Trivandrum (former)", styles, bold=True), Paragraph('<font color="#c0392b">Proprietorship (INACTIVE)</font>', styles["CellText"]), make_cell("BQRPN9730L", styles), make_cell("Cancelled May 2022", styles)],
    ]
    t = Table(struct_data, colWidths=[120, 140, 100, 165])
    ts = std_table_style()
    ts = add_alt_rows(ts, struct_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Key Observations:</b>", styles["SubHead"]))
    observations = [
        "The original Trivandrum operation was a <b>proprietorship under wife Naznin Niyaf's PAN</b> (BQRPN9730L), which was cancelled in May 2022.",
        "A new partnership firm <b>\"M/s Royal Le Arabia Restaurant\"</b> (PAN: ABIFR8802J) was registered at the <b>same Kazhakuttom address</b> on 30 April 2024 - clearly a successor entity.",
        "A <b>Deed of Settlement</b> dated 14 March 2024 (Karnataka Government e-stamp) was executed just weeks before the new Trivandrum partnership was registered, suggesting a coordinated restructuring.",
        "This multi-firm structure may serve purposes of <b>tax optimization</b>, <b>liability isolation</b>, or <b>operational independence</b> of each geographic cluster.",
        "No company or LLP is registered with MCA under \"Le Arabia\" - all entities operate as partnership firms or proprietorships, avoiding corporate disclosure requirements.",
    ]
    for obs in observations:
        story.append(Paragraph(f"  {obs}", styles["BodyText2"]))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ── SECTION 9: EMAIL INVESTIGATION STATUS ─────────────────────
    story.append(section_header("9. PERSONAL EMAIL — Investigation Status", styles))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "The primary objective — finding Mohammad Samshuddin's personal email — has not yet been achieved. "
        "Below is a summary of all approaches attempted and remaining options.",
        styles["BodyText2"]
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("<b>Approaches Attempted (No Email Found):</b>", styles["SubHead"]))
    attempted_header = [make_header_cell("Method", styles), make_header_cell("Result", styles)]
    attempted_rows = [
        ["WHOIS learabia.in", "Domain expired. No registrant data."],
        ["WHOIS learabiarestaurant.com", "Parked domain (registered Jul 2025 by squatter). WHOIS privacy enabled."],
        ["Facebook page (Contact Info)", "Phone only (+91 80 2323 3000). No email listed."],
        ["Instagram (@learabia.restaurant)", "Bio links to parked domain. No email in profile."],
        ["FoSCoS / FSSAI portal", "Shows FBO name (MOHAMMAD SAMSHUDDIN) but no email in public view."],
        ["GST Portal (services.gst.gov.in)", "Shows business details but email masked/not shown in public view."],
        ["Web search (multiple queries)", "No personal email indexed for this person."],
        ["LinkedIn search", "No matching profile found."],
        ["Public GST/FSSAI APIs", "All free APIs require keys now; paid APIs do not expose email field."],
    ]
    attempted_data = [attempted_header] + [[make_cell(c, styles) for c in r] for r in attempted_rows]
    t = Table(attempted_data, colWidths=[160, 365])
    ts = std_table_style()
    ts = add_alt_rows(ts, attempted_data)
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Remaining Options (Recommended):</b>", styles["SubHead"]))
    remaining_header = [make_header_cell("#", styles), make_header_cell("Method", styles), make_header_cell("Cost", styles), make_header_cell("How", styles), make_header_cell("Likelihood", styles)]
    remaining_rows = [
        ["1", "Truecaller Premium", "~Rs 75/mo", "Search 8891111174 — shows linked email for most Indian numbers", "HIGH"],
        ["2", "Gmail forgot-password probe", "Free", "Try samshuddin@gmail.com etc. on Google password reset — confirms if phone ****1174 matches", "HIGH"],
        ["3", "WhatsApp Business check", "Free", "Save 8891111174, check WhatsApp Business profile for email", "MEDIUM"],
        ["4", "SignalHire", "Free (5 lookups)", "Enter phone number — cross-references social media for linked emails", "MEDIUM"],
        ["5", "Apollo.io People Search", "Free (50 credits)", "Search Mohammad Samshuddin + Le Arabia for business contact enrichment", "MEDIUM"],
        ["6", "Google Maps owner replies", "Free", "Check if owner replied to reviews — reveals Google account", "LOW"],
    ]
    remaining_data = [remaining_header] + [[make_cell(c, styles) for c in r] for r in remaining_rows]
    t = Table(remaining_data, colWidths=[20, 105, 65, 255, 80])
    ts = std_table_style()
    ts = add_alt_rows(ts, remaining_data)
    t.setStyle(TableStyle(ts))
    story.append(t)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=LIGHT_BORDER))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<i>Sources: KnowYourGST.com, FoSCoS (FSSAI), GST Portal (services.gst.gov.in), Zomato, Swiggy, JustDial, TripAdvisor, "
        "Facebook, Instagram, WHOIS (NIXI Registry), Karnataka Govt e-stamp deed. "
        "This report is based on publicly available data as of 2 April 2026.</i>",
        styles["Note"]
    ))

    # ── BUILD ─────────────────────────────────────────────────────
    doc.build(story)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_pdf()
