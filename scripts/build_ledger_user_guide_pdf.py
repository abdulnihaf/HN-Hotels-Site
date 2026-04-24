#!/usr/bin/env python3
"""
Build the HN Ledger user guide PDF for Naveen (accountant).

Output: ~/Desktop/HN_Ledger_User_Guide_2026-04-24/HN_Ledger_User_Guide.pdf

Pure reportlab, no external tooling. Mocks each screen with coloured boxes
and annotations so the guide doesn't need real screenshots.
"""
from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable,
)
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Register Arial Unicode (has Rs.  + many symbols) as our main font ────
_UNI_REG  = Path('/Library/Fonts/Arial Unicode.ttf')
_BOLD_REG = Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
if _UNI_REG.exists():
    pdfmetrics.registerFont(TTFont('Uni', str(_UNI_REG)))
    if _BOLD_REG.exists():
        pdfmetrics.registerFont(TTFont('Uni-Bold', str(_BOLD_REG)))
        from reportlab.pdfbase.pdfmetrics import registerFontFamily
        registerFontFamily('Uni', normal='Uni', bold='Uni-Bold', italic='Uni', boldItalic='Uni-Bold')
        FONT = 'Uni'
        FONT_BOLD = 'Uni-Bold'
    else:
        FONT = 'Uni'
        FONT_BOLD = 'Uni'
else:
    FONT = 'Helvetica'
    FONT_BOLD = 'Helvetica-Bold'

# ── Colours mirror the live app (dark theme) ─────────────────────────
BG         = colors.HexColor("#0c0c14")
SURFACE    = colors.HexColor("#16161f")
SURFACE_2  = colors.HexColor("#1c1c27")
BORDER     = colors.HexColor("#2a2a38")
TEXT       = colors.HexColor("#e4e4ed")
TEXT_DIM   = colors.HexColor("#8a8a9b")
TEXT_MUTE  = colors.HexColor("#5a5a6b")
BRAND      = colors.HexColor("#e8930c")
BRAND_SOFT = colors.HexColor("#3a2a10")
SUCCESS    = colors.HexColor("#10b981")
SUCCESS_SOFT = colors.HexColor("#0e3a2b")
WARN       = colors.HexColor("#f59e0b")
WARN_SOFT  = colors.HexColor("#3a2a0b")
DANGER     = colors.HexColor("#ef4444")
INFO       = colors.HexColor("#3b82f6")
NCH        = colors.HexColor("#fbbf24")
HE         = colors.HexColor("#f87171")
HQ         = colors.HexColor("#60a5fa")

OUT_DIR    = Path.home() / 'Desktop' / 'HN_Ledger_User_Guide_2026-04-24'
OUT_PATH   = OUT_DIR / 'HN_Ledger_User_Guide.pdf'


# ── Styles ────────────────────────────────────────────────────────────
def make_styles():
    base = getSampleStyleSheet()
    return {
        'title':     ParagraphStyle('title', parent=base['Heading1'], fontSize=30,
                                    textColor=TEXT, alignment=TA_LEFT, leading=34,
                                    fontName=FONT_BOLD, spaceAfter=4),
        'subtitle':  ParagraphStyle('subtitle', parent=base['Normal'], fontSize=13,
                                    textColor=BRAND, alignment=TA_LEFT, leading=18,
                                    fontName=FONT_BOLD, spaceAfter=6),
        'kicker':    ParagraphStyle('kicker', parent=base['Normal'], fontSize=9,
                                    textColor=BRAND, alignment=TA_LEFT, leading=12,
                                    fontName=FONT_BOLD, spaceAfter=2),
        'h1':        ParagraphStyle('h1', parent=base['Heading1'], fontSize=18,
                                    textColor=TEXT, leading=22, fontName=FONT_BOLD,
                                    spaceBefore=6, spaceAfter=8),
        'h2':        ParagraphStyle('h2', parent=base['Heading2'], fontSize=13,
                                    textColor=BRAND, leading=17, fontName=FONT_BOLD,
                                    spaceBefore=10, spaceAfter=6),
        'body':      ParagraphStyle('body', parent=base['Normal'], fontSize=10,
                                    textColor=TEXT, leading=14, fontName=FONT,
                                    spaceAfter=5),
        'body-dim':  ParagraphStyle('body-dim', parent=base['Normal'], fontSize=9,
                                    textColor=TEXT_DIM, leading=13, fontName=FONT,
                                    spaceAfter=4),
        'step-num':  ParagraphStyle('step-num', parent=base['Normal'], fontSize=22,
                                    textColor=BRAND, leading=24, fontName=FONT_BOLD),
        'hint':      ParagraphStyle('hint', parent=base['Normal'], fontSize=9,
                                    textColor=WARN, leading=13, fontName=FONT,
                                    backColor=WARN_SOFT, borderPadding=8,
                                    spaceBefore=6, spaceAfter=6),
        'tip':       ParagraphStyle('tip', parent=base['Normal'], fontSize=9,
                                    textColor=SUCCESS, leading=13, fontName=FONT,
                                    backColor=SUCCESS_SOFT, borderPadding=8,
                                    spaceBefore=6, spaceAfter=6),
    }


# ── Custom drawing helpers ────────────────────────────────────────────
class PageFrame(Flowable):
    """Dark background wrapper for the entire page."""
    def __init__(self, width, height):
        super().__init__()
        self.width = width
        self.height = height
    def wrap(self, w, h): return (w, h)
    def draw(self):
        # (page background handled via canvas onPage)
        pass


