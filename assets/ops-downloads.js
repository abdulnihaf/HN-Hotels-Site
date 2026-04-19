/* ═══════════════════════════════════════════════════════════════════
 * HN Ops — shared download helpers
 * Usage (in any /ops/* page):
 *   <script src="xlsx.full.min.js"></script>
 *   <script src="jspdf.umd.min.js"></script>
 *   <script src="jspdf.plugin.autotable.min.js"></script>
 *   <script src="/assets/ops-downloads.js" defer></script>
 *   <button onclick="openDownloadMenu('expense')">⬇ Download</button>
 *
 * Pulls structure + data from /api/spend and generates PDF/XLSX client-side.
 * No server rendering — Cloudflare stays cheap.
 * ═══════════════════════════════════════════════════════════════════ */

(function () {
  const API = '/api/spend';
  const fmtDate = d => new Date(d || Date.now()).toISOString().slice(0, 10);

  // ── Modal UI ─────────────────────────────────────────────────────
  function openDownloadMenu(context) {
    context = context || 'all';
    // inject if not present
    let modal = document.getElementById('_dl-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = '_dl-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `
        <div class="modal-card" style="max-width: 460px;">
          <h3 style="margin-top: 0;">Download</h3>
          <p class="sub" style="margin-bottom: 16px;">Export the full system structure or recent data records.</p>

          <div style="margin-bottom: 8px; font-size: 11px; color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.5px;">Structure (reference)</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
            <button class="btn btn-ghost btn-sm" onclick="downloadStructure('pdf')">📄 PDF</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadStructure('xlsx')">📊 XLSX</button>
          </div>

          <div style="margin-bottom: 8px; font-size: 11px; color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.5px;">Recent data (last 30 days)</div>
          <div class="row">
            <label>Date range</label>
            <div style="display: flex; gap: 6px;">
              <input id="_dl-from" type="date" style="flex: 1;">
              <input id="_dl-to" type="date" style="flex: 1;">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
            <button class="btn btn-ghost btn-sm" onclick="downloadData('expense','pdf')">Expenses PDF</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('expense','xlsx')">Expenses XLSX</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('po','pdf')">POs PDF</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('po','xlsx')">POs XLSX</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('bill','pdf')">Bills PDF</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('bill','xlsx')">Bills XLSX</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('vendor','xlsx')">Vendors XLSX</button>
            <button class="btn btn-ghost btn-sm" onclick="downloadData('product','xlsx')">Products XLSX</button>
          </div>
          <div id="_dl-status" class="sub" style="margin: 8px 0; min-height: 18px;"></div>
          <button class="btn btn-ghost btn-full" onclick="closeDownloadMenu()">Close</button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) closeDownloadMenu(); });
    }
    // Default date range = last 30 days
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86400000);
    document.getElementById('_dl-from').value = fmtDate(from);
    document.getElementById('_dl-to').value = fmtDate(to);
    document.getElementById('_dl-status').textContent = '';
    modal.classList.remove('hidden');
  }
  window.openDownloadMenu = openDownloadMenu;
  window.closeDownloadMenu = () => document.getElementById('_dl-modal')?.classList.add('hidden');

  function setStatus(msg) {
    const el = document.getElementById('_dl-status');
    if (el) el.textContent = msg;
  }

  // ── API ──────────────────────────────────────────────────────────
  async function fetchStructure() {
    const r = await fetch(`${API}?action=export-structure`).then(x => x.json());
    if (!r.success) throw new Error(r.error || 'Structure fetch failed');
    return r;
  }
  async function fetchData(type, from, to) {
    const url = `${API}?action=export-data&type=${type}&from=${from}&to=${to}`;
    const r = await fetch(url).then(x => x.json());
    if (!r.success) throw new Error(r.error || `${type} fetch failed`);
    return r;
  }

  // ── STRUCTURE DOWNLOADS ──────────────────────────────────────────
  window.downloadStructure = async function (format) {
    try {
      setStatus('Fetching structure…');
      const s = await fetchStructure();
      if (format === 'xlsx') buildStructureXLSX(s);
      else buildStructurePDF(s);
      setStatus('✓ Downloaded');
    } catch (e) {
      setStatus('⚠ ' + e.message);
    }
  };

  function buildStructureXLSX(s) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Categories overview
    const catRows = [['Cat #', 'Label', 'Backend', 'Parent category', '# products', 'Description']];
    s.categories.forEach(c => catRows.push([c.id, c.label, c.backend, c.parent_name || '—', c.products.length, c.desc || '']));
    const wsCat = XLSX.utils.aoa_to_sheet(catRows);
    wsCat['!cols'] = [{ wch: 6 }, { wch: 32 }, { wch: 18 }, { wch: 32 }, { wch: 10 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsCat, 'Categories');

    // Sheet 2+: one per category with products
    s.categories.forEach(c => {
      if (!c.products?.length) return;
      const rows = [['Code', 'Product name', 'Odoo id']];
      c.products.forEach(p => rows.push([p.code || '', p.name, p.id]));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 16 }, { wch: 52 }, { wch: 10 }];
      const sheetName = `Cat${c.id}-${c.label.replace(/[\\/:*?[\]]/g, '').slice(0, 24)}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // Sheet: Vendors
    const vRows = [['Odoo id', 'Name', 'Phone', 'Email']];
    s.vendors.forEach(v => vRows.push([v.id, v.name, v.phone || '', v.email || '']));
    const wsV = XLSX.utils.aoa_to_sheet(vRows);
    wsV['!cols'] = [{ wch: 8 }, { wch: 40 }, { wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsV, 'Vendors');

    // Sheet: Payment methods
    const pmRows = [['Key', 'Label']];
    s.payment_methods.forEach(p => pmRows.push([p.key, p.label]));
    const wsPM = XLSX.utils.aoa_to_sheet(pmRows);
    XLSX.utils.book_append_sheet(wb, wsPM, 'Payment methods');

    // Sheet: PIN scope
    const pinRows = [['PIN', 'Name', 'Role', 'Brands', 'Visible categories']];
    s.pin_scope_summary.forEach(p => pinRows.push([p.pin, p.name, p.role, (p.brands || []).join(' / '),
      Array.isArray(p.cats) ? p.cats.join(', ') : p.cats]));
    const wsPIN = XLSX.utils.aoa_to_sheet(pinRows);
    wsPIN['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsPIN, 'PINs');

    XLSX.writeFile(wb, `HN-Ops-Structure-${fmtDate()}.xlsx`);
  }

  function buildStructurePDF(s) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold').setFontSize(16);
    doc.text('HN Hotels — Ops Structure', 40, 44);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120);
    doc.text(`Generated ${s.generated_at?.slice(0, 16) || fmtDate()} · Root: ${s.root_category?.name || 'n/a'} · ${s.categories.length} categories · ${s.vendors.length} vendors`, 40, 60);
    doc.setTextColor(0);

    // Category summary table
    doc.autoTable({
      startY: 80,
      head: [['#', 'Category', 'Backend', 'Parent in Odoo', '# products']],
      body: s.categories.map(c => [c.id, `${c.emoji || ''} ${c.label}`, c.backend, c.parent_name || '—', c.products.length]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [12, 12, 20], textColor: [232, 147, 12] },
    });

    // Per-category product tables
    s.categories.forEach(c => {
      if (!c.products?.length) return;
      if (doc.lastAutoTable.finalY > 700) doc.addPage();
      doc.setFont('helvetica', 'bold').setFontSize(11);
      doc.text(`${c.emoji || ''} ${c.label}  (${c.products.length} products)`, 40, doc.lastAutoTable.finalY + 24);
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 32,
        head: [['Code', 'Product']],
        body: c.products.slice(0, 200).map(p => [p.code || '—', p.name]),
        styles: { fontSize: 7, cellPadding: 3 },
        headStyles: { fillColor: [22, 22, 31], textColor: [232, 147, 12] },
      });
    });

    // Vendors
    doc.addPage();
    doc.setFont('helvetica', 'bold').setFontSize(14);
    doc.text(`Vendors (${s.vendors.length})`, 40, 44);
    doc.autoTable({
      startY: 60,
      head: [['#', 'Name', 'Phone', 'Email']],
      body: s.vendors.map(v => [v.id, v.name, v.phone || '—', v.email || '—']),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [22, 22, 31], textColor: [232, 147, 12] },
    });

    // PINs
    if (s.pin_scope_summary?.length) {
      doc.addPage();
      doc.setFont('helvetica', 'bold').setFontSize(14);
      doc.text(`PIN Scope (${s.pin_scope_summary.length} users)`, 40, 44);
      doc.autoTable({
        startY: 60,
        head: [['PIN', 'Name', 'Role', 'Brands', 'Visible cats']],
        body: s.pin_scope_summary.map(p => [p.pin, p.name, p.role, (p.brands || []).join(' / '),
          Array.isArray(p.cats) ? p.cats.join(', ') : p.cats]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 22, 31], textColor: [232, 147, 12] },
      });
    }

    doc.save(`HN-Ops-Structure-${fmtDate()}.pdf`);
  }

  // ── DATA DOWNLOADS ───────────────────────────────────────────────
  window.downloadData = async function (type, format) {
    try {
      const from = document.getElementById('_dl-from').value || fmtDate(Date.now() - 30 * 86400000);
      const to   = document.getElementById('_dl-to').value   || fmtDate();
      setStatus(`Fetching ${type}…`);
      const d = await fetchData(type, from, to);
      if (!d.rows?.length) { setStatus(`No ${type} records in ${from} → ${to}`); return; }
      if (format === 'xlsx') buildDataXLSX(type, d);
      else buildDataPDF(type, d);
      setStatus(`✓ Downloaded ${d.rows.length} ${type} records`);
    } catch (e) {
      setStatus('⚠ ' + e.message);
    }
  };

  // Generic row flattening for XLSX
  function flattenOdooRow(r) {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v) && v.length === 2) out[k] = v[1]; // many2one → label
      else out[k] = v;
    }
    return out;
  }

  function buildDataXLSX(type, d) {
    const rows = d.rows.map(flattenOdooRow);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type);
    XLSX.writeFile(wb, `HN-${type}-${d.from || ''}-to-${d.to || ''}-${fmtDate()}.xlsx`.replace('--', '-'));
  }

  function buildDataPDF(type, d) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    doc.setFont('helvetica', 'bold').setFontSize(14);
    doc.text(`HN Hotels — ${type.toUpperCase()} records`, 40, 44);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120);
    doc.text(`${d.from || '—'} → ${d.to || '—'} · ${d.rows.length} records`, 40, 60);
    doc.setTextColor(0);

    const rows = d.rows.map(flattenOdooRow);
    const cols = Object.keys(rows[0] || {});
    const head = [cols];
    const body = rows.map(r => cols.map(c => r[c] == null ? '' : String(r[c]).slice(0, 60)));

    doc.autoTable({
      startY: 78,
      head, body,
      styles: { fontSize: 6, cellPadding: 2 },
      headStyles: { fillColor: [12, 12, 20], textColor: [232, 147, 12], fontSize: 6 },
    });
    doc.save(`HN-${type}-${d.from || ''}-to-${d.to || ''}.pdf`.replace('--', '-'));
  }
})();
