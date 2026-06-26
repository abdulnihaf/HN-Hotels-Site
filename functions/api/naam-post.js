/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/naam-post — Organic Social Posting engine (Chat 28).
 *
 * Six-step flow: idea → copy → approve → regenerate → multi-aspect image
 * → one-click FB / IG / GBP post.
 *
 * D1 binding: DB (hn-hiring). R2 binding: NAAM_CREATIVE (public bucket).
 *
 * AUTH:
 *   • Owner mutations use the same public PINs as Naam (0305 / 1918).
 *   • The cron endpoint uses env.NAAM_POST_CRON_TOKEN — never the PIN.
 *
 * DOCTRINE: this file is SEPARATE from /api/naam-actions.js. It does NOT
 * touch Meta Ads spend or campaign status. It only posts organic content.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { callSonnet, parseJsonOutput } from './_lib/anthropic.js';
import { compositeImage } from './_lib/naam-image-compositor.js';

const OWNER_PINS = new Set(['0305', '1918']);
const BRANDS = new Set(['HE', 'NCH']);
const CHANNELS = new Set(['fb', 'ig', 'gbp']);
const ASPECTS = [
  { key: 'ig_11', ratio: '1:1',  width: 1080, height: 1080, label: 'IG feed' },
  { key: 'ig_45', ratio: '4:5',  width: 1080, height: 1350, label: 'IG portrait' },
  { key: 'ig_916', ratio: '9:16', width: 1080, height: 1920, label: 'IG story/reel' },
  { key: 'gbp_43', ratio: '4:3',  width: 1200, height: 900,  label: 'Google post' },
];

const ALLOW_ORIGINS = new Set([
  'https://naam.hnhotels.in',
  'https://hnhotels.in',
  'http://localhost:8789', 'http://127.0.0.1:8789',
]);

function corsHeaders(request) {
  const o = request.headers.get('Origin') || '';
  const allow = (ALLOW_ORIGINS.has(o) || /^https:\/\/[a-z0-9-]+\.(naam-ec8|naam|hn-hotels-site)\.pages\.dev$/.test(o))
    ? o : 'https://naam.hnhotels.in';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}