def page_bg(canvas, doc):
    """Paint the full page background dark."""
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # Page number + footer
    canvas.setFillColor(TEXT_MUTE)
    canvas.setFont(FONT, 8)
    canvas.drawRightString(A4[0] - 15*mm, 10*mm, f"{doc.page}")
    canvas.drawString(15*mm, 10*mm, "HN Ledger · User Guide for Naveen · Apr 2026")
    canvas.restoreState()


class MockBox(Flowable):
    """Coloured rounded rectangle with centered text — mocks a button/chip/pill."""
    def __init__(self, width, height, text='', fg=TEXT, bg=SURFACE, border=BORDER,
                 radius=6, font_size=10, bold=True, padding=4):
        super().__init__()
        self.width = width
        self.height = height
        self.text = text
        self.fg = fg
        self.bg = bg
        self.border = border
        self.radius = radius
        self.font_size = font_size
        self.bold = bold
        self.padding = padding
    def wrap(self, w, h):
        return (self.width, self.height)
    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.setStrokeColor(self.border)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=1)
        if self.text:
            c.setFillColor(self.fg)
            c.setFont(FONT_BOLD if self.bold else FONT, self.font_size)
            tw = c.stringWidth(self.text, FONT_BOLD if self.bold else FONT, self.font_size)
            c.drawString((self.width - tw) / 2, (self.height - self.font_size) / 2 + 1, self.text)


