/**
 * HN Hotels — Expense Photo Drop
 * ================================
 *
 * This is a Google Apps Script webhook that receives photo uploads from the
 * Cloudflare Worker (/api/spend) and files them into Google Drive with the
 * folder structure:
 *
 *   HN Hotels - Expenses /
 *     2026-04 /
 *       2026-04-03 /
 *         HE /
 *           2026-04-03_Utility_HE_BESCOM-Electricity_3500_Noor.jpg
 *           2026-04-03_Rent_HE_Shop-Rent_45000_Nihaf.jpg
 *         NCH /
 *           ...
 *
 * Month + day + company subfolders are auto-created on demand.
 *
 * ONE-TIME DEPLOY STEPS
 * ---------------------
 * 1. Go to https://script.google.com → New project
 * 2. Replace Code.gs content with THIS ENTIRE FILE
 * 3. Click Deploy → New deployment
 *      Type: Web app
 *      Description: HN Expense Photo Webhook
 *      Execute as: Me (nihafwork@gmail.com)
 *      Who has access: Anyone
 * 4. Click Deploy → authorize → copy the Web app URL
 *      (looks like https://script.google.com/macros/s/XXXXXX/exec)
 * 5. Add it as a Cloudflare Pages secret:
 *      Dashboard → Workers & Pages → hnhotels → Settings →
 *        Environment variables → Add: DRIVE_WEBHOOK_URL = <the URL>
 * 6. Redeploy Cloudflare Pages (or wait for next push).
 *
 * That's it. Every photo uploaded via /ops/expense/ or /ops/purchase/
 * will land in the right Drive folder automatically.
 */

const ROOT_FOLDER_ID = '1BuX7AfCp3T2R2Sw4N6jFYxQ-TFBbSZsP'; // HN Hotels - Expenses

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ success: false, error: 'no body' });
    }
    const body = JSON.parse(e.postData.contents);
    const {
      date, company, category, product,
      amount, recorded_by, filename,
      data_b64, mimetype,
    } = body;

    if (!date || !company || !data_b64) {
      return json({ success: false, error: 'date, company, data_b64 are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ success: false, error: 'date must be YYYY-MM-DD' });
    }

    const [year, month] = date.split('-');
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const monthFolder = getOrCreate(root, `${year}-${month}`);
    const dayFolder = getOrCreate(monthFolder, date);
    const companyFolder = getOrCreate(dayFolder, String(company).toUpperCase());

    const niceName = filename || buildName(date, category, company, product, amount, recorded_by);
    const bytes = Utilities.base64Decode(data_b64);
    const blob = Utilities.newBlob(bytes, mimetype || 'image/jpeg', sanitize(niceName));
    const file = companyFolder.createFile(blob);

    return json({
      success: true,
      file_id: file.getId(),
      view_url: file.getUrl(),
      path: `HN Hotels - Expenses/${year}-${month}/${date}/${String(company).toUpperCase()}/${niceName}`,
    });
  } catch (err) {
    return json({ success: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json({ status: 'ok', purpose: 'HN Expense Photo Webhook', usage: 'POST JSON with {date, company, category, product, amount, recorded_by, filename, mimetype, data_b64}' });
}

function getOrCreate(parent, name) {
  const iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function buildName(date, category, company, product, amount, recorded_by) {
  const parts = [
    date,
    sanitizePart(category || 'expense'),
    String(company || '').toUpperCase(),
    sanitizePart(product || 'misc', 40),
    amount ? String(Math.round(Number(amount))) : '0',
    sanitizePart(recorded_by || 'unknown', 20),
  ].filter(Boolean);
  return parts.join('_') + '.jpg';
}

function sanitizePart(s, max) {
  const out = String(s)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[,()]/g, '');
  return max ? out.substring(0, max) : out;
}

function sanitize(name) {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').substring(0, 200);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test from the Apps Script editor (Run > test):
 * This creates a tiny test file in today's folder.
 */
function test() {
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const fake = Utilities.base64Encode(Utilities.newBlob('test photo').getBytes());
  const res = doPost({ postData: { contents: JSON.stringify({
    date: today, company: 'HE', category: 'Test',
    product: 'Sanity check', amount: 1, recorded_by: 'script',
    mimetype: 'text/plain', data_b64: fake,
  }) } });
  Logger.log(res.getContent());
}
