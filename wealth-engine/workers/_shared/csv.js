// Minimal CSV parser. Handles quoted fields and commas inside quotes.
export function parseCsv(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') {/* skip */}
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length === headers.length).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

// Unzip ArrayBuffer using DecompressionStream (Workers runtime supports it).
// Bhavcopies are single-file zips — we extract the first file entry.
export async function unzipFirst(buf) {
  const view = new DataView(buf);
  // Local file header signature 0x04034b50
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error('Not a zip');
  const compMethod = view.getUint16(8, true);
  const compSize = view.getUint32(18, true);
  const fileNameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = 30 + fileNameLen + extraLen;
  const compressed = new Uint8Array(buf, dataStart, compSize);
  if (compMethod === 0) {
    return new TextDecoder().decode(compressed);
  }
  if (compMethod === 8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const decompressed = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }
  throw new Error(`Unsupported compression: ${compMethod}`);
}