class PhoneMock(Flowable):
    """A small phone-shaped container drawing the Home screen of the ledger."""
    def __init__(self, width=75*mm, height=140*mm, mode='home'):
        super().__init__()
        self.width = width
        self.height = height
        self.mode = mode
    def wrap(self, w, h): return (self.width, self.height)
    def draw(self):
        c = self.canv
        # Phone outer shell
        c.setFillColor(colors.HexColor("#222"))
        c.roundRect(0, 0, self.width, self.height, 6*mm, fill=1, stroke=0)
        # Screen
        sx, sy = 2*mm, 4*mm
        sw, sh = self.width - 4*mm, self.height - 8*mm
        c.setFillColor(BG)
        c.roundRect(sx, sy, sw, sh, 3*mm, fill=1, stroke=0)

        if self.mode == 'home':
            self._draw_home(sx, sy, sw, sh)
        elif self.mode == 'pin':
            self._draw_pin(sx, sy, sw, sh)
        elif self.mode == 'form':
            self._draw_form(sx, sy, sw, sh)
        elif self.mode == 'admin':
            self._draw_admin(sx, sy, sw, sh)

    def _text(self, x, y, text, fg=TEXT, size=6, bold=False, font=FONT):
        c = self.canv
        c.setFillColor(fg)
        c.setFont(font + ('-Bold' if bold else ''), size)
        c.drawString(x, y, text)

    def _pill(self, x, y, w, h, text, fg, bg, border=None, font_size=5):
        c = self.canv
        c.setFillColor(bg)
        c.setStrokeColor(border or bg)
        c.setLineWidth(0.4)
        c.roundRect(x, y, w, h, h/2, fill=1, stroke=1 if border else 0)
        if text:
            c.setFillColor(fg)
            c.setFont(FONT_BOLD, font_size)
            tw = c.stringWidth(text, FONT_BOLD, font_size)
            c.drawString(x + (w - tw) / 2, y + h/2 - font_size/2 + 0.5, text)

    def _rect(self, x, y, w, h, bg, border=None, radius=1*mm):
        c = self.canv
        c.setFillColor(bg)
        c.setStrokeColor(border or bg)
        c.setLineWidth(0.4)
        c.roundRect(x, y, w, h, radius, fill=1, stroke=1 if border else 0)

    def _draw_pin(self, sx, sy, sw, sh):
        top = sy + sh - 10*mm
        self._text(sx + 4*mm, top, 'HN Ledger', size=11, bold=True)
        self._text(sx + 4*mm, top - 5*mm, 'Tally backfill · expense book', fg=TEXT_DIM, size=6)
        self._text(sx + 4*mm, top - 18*mm, 'ENTER PIN', fg=TEXT_MUTE, size=5, bold=True)
        self._rect(sx + 4*mm, top - 28*mm, sw - 8*mm, 8*mm, SURFACE_2, BRAND)
        self._text(sx + sw/2 - 2*mm, top - 24*mm, '* * * *', fg=TEXT, size=9, bold=True)
        self._rect(sx + 4*mm, top - 44*mm, sw - 8*mm, 8*mm, BRAND)
        self._text(sx + sw/2 - 5*mm, top - 40*mm, 'Enter', fg=colors.black, size=9, bold=True)

    def _draw_home(self, sx, sy, sw, sh):
        top = sy + sh - 6*mm
        # Header row
        self._text(sx + 3*mm, top, 'Hi Naveen', size=10, bold=True)
        self._text(sx + 3*mm, top - 3*mm, 'cfo · ledger', fg=TEXT_DIM, size=5)
        self._pill(sx + sw - 22*mm, top - 1.5*mm, 12*mm, 4*mm, 'Admin', TEXT, SURFACE_2, BORDER, 5)

        # Summary cards
        y = top - 9*mm
        cw = (sw - 10*mm) / 3
        for i, (label, val, col) in enumerate([
            ('PENDING DRAFTS', '623', WARN),
            ('FINAL ENTRIES',  '0',   SUCCESS),
            ('TOTAL Rs.  (FINAL)', 'Rs. 0', BRAND),
        ]):
            x = sx + 3*mm + i * (cw + 1*mm)
            self._rect(x, y - 10*mm, cw, 10*mm, SURFACE, BORDER)
            self._text(x + 1*mm, y - 3*mm, label, fg=TEXT_DIM, size=4, bold=True)
            self._text(x + 1*mm, y - 7*mm, val, fg=col, size=8, bold=True)

        # Tabs
        y -= 14*mm
        tab_w = (sw - 10*mm) / 3
        for i, (txt, active) in enumerate([('Drafts · 623', True), ('Entries', False), ('+ New', False)]):
            x = sx + 3*mm + i * (tab_w + 1*mm)
            self._pill(x, y - 5*mm, tab_w, 5*mm, txt,
                       BRAND if active else TEXT_DIM,
                       BRAND_SOFT if active else SURFACE,
                       BRAND if active else BORDER, 5)

        # Filter row
        y -= 8*mm
        self._text(sx + 3*mm, y, 'BRAND:', fg=TEXT_MUTE, size=4, bold=True)
        bx = sx + 13*mm
        for chip, col in [('All', BRAND), ('NCH', None), ('HE', None), ('HQ', None), ('Unassigned', None)]:
            cw2 = 3.8*mm + len(chip)*0.9*mm
            self._pill(bx, y - 2*mm, cw2, 3.5*mm, chip,
                       col or TEXT_DIM, BRAND_SOFT if col else SURFACE,
                       col or BORDER, 4)
            bx += cw2 + 1*mm

        # Day header
        y -= 7*mm
        self._text(sx + 3*mm, y, 'MON 31 MAR', fg=BRAND, size=5, bold=True)
        self._text(sx + sw - 24*mm, y, '42 · Rs. 5,86,529', fg=TEXT_DIM, size=5, bold=True)
        self.canv.setStrokeColor(BORDER)
        self.canv.setLineWidth(0.3)
        self.canv.line(sx + 3*mm, y - 1*mm, sx + sw - 3*mm, y - 1*mm)

        # Draft rows
        y -= 4*mm
        rows = [
            (HQ,       'Salary — Somesh',     'Salaries',   'Rs. 13,500'),
            (HQ,       'Salary — Riyaz',      'Salaries',   'Rs. 17,000'),
            (HQ,       'Salary — Noim',       'Salaries',   'Rs. 4,200'),
            (DANGER,   'Chicken Purchase',    'Raw Mat.',   'Rs. 8,450'),
            (WARN,     'Electricity Bill',    'Utilities',  'Rs. 12,480'),
            (SUCCESS,  'Disposable Materials','Operations', 'Rs. 2,100'),
            (HQ,       'Salary — Tanveer',    'Salaries',   'Rs. 35,000'),
        ]
        for chip_col, title, cat, amt in rows:
            self._rect(sx + 3*mm, y - 8*mm, sw - 6*mm, 7.5*mm, SURFACE, BORDER)
            # Left amber border for drafts
            self.canv.setFillColor(WARN)
            self.canv.rect(sx + 3*mm, y - 8*mm, 0.7*mm, 7.5*mm, fill=1, stroke=0)
            # Category chip instead of emoji
            self.canv.setFillColor(chip_col)
            self.canv.roundRect(sx + 5*mm, y - 5*mm, 2.5*mm, 2.5*mm, 0.5*mm, fill=1, stroke=0)
            self._text(sx + 9*mm, y - 3*mm, title, size=6, bold=True)
            # Brand tag NONE for post-Feb27
            self._pill(sx + 9*mm, y - 7*mm, 7*mm, 2.5*mm, 'NONE', TEXT_DIM, colors.HexColor("#22222b"), None, 3.5)
            self._text(sx + 17*mm, y - 6.2*mm, f'{cat} · missing: qty, uom, brand', fg=TEXT_DIM, size=4)
            self._text(sx + sw - 14*mm, y - 4*mm, amt, fg=TEXT, size=6, bold=True)
            self._text(sx + sw - 14*mm, y - 6.5*mm, 'DRAFT', fg=WARN, size=4, bold=True)
            y -= 9*mm
            if y < sy + 10*mm:
                break

    def _draw_form(self, sx, sy, sw, sh):
        top = sy + sh - 6*mm
        self._pill(sx + 3*mm, top - 2*mm, 11*mm, 4*mm, '← Back', TEXT, SURFACE, BORDER, 5)
        self._pill(sx + sw - 18*mm, top - 2*mm, 15*mm, 4*mm, 'DRAFT', WARN, WARN_SOFT, None, 5)

        y = top - 8*mm
        self._text(sx + 3*mm, y, 'Edit entry #623', size=10, bold=True)

        # Tally hint banner
        y -= 4*mm
        self._rect(sx + 3*mm, y - 12*mm, sw - 6*mm, 11*mm, WARN_SOFT, WARN)
        self._text(sx + 5*mm, y - 3*mm, 'TALLY DRAFT — imported from', fg=WARN, size=5, bold=True)
        self._text(sx + 5*mm, y - 6*mm, 'Salary Expenses - Somesh · vch 669', fg=WARN, size=5)
        self._text(sx + 5*mm, y - 9*mm, 'Fill qty + UOM + vendor, then Save final.', fg=WARN, size=5)

        y -= 16*mm
        # Date field
        self._text(sx + 3*mm, y, 'DATE *', fg=TEXT_DIM, size=4, bold=True)
        self._rect(sx + 3*mm, y - 5*mm, sw - 6*mm, 4*mm, SURFACE_2, BORDER)
        self._text(sx + 4*mm, y - 3.5*mm, '31/03/2026', size=6)

        y -= 8*mm
        # Brand chips
        self._text(sx + 3*mm, y, 'BRAND *', fg=TEXT_DIM, size=4, bold=True)
        y -= 5*mm
        cw = (sw - 8*mm) / 3
        for i, (b, bcol) in enumerate([('NCH', NCH), ('HE', HE), ('HQ', HQ)]):
            x = sx + 3*mm + i * (cw + 1*mm)
            self._rect(x, y, cw, 5*mm, SURFACE, BORDER)
            self._text(x + cw/2 - 2*mm, y + 1.5*mm, b, fg=TEXT_DIM, size=5, bold=True)

        y -= 7*mm
        # Category field
        self._text(sx + 3*mm, y, 'CATEGORY *', fg=TEXT_DIM, size=4, bold=True)
        self._rect(sx + 3*mm, y - 5*mm, sw - 6*mm, 4*mm, SURFACE_2, BORDER)
        # Category chip before text
        self.canv.setFillColor(HQ)
        self.canv.roundRect(sx + 4*mm, y - 4.2*mm, 2*mm, 2*mm, 0.3*mm, fill=1, stroke=0)
        self._text(sx + 7.5*mm, y - 3.5*mm, 'Salaries', size=6)

        y -= 8*mm
        # Product field
        self._text(sx + 3*mm, y, 'PRODUCT *       + Add new', fg=TEXT_DIM, size=4, bold=True)
        self._rect(sx + 3*mm, y - 5*mm, sw - 6*mm, 4*mm, SURFACE_2, BORDER)
        self._text(sx + 4*mm, y - 3.5*mm, 'Salary — Somesh · month', size=6)

        y -= 8*mm
        # Qty + UOM
        self._text(sx + 3*mm, y, 'QUANTITY *', fg=TEXT_DIM, size=4, bold=True)
        self._text(sx + sw/2 + 1*mm, y, 'UOM *', fg=TEXT_DIM, size=4, bold=True)
        self._rect(sx + 3*mm, y - 5*mm, sw/2 - 5*mm, 4*mm, SURFACE_2, BRAND)
        self._text(sx + 4*mm, y - 3.5*mm, '1', fg=TEXT, size=6, bold=True)
        self._rect(sx + sw/2 + 1*mm, y - 5*mm, sw/2 - 4*mm, 4*mm, SURFACE_2, BRAND)
        self._text(sx + sw/2 + 2*mm, y - 3.5*mm, 'month', fg=TEXT, size=6, bold=True)

        y -= 8*mm
        # Amount
        self._text(sx + 3*mm, y, 'AMOUNT (Rs. ) *', fg=TEXT_DIM, size=4, bold=True)
        self._rect(sx + 3*mm, y - 5*mm, sw - 6*mm, 4*mm, SURFACE_2, BORDER)
        self._text(sx + 4*mm, y - 3.5*mm, '13500', size=6)

        # Bottom bar
        self._rect(sx, sy + 2*mm, sw, 7*mm, BG, BORDER)
        self._rect(sx + 2*mm, sy + 3.5*mm, sw/3 - 2*mm, 4.5*mm, SURFACE, BORDER)
        self._text(sx + sw/6 - 6*mm, sy + 5.5*mm, 'Save draft', fg=TEXT_DIM, size=6, bold=True)
        self._rect(sx + sw/3 + 1*mm, sy + 3.5*mm, 2*sw/3 - 4*mm, 4.5*mm, BRAND)
        self._text(sx + sw/2 + 8*mm, sy + 5.5*mm, 'Save final', fg=colors.black, size=7, bold=True)

    def _draw_admin(self, sx, sy, sw, sh):
        top = sy + sh - 6*mm
        self._text(sx + 3*mm, top, 'Hi Nihaf', size=9, bold=True)
        self._text(sx + 3*mm, top - 3*mm, 'admin · structure editor', fg=TEXT_DIM, size=5)

        # Section tabs
        y = top - 8*mm
        tab_w = (sw - 10*mm) / 4
        for i, (txt, active) in enumerate([('Categories', True), ('UOMs', False), ('Vendors', False), ('Products', False)]):
            x = sx + 3*mm + i * (tab_w + 1*mm)
            self._pill(x, y - 4*mm, tab_w, 4*mm, txt,
                       BRAND if active else TEXT_DIM,
                       BRAND_SOFT if active else SURFACE,
                       BRAND if active else BORDER, 4)

        # Add new category box
        y -= 8*mm
        self._rect(sx + 3*mm, y - 16*mm, sw - 6*mm, 15*mm, SURFACE, SUCCESS)
        self._text(sx + 5*mm, y - 3*mm, '+ Add new category', fg=TEXT, size=6, bold=True)
        self._rect(sx + 5*mm, y - 9*mm, 8*mm, 4*mm, SURFACE_2, BORDER)
        # Pin icon replaced with a simple colored box
        self.canv.setFillColor(BRAND)
        self.canv.roundRect(sx + 7*mm, y - 8*mm, 3*mm, 3*mm, 0.5*mm, fill=1, stroke=0)
        self._rect(sx + 15*mm, y - 9*mm, sw - 22*mm, 4*mm, SURFACE_2, BORDER)
        self._text(sx + 16*mm, y - 7.5*mm, 'Category name', fg=TEXT_MUTE, size=5)
        self._pill(sx + sw - 16*mm, y - 14*mm, 10*mm, 3.5*mm, 'Add', SUCCESS, SURFACE_2, SUCCESS, 4)

        # Category list
        y -= 20*mm
        for chip_col, name, count in [
            (DANGER,  'Raw Materials',        '29 items'),
            (HQ,      'Salaries',             '43 items'),
            (colors.HexColor("#b45309"), 'Rent', '3 items'),
            (WARN,    'Utilities',            '10 items'),
            (SUCCESS, 'Operations (Petty)',   '34 items'),
            (colors.HexColor("#6b7280"), 'Maintenance & Repair', '15 items'),
            (INFO,    'Marketing & Promotion', '7 items'),
            (colors.HexColor("#a78bfa"), 'Tech, SaaS & Banking', '9 items'),
        ]:
            self._rect(sx + 3*mm, y - 6*mm, sw - 6*mm, 5.5*mm, SURFACE, BORDER)
            self.canv.setFillColor(chip_col)
            self.canv.roundRect(sx + 5*mm, y - 4.5*mm, 3*mm, 3*mm, 0.5*mm, fill=1, stroke=0)
            self._text(sx + 10*mm, y - 3.5*mm, name, fg=TEXT, size=6, bold=True)
            self._text(sx + sw - 19*mm, y - 3.5*mm, count, fg=TEXT_DIM, size=5)
            self._text(sx + sw - 6*mm, y - 3.5*mm, '>', fg=TEXT_DIM, size=7)
            y -= 7*mm
            if y < sy + 6*mm:
                break