function json(data, status, request) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders(request) });
}
function nowIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');
}
function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function str(v, max) { return v == null ? null : String(v).slice(0, max || 400); }
function id() { return 'np_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function uint8ArrayToBase64(arr) {
  let s = '';
  const chunk = 65535;
  for (let i = 0; i < arr.length; i += chunk) {
    s += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function ensureTable(DB) {
  await DB.exec("CREATE TABLE IF NOT EXISTS naam_posts (id TEXT PRIMARY KEY, brand TEXT NOT NULL, channels TEXT NOT NULL, idea_source TEXT, idea_json TEXT, copy_json TEXT, image_keys_json TEXT, status TEXT NOT NULL DEFAULT 'idea', guidance_note TEXT, precondition_check TEXT, result_json TEXT, requested_at TEXT NOT NULL, posted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await DB.exec("CREATE INDEX IF NOT EXISTS idx_np_brand_status ON naam_posts(brand, status, created_at DESC)");
  await DB.exec("CREATE INDEX IF NOT EXISTS idx_np_brand_created ON naam_posts(brand, created_at DESC)");
}

function rowOut(r) {
  return {
    id: r.id, brand: r.brand, channels: safeParse(r.channels),
    idea_source: r.idea_source, idea: safeParse(r.idea_json),
    copy: safeParse(r.copy_json), images: safeParse(r.image_keys_json),
    status: r.status, guidance_note: r.guidance_note,
    precondition_check: safeParse(r.precondition_check),
    result: safeParse(r.result_json),
    requested_at: r.requested_at, posted_at: r.posted_at, created_at: r.created_at,
  };
}

function brandVoice(brand) {
  if (brand === 'NCH') {
    return {
      name: 'Nawabi Chai House',
      tokens: 'Chamoisee #AC7E54 · Dark Brown #5C4033 · Gold #D4A44C · Kraft #C8A878 · Wheat #E9D1A9',
      voice: 'warm, unhurried, Shivajinagar evening ritual',
      heroes: ['Irani chai', 'haleem', 'osmania biscuit', 'chai'],
      forbidden: ['1918', 'Hamza', 'biryani as hero'],
      spell: 'SHEEKH',
    };
  }
  return {
    name: 'Hamza Express',
    tokens: 'Brown #733316 · #63361d · #431b0b · #8d5f3a · #a2764b · parchment #E0C8A0',
    voice: 'heritage Dakhni, confident, 1918 Hamza family',
    heroes: ['biryani', 'ghee rice', 'tandoori', 'tikka', 'kabab', 'SHEEKH kebab'],
    forbidden: ['Nawabi', 'Irani chai', 'haleem as hero'],
    spell: 'SHEEKH',
  };
}

function copySystem(brand) {
  const b = brandVoice(brand);
  return `You are the organic social copywriter for ${b.name}.
Brand voice: ${b.voice}. Hero words: ${b.heroes.join(', ')}.
HARD RULES:
- NEVER use these words: ${b.forbidden.join(', ')}.
- Spell kebab as "${b.spell}" everywhere.
- ONE clear CTA per channel. No multiple CTAs.
- Hashtags must be channel-appropriate (IG gets 8-12; FB gets 3-5; GBP gets 0-2).
- IG: "hook" on its own first line; "caption" is the body ONLY (do not repeat the hook or CTA or hashtags in it); then CTA line; then hashtags.
- FB: "hook" as the opening; "caption" is the body ONLY (do not repeat hook/CTA/hashtags); one CTA; few hashtags.
- GBP post: short summary (max 1500 chars), one CTA, no heavy hashtags.
- Do not invent offers, prices, or timings. Use only what the idea provides.
Output ONLY valid JSON in this exact shape:
{
  "fb": {"caption":"...","hook":"...","cta":"...","hashtags":"..."},
  "ig": {"caption":"...","hook":"...","cta":"...","hashtags":"..."},
  "gbp":{"summary":"...","cta":"..."}
}`;
}

function copyPrompt(brand, idea, guidance) {
  const b = brandVoice(brand);
  const parts = [];
  parts.push(`Brand: ${b.name}`);
  parts.push(`Theme: ${idea.theme || ''}`);
  if (idea.occasion) parts.push(`Occasion: ${idea.occasion}`);
  if (idea.item) parts.push(`Hero item: ${idea.item}`);
  if (idea.angle) parts.push(`Angle: ${idea.angle}`);
  if (idea.reference_image) parts.push(`Reference image: ${idea.reference_image}`);
  if (guidance) parts.push(`Owner guidance for this regeneration: ${guidance}`);
  parts.push(`Channels: ${(idea.channels || []).join(', ')}`);
  return parts.join('\n');
}

async function generateCopy(env, brand, idea, guidance) {
  const system = copySystem(brand);
  const prompt = copyPrompt(brand, idea, guidance);
  const res = await callSonnet(env, {
    system, prompt, max_tokens: 800,
    purpose: 'naam-post-copy', worker: 'naam-post',
  });
  const parsed = parseJsonOutput(res.text);
  if (!parsed || !parsed.ig || !parsed.fb || !parsed.gbp) {
    throw new Error('copy JSON shape invalid');
  }
  return { copy: parsed, raw: res.text, usage: res.usage, cost_paise: res.cost_paise };
}

function imagePrompt(brand, idea, aspect) {
  const b = brandVoice(brand);
  const item = idea.item || idea.theme || 'hero dish';
  const angle = idea.angle || 'top-down';
  const occasion = idea.occasion ? `, ${idea.occasion}` : '';
  const ref = idea.reference_image ? ` Match the lighting and plating of ${idea.reference_image}.` : '';
  return `Realistic food photography of ${b.name}: ${item}${occasion}. Shot ${angle}, aspect ratio ${aspect.ratio}, soft natural window light, warm ${brand === 'NCH' ? 'kraft and gold' : 'brown and parchment'} tones, appetizing, no logos, no text, no watermark, no founder face, no brand emblem. One focal dish, shallow depth of field, clean background.${ref}`;
}

async function generateImageBuffer(env, brand, idea, aspect) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const prompt = imagePrompt(brand, idea, aspect);
  // Primary: Gemini flash-image (square, photo-realistic). Imagen-3 aspect-aware
  // is a future upgrade when the model name is confirmed on this key.
  const model = 'gemini-3.1-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    signal: AbortSignal.timeout(90000),
  });
  const d = await r.json();
  if (!r.ok) {
    throw new Error(`Gemini image ${r.status}: ${d.error?.message || JSON.stringify(d).slice(0, 200)}`);
  }
  let b64 = null;
  if (d.predictions && d.predictions[0]?.bytesBase64Encoded) {
    b64 = d.predictions[0].bytesBase64Encoded;
  } else {
    for (const cand of (d.candidates || [])) {
      for (const part of (cand.content?.parts || [])) {
        const inline = part.inlineData || part.inline_data;
        if (inline && inline.data) { b64 = inline.data; break; }
      }
      if (b64) break;
    }
  }
  if (!b64) throw new Error('Gemini image response had no image data');
  const buf = base64ToUint8Array(b64);
  return { buffer: buf, mime: 'image/png' };
}

function publicImageUrl(env, brand, postId, aspectKey) {
  // Caller configures either a public CDN base or the /api/naam-creative-asset proxy.
  const base = (env.NAAM_CREATIVE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const key = `naam/${brand.toLowerCase()}/${postId}/${aspectKey}.png`;
  // Proxy form: https://hnhotels.in/api/naam-creative-asset?key=naam/...
  return base.includes('?') ? `${base}${key}` : `${base}/${key}`;
}

async function renderImages(env, row) {
  const idea = safeParse(row.idea_json) || {};
  const copy = safeParse(row.copy_json) || {};
  const hook = copy.ig?.hook || copy.fb?.hook || idea.item || idea.theme || '';
  const images = {};
  const preconditions = [];
  const r2 = env.NAAM_CREATIVE;
  const publicBase = (env.NAAM_CREATIVE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!r2 || !publicBase) {
    preconditions.push({ ok: false, reason: 'NAAM_CREATIVE R2 bucket or public URL not configured' });
    for (const aspect of ASPECTS) images[aspect.key] = { error: 'R2/public URL not configured' };
    return { images, preconditions };
  }
  for (const aspect of ASPECTS) {
    try {
      const { buffer: rawBuffer } = await generateImageBuffer(env, row.brand, idea, aspect);
      const framed = await compositeImage(env, {
        brand: row.brand,
        width: aspect.width,
        height: aspect.height,
        imageBuffer: rawBuffer,
        hook,
      });
      const key = `naam/${row.brand.toLowerCase()}/${row.id}/${aspect.key}.png`;
      await r2.put(key, framed, { httpMetadata: { contentType: 'image/png' } });
      images[aspect.key] = publicImageUrl(env, row.brand, row.id, aspect.key);
    } catch (e) {
      images[aspect.key] = { error: e.message };
      preconditions.push({ ok: false, aspect: aspect.key, reason: e.message });
    }
  }
  return { images, preconditions };
}

async function metaAccessToken(env, brand) {
  return env[`${brand}_META_ACCESS_TOKEN_PAGE_ACCESS_TOKEN`] || null;
}
function metaPageId(env, brand) {
  return env[`${brand}_META_FACEBOOK_FB_PAGE_ID_GRAPH_API`] || null;
}
function metaIgId(env, brand) {
  return env[`${brand}_META_INSTAGRAM_IG_BUSINESS_ACCOUNT_ID`] || null;
}
function graphVersion(env) {
  return env.HN_HOTELS_SHARED_META_GRAPH_API_VERSION || 'v21.0';
}

async function metaTokenHealth(env, brand) {
  const token = await metaAccessToken(env, brand);
  const userToken = env.HN_HOTELS_SHARED_META_BUSINESS_META_USER_TOKEN;
  if (!token || !userToken) return { ok: false, reason: 'page or user token missing' };
  try {
    const r = await fetch(`https://graph.facebook.com/${graphVersion(env)}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(userToken)}`);
    const d = await r.json();
    return { ok: r.ok && d.data?.is_valid, data: d.data, error: d.error };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function postFacebook(env, brand, copy, imageUrl) {
  const token = await metaAccessToken(env, brand);
  const pageId = metaPageId(env, brand);
  if (!token || !pageId) return { ok: false, error: 'FB token or page id missing' };
  const url = imageUrl
    ? `https://graph.facebook.com/${graphVersion(env)}/${pageId}/photos`
    : `https://graph.facebook.com/${graphVersion(env)}/${pageId}/feed`;
  const body = imageUrl
    ? { url: imageUrl, caption: copy.fb.caption, access_token: token }
    : { message: copy.fb.caption, access_token: token };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  return { ok: r.ok && !d.error, post_id: d.id, error: d.error?.message, payload: body, response: d };
}

async function postInstagram(env, brand, copy, imageUrl) {
  const token = await metaAccessToken(env, brand);
  const igId = metaIgId(env, brand);
  if (!token || !igId) return { ok: false, error: 'IG token or business account id missing' };
  if (!imageUrl || !imageUrl.startsWith('https://')) {
    return { ok: false, error: 'IG requires a public https image URL' };
  }
  const caption = `${copy.ig.hook || ''}\n\n${copy.ig.caption || ''}\n\n${copy.ig.cta || ''}\n\n${copy.ig.hashtags || ''}`.trim();
  const create = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  const cd = await create.json();
  if (!create.ok || cd.error) return { ok: false, error: cd.error?.message, response: cd };
  const creationId = cd.id;
  // poll status
  let status = '';
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const sr = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    const sd = await sr.json();
    status = sd.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR') return { ok: false, error: 'IG container failed', response: sd };
  }
  if (status !== 'FINISHED') return { ok: false, error: 'IG container did not finish in time', status };
  const pub = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  const pd = await pub.json();
  return { ok: pub.ok && !pd.error, post_id: pd.id, error: pd.error?.message, response: pd };
}

async function getGbpAccessToken(env) {
  const required = ['GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'GBP_REFRESH_TOKEN'];
  for (const k of required) if (!env[k]) throw new Error(`GBP secret ${k} missing`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GBP_CLIENT_ID,
      client_secret: env.GBP_CLIENT_SECRET,
      refresh_token: env.GBP_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`GBP OAuth failed: ${JSON.stringify(d).slice(0, 200)}`);
  return d.access_token;
}

function gbpLocation(env, brand) {
  return env[`${brand}_GBP_LOCATION_NAME`] || null;
}
function gbpAccount(env) {
  return env.GBP_ACCOUNT_NAME || null;
}

async function postGbp(env, brand, copy, imageUrl) {
  const loc = gbpLocation(env, brand);
  const acct = gbpAccount(env);
  if (!loc || !acct) return { ok: false, error: 'GBP location or account missing' };
  let token;
  try { token = await getGbpAccessToken(env); }
  catch (e) { return { ok: false, error: e.message }; }
  const body = {
    languageCode: 'en',
    summary: copy.gbp.summary,
    callToAction: { actionType: 'ORDER' },
    media: imageUrl ? [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }] : [],
  };
  const r = await fetch(`https://mybusiness.googleapis.com/v4/${acct}/${loc}/localPosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  return { ok: r.ok && !d.error, post_id: d.name, error: d.error?.message, payload: body, response: d };
}

function chooseImageUrl(images, channel) {
  const map = safeParse(images) || {};
  if (channel === 'ig') return map.ig_11 || map.ig_45 || map.ig_916 || null;
  if (channel === 'fb') return map.ig_11 || null;
  if (channel === 'gbp') return map.gbp_43 || map.ig_11 || null;
  return null;
}

async function publishPost(env, row, dryRun) {
  const copy = safeParse(row.copy_json) || {};
  const images = safeParse(row.image_keys_json) || {};
  const channels = safeParse(row.channels) || [];
  const result = {};
  const payloads = {};
  let allOk = true;

  if (dryRun) {
    for (const ch of channels) {
      const imageUrl = chooseImageUrl(images, ch);
      let text = '';
      if (ch === 'gbp') text = copy.gbp?.summary || '';
      else if (ch === 'ig') text = `${copy.ig?.hook || ''}\n\n${copy.ig?.caption || ''}\n\n${copy.ig?.cta || ''}\n\n${copy.ig?.hashtags || ''}`.trim();
      else text = `${copy.fb?.hook || ''}\n\n${copy.fb?.caption || ''}\n\n${copy.fb?.cta || ''}\n\n${copy.fb?.hashtags || ''}`.trim();
      payloads[ch] = {
        channel: ch,
        image_url: imageUrl,
        caption_or_summary: text,
      };
      result[ch] = { ok: true, dry_run: true, payload: payloads[ch] };
    }
    return { ok: true, dry_run: true, result };
  }

  for (const ch of channels) {
    const imageUrl = chooseImageUrl(images, ch);
    if (ch === 'fb') result.fb = await postFacebook(env, row.brand, copy, imageUrl);
    else if (ch === 'ig') result.ig = await postInstagram(env, row.brand, copy, imageUrl);
    else if (ch === 'gbp') result.gbp = await postGbp(env, row.brand, copy, imageUrl);
    else result[ch] = { ok: false, error: 'unknown channel' };
    if (!result[ch].ok) allOk = false;
  }
  return { ok: allOk, result };
}

async function createDraft(DB, env, body) {
  const brand = String(body.brand || '').toUpperCase();
  if (!BRANDS.has(brand)) return { status: 400, data: { ok: false, error: 'brand must be HE|NCH' } };
  const idea = body.idea || {};
  const channels = Array.isArray(body.channels)
    ? body.channels.map(c => String(c).toLowerCase()).filter(c => CHANNELS.has(c))
    : ['fb', 'ig', 'gbp'];
  if (channels.length === 0) return { status: 400, data: { ok: false, error: 'channels must be fb|ig|gbp' } };
  const { copy } = await generateCopy(env, brand, idea, null);
  const at = nowIST();
  const rowId = id();
  await DB.prepare(`INSERT INTO naam_posts
    (id, brand, channels, idea_source, idea_json, copy_json, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, 'drafted', ?)`)
    .bind(rowId, brand, JSON.stringify(channels), str(body.idea_source, 120),
          JSON.stringify(idea), JSON.stringify(copy), at)
    .run();
  const saved = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(rowId).first();
  return { status: 200, data: { ok: true, post: rowOut(saved) } };
}

async function regenerateCopy(DB, env, body) {
  const postId = str(body.id, 80);
  if (!postId) return { status: 400, data: { ok: false, error: 'id required' } };
  const row = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  if (!row) return { status: 404, data: { ok: false, error: 'post not found' } };
  const idea = safeParse(row.idea_json) || {};
  const guidance = str(body.guidance, 2000);
  const { copy } = await generateCopy(env, row.brand, idea, guidance);
  await DB.prepare(`UPDATE naam_posts SET copy_json = ?, guidance_note = ?, status = 'drafted', image_keys_json = NULL WHERE id = ?`)
    .bind(JSON.stringify(copy), guidance, postId).run();
  const saved = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  return { status: 200, data: { ok: true, post: rowOut(saved) } };
}

async function approvePost(DB, body) {
  const postId = str(body.id, 80);
  if (!postId) return { status: 400, data: { ok: false, error: 'id required' } };
  const row = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  if (!row) return { status: 404, data: { ok: false, error: 'post not found' } };
  await DB.prepare(`UPDATE naam_posts SET status = 'approved', requested_at = ? WHERE id = ?`)
    .bind(nowIST(), postId).run();
  const saved = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  return { status: 200, data: { ok: true, post: rowOut(saved) } };
}

async function renderPost(DB, env, body) {
  const postId = str(body.id, 80);
  if (!postId) return { status: 400, data: { ok: false, error: 'id required' } };
  const row = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  if (!row) return { status: 404, data: { ok: false, error: 'post not found' } };
  await DB.prepare(`UPDATE naam_posts SET status = 'rendering' WHERE id = ?`).bind(postId).run();
  const { images, preconditions } = await renderImages(env, row);
  const ok = Object.values(images).some(v => typeof v === 'string' && v.startsWith('http'));
  const status = ok ? 'rendered' : 'failed';
  const pc = { ok, checks: preconditions, rendered_at: nowIST() };
  await DB.prepare(`UPDATE naam_posts SET image_keys_json = ?, precondition_check = ?, status = ? WHERE id = ?`)
    .bind(JSON.stringify(images), JSON.stringify(pc), status, postId).run();
  const saved = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  return { status: 200, data: { ok: status === 'rendered', post: rowOut(saved) } };
}

async function publishAction(DB, env, body) {
  const postId = str(body.id, 80);
  let dryRun = !!body.dry_run;
  if (!postId) return { status: 400, data: { ok: false, error: 'id required' } };
  const row = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(postId).first();
  if (!row) return { status: 404, data: { ok: false, error: 'post not found' } };
  // Live posting is gated by env.POSTING_LIVE until the owner explicitly enables it.
  const liveEnabled = env.POSTING_LIVE === 'true';
  if (!dryRun && !liveEnabled) dryRun = true;
  if (!dryRun && row.status !== 'rendered') {
    return { status: 409, data: { ok: false, error: `post status is ${row.status}; render first` } };
  }
  const { ok, result } = await publishPost(env, row, dryRun);
  const status = dryRun ? row.status : (ok ? 'posted' : 'failed');
  const postedAt = dryRun ? null : (ok ? nowIST() : null);
  if (!dryRun) {
    await DB.prepare(`UPDATE naam_posts SET result_json = ?, status = ?, posted_at = COALESCE(?, posted_at) WHERE id = ?`)
      .bind(JSON.stringify(result), status, postedAt, postId).run();
  }
  return { status: 200, data: { ok, dry_run: dryRun, live_enabled: liveEnabled, result, status } };
}

async function cronAction(DB, env, body, url) {
  const token = url.searchParams.get('token') || body.token;
  if (!env.NAAM_POST_CRON_TOKEN || token !== env.NAAM_POST_CRON_TOKEN) {
    return { status: 401, data: { ok: false, error: 'cron token invalid' } };
  }
  const rows = await DB.prepare(`SELECT * FROM naam_posts WHERE status = 'approved' ORDER BY requested_at ASC LIMIT 5`).all();
  const results = [];
  for (const row of rows.results || []) {
    let step = '';
    try {
      if (!row.image_keys_json) {
        step = 'render';
        await DB.prepare(`UPDATE naam_posts SET status = 'rendering' WHERE id = ?`).bind(row.id).run();
        const { images, preconditions } = await renderImages(env, row);
        const ok = Object.values(images).some(v => typeof v === 'string' && v.startsWith('http'));
        const status = ok ? 'rendered' : 'failed';
        await DB.prepare(`UPDATE naam_posts SET image_keys_json = ?, precondition_check = ?, status = ? WHERE id = ?`)
          .bind(JSON.stringify(images), JSON.stringify({ ok, checks: preconditions }), status, row.id).run();
        if (!ok) { results.push({ id: row.id, ok: false, step, error: 'render failed' }); continue; }
      }
      step = 'publish';
      const fresh = await DB.prepare('SELECT * FROM naam_posts WHERE id = ?').bind(row.id).first();
      const liveEnabled = env.POSTING_LIVE === 'true';
      const pub = await publishPost(env, fresh, !liveEnabled);
      const status = pub.ok ? (liveEnabled ? 'posted' : 'approved') : 'failed';
      await DB.prepare(`UPDATE naam_posts SET result_json = ?, status = ?, posted_at = ? WHERE id = ?`)
        .bind(JSON.stringify(pub.result), status, (pub.ok && liveEnabled) ? nowIST() : null, row.id).run();
      results.push({ id: row.id, ok: pub.ok, step, live_enabled: liveEnabled, result: pub.result });
    } catch (e) {
      results.push({ id: row.id, ok: false, step, error: e.message });
    }
  }
  return { status: 200, data: { ok: true, processed: results.length, results } };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });
  const DB = env.DB;
  if (!DB) return json({ ok: false, error: 'DB not configured' }, 500, request);

  try {
    await ensureTable(DB);
    const url = new URL(request.url);

    // ── READS ────────────────────────────────────────────────
    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || 'list';
      if (action === 'list') {
        const brand = (url.searchParams.get('brand') || '').toUpperCase();
        const status = url.searchParams.get('status') || '';
        let q = 'SELECT * FROM naam_posts WHERE 1=1';
        const params = [];
        if (BRANDS.has(brand)) { q += ' AND brand = ?'; params.push(brand); }
        if (status) { q += ' AND status = ?'; params.push(status); }
        q += ' ORDER BY created_at DESC LIMIT 100';
        const rows = await DB.prepare(q).bind(...params).all();
        return json({ ok: true, posts: (rows.results || []).map(rowOut) }, 200, request);
      }
      if (action === 'health') {
        const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();
        const meta = await metaTokenHealth(env, brand);
        return json({ ok: true, brand, meta }, 200, request);
      }
      return json({ ok: false, error: 'unknown GET action' }, 400, request);
    }

    // ── WRITES ───────────────────────────────────────────────
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405, request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || url.searchParams.get('action') || '');

    // cron is token-gated, not PIN-gated
    if (action === 'cron') {
      const { status, data } = await cronAction(DB, env, body, url);
      return json(data, status, request);
    }

    const pin = String(body.pin || '').trim();
    if (!OWNER_PINS.has(pin)) return json({ ok: false, error: 'PIN not recognised' }, 401, request);

    let res;
    switch (action) {
      case 'create_draft': res = await createDraft(DB, env, body); break;
      case 'regenerate':   res = await regenerateCopy(DB, env, body); break;
      case 'approve':      res = await approvePost(DB, body); break;
      case 'render':       res = await renderPost(DB, env, body); break;
      case 'publish':      res = await publishAction(DB, env, body); break;
      default: return json({ ok: false, error: `unknown action: ${action}` }, 400, request);
    }
    return json(res.data, res.status, request);
  } catch (err) {
    console.error('naam-post error:', err);
    return json({ ok: false, error: err.message }, 500, request);
  }
}