# ── Build the doc ─────────────────────────────────────────────────────
def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    st = make_styles()

    doc = SimpleDocTemplate(
        str(OUT_PATH), pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=15*mm, bottomMargin=15*mm,
        title='HN Ledger — User Guide', author='Nihaf / HN Hotels',
    )

    story = []

    # ─── Cover page ───
    story.append(Spacer(1, 30*mm))
    story.append(Paragraph('HN LEDGER', st['kicker']))
    story.append(Paragraph('Tally backfill · expense book', st['title']))
    story.append(Paragraph('User guide for Naveen', st['subtitle']))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        'Re-enter every HN Hotels expense from <b>3 Feb 2026</b> to '
        '<b>1 Apr 2026</b> with full product-level detail — quantity, unit '
        'of measure, vendor, brand, bill photo.',
        st['body'],
    ))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        '<b>623 Tally vouchers are already loaded as drafts.</b> Your job is '
        'to go through each one, fill the 5 missing pieces, attach a bill '
        'photo, and mark it final. Not linked to Odoo — this book is for '
        'management clarity only.',
        st['body'],
    ))
    story.append(Spacer(1, 10*mm))

    # Cover boxes
    cover_data = [
        [
            Paragraph('<b>WHERE</b><br/>hnhotels.in/ops/ledger/', st['body']),
            Paragraph('<b>YOUR PIN</b><br/>3754', st['body']),
            Paragraph('<b>ROLE</b><br/>CFO (full access + admin)', st['body']),
        ]
    ]
    t = Table(cover_data, colWidths=[60*mm, 40*mm, 70*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), SURFACE),
        ('BOX',        (0,0), (-1,-1), 0.5, BORDER),
        ('INNERGRID',  (0,0), (-1,-1), 0.5, BORDER),
        ('VALIGN',     (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING',(0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING',(0,0), (-1,-1), 8),
    ]))
    story.append(t)

    story.append(Spacer(1, 20*mm))
    story.append(Paragraph('What you\'ll learn', st['h2']))
    for txt in [
        '1. How to log in and read the home screen',
        '2. How to open a Tally draft and fill the 5 mandatory fields',
        '3. How to attach a bill photo (stored in Google Drive)',
        '4. When to Save Draft vs Save Final',
        '5. How to add a new product, vendor, or UOM if it\'s not in the list',
        '6. How the Admin page works (rename / reorder / archive)',
    ]:
        story.append(Paragraph(txt, st['body']))

    story.append(PageBreak())

    # ─── Page 2: Overview / architecture ───
    story.append(Paragraph('01 · What this tool is and isn\'t', st['h1']))
    story.append(Paragraph('It is a separate ledger app, deliberately independent.', st['h2']))
    story.append(Paragraph(
        'The ledger at <b>/ops/ledger/</b> is completely separate from the '
        '<b>/ops/expense/</b> system that Nihaf uses daily. The daily system '
        'writes through to Odoo (and creates hr.expense entries). This ledger '
        'does <b>not</b> touch Odoo — nothing you save here will show up in '
        'Odoo, and nothing from Odoo shows up here.',
        st['body'],
    ))
    story.append(Paragraph(
        'Why two systems? Because Tally tracks expenses by <b>account</b> '
        '(e.g. "Butter Purchase" Rs. 1,120) without saying how much butter, from '
        'which vendor, or in what units. This tool re-captures those missing '
        'details so you can tell, later, exactly <b>what / how much / when / '
        'why</b> for every Rs.  spent from 3 Feb → 1 Apr 2026.',
        st['body'],
    ))

    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('The 5 things you must fill on every entry:', st['h2']))
    rules = [
        ('1', 'DATE',     'The actual date the expense happened (already filled from Tally for drafts).'),
        ('2', 'BRAND',    'NCH, HE, or HQ. Drafts before 27 Feb are already set to NCH; after, you pick.'),
        ('3', 'PRODUCT',  'Exact item bought. Under the correct Category.'),
        ('4', 'QUANTITY + UOM', 'How much of it? In what unit (kg, ltr, pcs, month, …). Both required.'),
        ('5', 'AMOUNT',   'Total Rs.  paid (already filled from Tally for drafts).'),
    ]
    data = [[Paragraph(n, st['step-num']),
             Paragraph(f'<b>{lbl}</b>', st['body']),
             Paragraph(desc, st['body-dim'])] for n, lbl, desc in rules]
    t = Table(data, colWidths=[12*mm, 35*mm, 123*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LINEBELOW', (0,0), (-1,-2), 0.3, BORDER),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING',(0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING',(0,0), (-1,-1), 6),
    ]))
    story.append(t)

    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        '<b>Rule:</b> The system will NOT let you mark an entry <b>Final</b> '
        'unless all 5 are filled (and amount &gt; 0). You can always Save '
        'Draft with whatever you have so far — come back later.',
        st['hint'],
    ))

    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('Optional extras (nice to have):', st['h2']))
    for item in [
        'Vendor — pick from the dropdown, or type a free-text name if not listed',
        'Payment mode — Cash / HDFC / Federal / Razorpay / Paytm / UPI / Card',
        'Bill number — the vendor\'s invoice number',
        'Voucher number — the Tally voucher (already filled for drafts)',
        'Bill photo — upload once, it goes to your Google Drive automatically',
        'Notes — anything you want to remember later',
    ]:
        story.append(Paragraph(f'• {item}', st['body']))

    story.append(PageBreak())

    # ─── Page 3: PIN + Home screen ───
    story.append(Paragraph('02 · Logging in', st['h1']))

    pin_text = Paragraph(
        'Open <b>hnhotels.in/ops/ledger/</b> in your phone browser. First '
        'time, tap <b>Add to Home screen</b> so it behaves like an app.'
        '<br/><br/>Enter PIN: <b>3754</b>'
        '<br/><br/><font color="#8a8a9b">(You don\'t need to tap Enter — once you type the 4th digit, it logs you in automatically.)</font>'
        '<br/><br/><b>Other PINs:</b>'
        '<br/><font color="#8a8a9b">• <b>0305</b> — Nihaf (admin)</font>'
        '<br/><font color="#8a8a9b">• <b>3754</b> — Naveen (CFO) — <b>you</b></font>'
        '<br/><br/><font color="#8a8a9b">Both PINs can do everything — there is no "lesser" role. Pick the one that matches who you are.</font>',
        st['body'],
    )
    data = [[PhoneMock(mode='pin'), pin_text]]
    t = Table(data, colWidths=[75*mm, 100*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING',(0,0), (-1,-1), 10),
    ]))
    story.append(t)

    story.append(PageBreak())

    # ─── Page 4: Home screen ───
    story.append(Paragraph('03 · The home screen', st['h1']))
    home_text = Paragraph(
        '<font color="#e8930c" size="11"><b>Summary cards</b></font><br/>'
        'Three numbers at the top:<br/>'
        '<font color="#8a8a9b">• <b>Pending drafts</b> — how many Tally rows still need your input<br/>'
        '• <b>Final entries</b> — how many you\'ve completed<br/>'
        '• <b>Total Rs.  (final)</b> — sum of everything you\'ve marked final</font>'
        '<br/><br/><font color="#e8930c" size="11"><b>Three tabs</b></font><br/>'
        '• <b>Drafts</b> (default) — Tally-imported rows waiting for you. The number in the chip = what\'s left.<br/>'
        '• <b>Entries</b> — everything you\'ve finalised, grouped by date<br/>'
        '• <b>+ New</b> — add a brand-new expense that isn\'t in the Tally import'
        '<br/><br/><font color="#e8930c" size="11"><b>Filters</b></font><br/>'
        'Brand chips + category dropdown. Tap <b>NCH</b> for NCH drafts, or <b>Unassigned</b> for rows where brand is still blank (you pick HE or NCH).'
        '<br/><br/><font color="#e8930c" size="11"><b>Rows</b></font><br/>'
        'Each row is a Tally voucher. Amber left-border + DRAFT pill = not done yet. The subtitle shows what\'s missing (<i>missing: qty, uom, brand</i>). Tap to open.',
        st['body'],
    )
    data = [[PhoneMock(mode='home'), home_text]]
    t = Table(data, colWidths=[75*mm, 100*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING',(0,0), (-1,-1), 10),
    ]))
    story.append(t)

    story.append(PageBreak())

    # ─── Page 5: Filling a draft ───
    story.append(Paragraph('04 · Filling a Tally draft', st['h1']))
    form_text = Paragraph(
        'When you tap a draft, the form opens <b>pre-filled</b> with everything Tally gave us:'
        '<br/><br/><font color="#8a8a9b">'
        '✓ Date (e.g. 31/03/2026)<br/>'
        '✓ Category (e.g. Salaries)<br/>'
        '✓ Product (e.g. Salary — Somesh)<br/>'
        '✓ Amount (e.g. Rs. 13,500)<br/>'
        '✓ Voucher number</font>'
        '<br/><br/><font color="#e8930c" size="11"><b>You only need to fill:</b></font><br/>'
        '<b>1. Brand</b> — tap NCH / HE / HQ<br/>'
        '<b>2. Quantity</b> — e.g. 1 (salary) or 15 (15 kg of chicken)<br/>'
        '<b>3. UOM</b> — from dropdown (often pre-filled from product default)<br/>'
        '<b>4. Vendor</b> — optional, dropdown or free text<br/>'
        '<b>5. Bill photo</b> — optional but strongly recommended'
        '<br/><br/>Tap <b>Save final</b> when complete. The draft count drops by 1.',
        st['body'],
    )
    data = [[PhoneMock(mode='form'), form_text]]
    t = Table(data, colWidths=[75*mm, 100*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING',(0,0), (-1,-1), 10),
    ]))
    story.append(t)

    story.append(PageBreak())

    # ─── Page 6: Missing product flow ───
    story.append(Paragraph('05 · If the product isn\'t in the list', st['h1']))
    story.append(Paragraph(
        'We pre-seeded <b>208 products</b> based on the Tally chart of '
        'accounts, but you\'ll find things that aren\'t there. No problem — '
        'you can add them right from the entry form.',
        st['body'],
    ))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('Steps:', st['h2']))
    for n, step in [
        ('1', 'Pick the right Category first (e.g. Operations).'),
        ('2', 'Tap <b>+ Add new</b> next to the Product label.'),
        ('3', 'A small modal opens. Type the product name (e.g. <i>Thermocol Sheets</i>).'),
        ('4', 'Pick a default UOM (e.g. <b>pcs</b>). You can always change it later.'),
        ('5', 'Tap <b>Add</b>. The product is now selected in the form. Continue filling.'),
    ]:
        story.append(Paragraph(f'<b>{n}</b> &nbsp; {step}', st['body']))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        'Same flow exists for <b>+ Add Vendor</b> and <b>+ Add UOM</b>. '
        'Anything you add becomes part of the master list and shows up for '
        'all future entries.',
        st['body'],
    ))

    story.append(Spacer(1, 6*mm))
    story.append(Paragraph('06 · Attaching a bill photo', st['h1']))
    story.append(Paragraph(
        'Tap <b>Choose file</b> on the <b>Bill / receipt photo</b> row. On a '
        'phone, this opens the camera. Snap the bill, preview it, then tap '
        '<b>Save final</b>. The photo is automatically uploaded to Google '
        'Drive with a structured name:',
        st['body'],
    ))
    story.append(Spacer(1, 3*mm))
    filename_mock = MockBox(170*mm, 12*mm,
                            text='2026-03-31_LEDGER_NCH_Raw-Materials_Chicken-Purchase_8450_Naveen.jpg',
                            fg=BRAND, bg=SURFACE, border=BRAND_SOFT, font_size=8, bold=False)
    story.append(filename_mock)
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        'So later, when you search Drive, you can instantly tell what any file '
        'is from its name. Photos live in <b>Ledger/YYYY-MM/YYYY-MM-DD/BRAND/</b> '
        'within your Drive.',
        st['body-dim'],
    ))
    story.append(Paragraph(
        '<b>You don\'t need to rename anything.</b> The app does it for you.',
        st['tip'],
    ))

    story.append(PageBreak())

    # ─── Page 7: Save Draft vs Save Final ───
    story.append(Paragraph('07 · Save Draft vs Save Final', st['h1']))

    data = [
        [
            Paragraph(
                '<b><font color="#fbbf24" size="12">SAVE DRAFT</font></b><br/><br/>'
                '<font color="#e4e4ed">Use when you\'re <b>not done</b> yet.</font><br/><br/>'
                '<font color="#8a8a9b">Skips validation — you can leave anything blank.</font><br/><br/>'
                '<font color="#8a8a9b">Still counts toward your 623 drafts. Shows on the Drafts tab until you finalise.</font><br/><br/>'
                '<font color="#8a8a9b">Good for: capturing a bill photo quickly, coming back to fill details later.</font>',
                st['body'],
            ),
            Paragraph(
                '<b><font color="#34d399" size="12">SAVE FINAL</font></b><br/><br/>'
                '<font color="#e4e4ed">Use when <b>all 5 mandatory fields</b> are filled.</font><br/><br/>'
                '<font color="#8a8a9b">Validates: date, brand, category, product, qty &gt; 0, UOM, amount &gt; 0.</font><br/><br/>'
                '<font color="#8a8a9b">If validation fails, you see an error and the entry stays a draft.</font><br/><br/>'
                '<font color="#8a8a9b">Removes the entry from the Drafts tab; adds it to Entries.</font>',
                st['body'],
            ),
        ]
    ]
    t = Table(data, colWidths=[85*mm, 85*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,0), WARN_SOFT),
        ('BACKGROUND', (1,0), (1,0), SUCCESS_SOFT),
        ('BOX',        (0,0), (-1,-1), 0.5, BORDER),
        ('INNERGRID',  (0,0), (-1,-1), 0.5, BORDER),
        ('VALIGN',     (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING',(0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING',(0,0), (-1,-1), 10),
    ]))
    story.append(t)

    story.append(Spacer(1, 8*mm))
    story.append(Paragraph('08 · When you make a mistake', st['h1']))
    story.append(Paragraph(
        '<b>To edit an entry</b> — tap it in the Entries or Drafts tab. The form reopens with everything pre-filled. '
        'Change anything, tap Save again.',
        st['body'],
    ))
    story.append(Paragraph(
        '<b>To delete an entry</b> — open it, then tap the trash (bin) icon at the top right. You\'ll be asked to confirm. '
        'Delete is permanent and only available to admin / CFO PINs.',
        st['body'],
    ))
    story.append(Paragraph(
        '<b>Wrong category on a draft</b> — open the draft, pick the correct category, then pick the correct '
        'product under that category. The system will verify that the product belongs to the category you chose.',
        st['body'],
    ))

    story.append(PageBreak())

    # ─── Page 8: Admin screen ───
    story.append(Paragraph('09 · The Admin page', st['h1']))

    admin_text = Paragraph(
        'Tap <b>Admin</b> in the top-right to edit the master lists.'
        '<br/><br/><font color="#e8930c" size="11"><b>Four sections</b></font><br/>'
        '<font color="#8a8a9b">'
        '<b>Categories</b> — 14 pre-seeded (Raw Materials, Salaries, Utilities, …). Rename, reorder, archive, or add new. Tap a category to expand its products.'
        '<br/><br/><b>UOMs</b> — 25 pre-seeded (kg, ltr, pcs, month, …). Rename or archive. Add new if you need special units (e.g. "sack", "5L can").'
        '<br/><br/><b>Vendors</b> — 17 pre-seeded from Tally narrations. Add new vendors with phone + notes.'
        '<br/><br/><b>Products</b> — flat view of all 208+ products across categories. Useful for searching and bulk rename / archive.'
        '</font>'
        '<br/><br/><font color="#34d399"><b>Archive, don\'t delete.</b> Archiving hides something from the entry form but keeps existing entries intact. Delete is irreversible.</font>',
        st['body'],
    )
    data = [[PhoneMock(mode='admin'), admin_text]]
    t = Table(data, colWidths=[75*mm, 100*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING',(0,0), (-1,-1), 10),
    ]))
    story.append(t)

    story.append(PageBreak())

    # ─── Page 9: Daily workflow ───
    story.append(Paragraph('10 · Your daily workflow (suggested)', st['h1']))
    story.append(Paragraph(
        'A good pace is to clear <b>50–80 drafts a day</b> over 1–2 weeks. '
        'Keep the 623 total in sight — the counter shrinks every time you '
        'Save Final, so you can feel progress.',
        st['body'],
    ))

    steps = [
        ('1', 'Filter',   'Tap <b>Drafts</b>. Set brand filter to <b>NCH</b> first — the earliest 3 weeks are all NCH, no branding ambiguity.'),
        ('2', 'Open',     'Tap the oldest draft at the bottom of the list. Work chronologically — the memory of what each bill was is fresher.'),
        ('3', 'Fill',     'Brand is already NCH (for early Feb rows). Fill qty + UOM + vendor. Attach bill photo if you have one.'),
        ('4', 'Save',     'Tap <b>Save final</b>. The entry moves out of Drafts.'),
        ('5', 'Next',     'The list auto-refreshes. Tap the next row. Repeat.'),
        ('6', 'Switch',   'Once NCH-only period (Feb 3 – Feb 26) is cleared, switch brand filter to <b>Unassigned</b> and do the Feb 27 onward rows where you pick HE vs NCH per expense.'),
    ]
    data = [[Paragraph(n, st['step-num']),
             Paragraph(f'<b>{lbl}</b>', st['body']),
             Paragraph(desc, st['body'])] for n, lbl, desc in steps]
    t = Table(data, colWidths=[12*mm, 22*mm, 136*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LINEBELOW', (0,0), (-1,-2), 0.3, BORDER),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING',(0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING',(0,0), (-1,-1), 6),
    ]))
    story.append(t)

    story.append(Spacer(1, 6*mm))
    story.append(Paragraph('11 · Common questions', st['h1']))

    qa = [
        ('Will anything I enter affect Odoo, Tally, or the live outlets?',
         'No. This is a standalone book. Your entries live only in the ledger database. '
         'They don\'t create POS sales, hr.expense records, or Odoo bills. Nothing leaks.'),
        ('What happens if I enter the same Tally voucher twice?',
         'Drafts are keyed on a unique voucher reference. A second attempt gets ignored — '
         'no duplicates possible.'),
        ('What about the rows I don\'t know how to categorise?',
         'Save them as Draft with the category you\'re unsure about, then discuss with '
         'Nihaf. You can always edit later. Use the <b>Miscellaneous</b> category '
         'as a parking lot for anything truly unclear.'),
        ('What if the real qty or vendor was different from what I guessed?',
         'Just edit the entry — tap it in the Entries tab, change what needs changing, '
         'Save again. Every save updates the <i>updated_at</i> timestamp so there\'s a trail.'),
        ('Can I see totals per brand or category?',
         'Yes — the Summary cards at the top of home show global totals. Filter by brand or '
         'category to see the list for each. For a full breakdown, ask Nihaf to pull the '
         '<b>summary</b> API — returns per-brand and per-category totals within the window.'),
        ('What if I add a product that turns out to be a duplicate?',
         'Archive the duplicate (Admin → Products → edit or archive). All existing entries '
         'keep pointing to it; the only effect is it disappears from future dropdowns.'),
    ]
    for q, a in qa:
        story.append(Paragraph(f'<b>Q. {q}</b>', st['body']))
        story.append(Paragraph(f'A. {a}', st['body-dim']))
        story.append(Spacer(1, 3*mm))

    story.append(PageBreak())

    # ─── Page 10: Closing + contacts ───
    story.append(Spacer(1, 50*mm))
    story.append(Paragraph('One more thing.', st['title']))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        'You asked for <b>zero ambiguity</b>. That\'s why UOM and quantity are '
        'mandatory — without them, Rs. 13,500 could be 1 month of Somesh\'s '
        'salary or 13,500 rupees-worth of salt, and you lose the ability to '
        'answer "how much did we actually buy?" three months from now.',
        st['body'],
    ))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        'The ledger trades <b>speed today</b> (each entry takes 30–60 seconds) '
        'for <b>clarity forever</b>. Once this Feb–Mar period is finalised, '
        'you can pivot, filter, and slice the data any way you want.',
        st['body'],
    ))

    story.append(Spacer(1, 10*mm))
    story.append(Paragraph('If you get stuck', st['h2']))
    story.append(Paragraph('Message Nihaf. Any time.', st['body']))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        'Include a screenshot of the screen + the entry #. He can pull the '
        'record from the DB and tell you what\'s wrong in under a minute.',
        st['body-dim'],
    ))

    # Build
    doc.build(story, onFirstPage=page_bg, onLaterPages=page_bg)
    print(f"Wrote {OUT_PATH}  ({OUT_PATH.stat().st_size // 1024} KB)")


if __name__ == '__main__':
    build()
