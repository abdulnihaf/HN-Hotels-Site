#!/usr/bin/env node
/**
 * sync-trading-docs.js — keeps /trading/_context/*.md in sync with code.
 *
 * Sources of truth (READ):
 *   - wealth-engine/workers/(*)/wrangler.toml         → cron expressions
 *   - wealth-engine/workers/(*)/src/index.js          → cron handlers
 *   - wealth-engine/migrations/*.sql                  → schema migrations
 *   - functions/api/trading.js                        → API action= routes
 *   - trading/(*)/index.html                          → UI route inventory
 *   - trading/sw.js                                   → service-worker version
 *
 * Targets (WRITE — only between AUTO markers):
 *   - trading/_context/00-OVERVIEW.md
 *   - trading/_context/06-CRON-MAP.md
 *   - trading/_context/07-D1-SCHEMA.md
 *   - trading/_context/08-API-ENDPOINTS.md
 *   - trading/_context/05-UI-LAYER.md
 *   - trading/_context/AUTO-DRIFT-REPORT.md           (always rewritten)
 *
 * Marker convention in MD:
 *   <!-- AUTO:section-name -->
 *   ...regenerated content...
 *   <!-- /AUTO:section-name -->
 *
 * Run:
 *   node scripts/sync-trading-docs.js
 *   node scripts/sync-trading-docs.js --dry-run     (print drift, don't write)
 *   node scripts/sync-trading-docs.js --check       (exit 1 if drift exists, for CI)
 *
 * Zero npm deps. Pure node + fs.
 */

const fs   = require('fs');
const path = require('path');

// ── locate repo root ──────────────────────────────────────────────────────────
const SCRIPT_DIR = __dirname;
const REPO_ROOT  = path.resolve(SCRIPT_DIR, '..');

const ROOTS = {
  workers:   path.join(REPO_ROOT, 'wealth-engine', 'workers'),
  migrations:path.join(REPO_ROOT, 'wealth-engine', 'migrations'),
  apiFile:   path.join(REPO_ROOT, 'functions', 'api', 'trading.js'),
  trading:   path.join(REPO_ROOT, 'trading'),
  context:   path.join(REPO_ROOT, 'trading', '_context'),
  swFile:    path.join(REPO_ROOT, 'trading', 'sw.js'),
};

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || args.has('--check');
const CHECK   = args.has('--check');

// ── helpers ───────────────────────────────────────────────────────────────────
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const listDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

// Convert UTC cron to IST description
function utcCronToIstHint(cronExpr) {
  const m = cronExpr.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (!m) return '';
  const [, min, hr] = m;
  if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
    const utcH = parseInt(hr,10), utcM = parseInt(min,10);
    let istH = utcH + 5, istM = utcM + 30;
    if (istM >= 60) { istM -= 60; istH += 1; }
    if (istH >= 24) istH -= 24;
    const pad = (n) => String(n).padStart(2,'0');
    return `${pad(istH)}:${pad(istM)} IST`;
  }
  return '';
}

// ── Source 1: workers + crons ─────────────────────────────────────────────────
function scanWorkers() {
  const workers = [];
  for (const name of listDir(ROOTS.workers).sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const dir = path.join(ROOTS.workers, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const tomlPath = path.join(dir, 'wrangler.toml');
    const srcPath  = path.join(dir, 'src', 'index.js');
    const toml = read(tomlPath);
    if (!toml) continue;
    const crons = [];
    // Parse `crons = [ ... ]` block (multi-line OK)
    const cronBlock = toml.match(/crons\s*=\s*\[([\s\S]*?)\]/);
    if (cronBlock) {
      const inner = cronBlock[1];
      // Each line: "<expr>",  optional comment
      const lineRe = /"([^"]+)"\s*,?\s*(?:#\s*(.*))?/g;
      let m;
      while ((m = lineRe.exec(inner)) !== null) {
        crons.push({ expr: m[1].trim(), comment: (m[2] || '').trim() });
      }
    }
    const srcLines = (read(srcPath) || '').split('\n').length;
    workers.push({ name, crons, srcLines, hasSrc: !!read(srcPath) });
  }
  return workers;
}

// ── Source 2: migrations ──────────────────────────────────────────────────────
function scanMigrations() {
  const out = [];
  for (const f of listDir(ROOTS.migrations).filter(f => f.endsWith('.sql')).sort()) {
    const full = path.join(ROOTS.migrations, f);
    const txt = read(full) || '';
    const tableMatches = [...txt.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m => m[1]);
    const alterMatches = [...txt.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)].map(m => `${m[1]}.${m[2]}`);
    out.push({ file: f, tables_created: tableMatches, columns_added: alterMatches, lines: txt.split('\n').length });
  }
  return out;
}

// ── Source 3: API actions ─────────────────────────────────────────────────────
function scanApiActions() {
  const txt = read(ROOTS.apiFile) || '';
  const actions = [];
  const re = /case\s+'([a-z_]+)'\s*:\s*return\s+Response\.json\(\s*await\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    actions.push({ action: m[1], handler: m[2] });
  }
  // also match non-await handlers: case 'glossary': return Response.json(getGlossary(url)
  const re2 = /case\s+'([a-z_]+)'\s*:\s*return\s+Response\.json\(\s*(\w+)\s*\(/g;
  while ((m = re2.exec(txt)) !== null) {
    if (!actions.find(a => a.action === m[1])) actions.push({ action: m[1], handler: m[2] });
  }
  return actions.sort((a,b) => a.action.localeCompare(b.action));
}

// ── Source 4: UI routes ───────────────────────────────────────────────────────
function scanUiRoutes() {
  const out = [];
  function walk(dir, prefix) {
    for (const name of listDir(dir)) {
      if (name.startsWith('_') || name.startsWith('.') || name === 'icons') continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full, `${prefix}${name}/`);
      } else if (name === 'index.html') {
        const lines = (read(full) || '').split('\n').length;
        out.push({ route: `/trading/${prefix}`, file: full.replace(REPO_ROOT + '/', ''), lines });
      }
    }
  }
  // Top-level trading/index.html
  if (exists(path.join(ROOTS.trading, 'index.html'))) {
    out.push({
      route: '/trading/',
      file: 'trading/index.html',
      lines: (read(path.join(ROOTS.trading, 'index.html')) || '').split('\n').length
    });
  }
  walk(ROOTS.trading, '');
  return out.filter((v,i,a) => a.findIndex(x => x.route === v.route) === i).sort((a,b) => a.route.localeCompare(b.route));
}

// ── Source 5: SW version ──────────────────────────────────────────────────────
function scanServiceWorker() {
  const txt = read(ROOTS.swFile) || '';
  const v = txt.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  const precache = [...txt.matchAll(/['"]([^'"]*?\/trading\/[^'"]*)['"]/g)].map(m => m[1]);
  return {
    cache_version: v ? v[1] : 'unknown',
    precache_count: precache.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS (build the regenerated markdown blocks)
// ─────────────────────────────────────────────────────────────────────────────

function fmtCronTable(workers) {
  const rows = [];
  rows.push('| Worker | Crons | Sample (first 3) |');
  rows.push('|---|---|---|');
  let totalCrons = 0;
  for (const w of workers) {
    totalCrons += w.crons.length;
    const sample = w.crons.slice(0, 3).map(c =>
      `\`${c.expr}\`${c.comment ? ` (${c.comment.replace(/\|/g,'\\|').slice(0,32)})` : ''}`
    ).join('<br>');
    rows.push(`| \`${w.name}\` | ${w.crons.length} | ${sample || '_(no crons)_'} |`);
  }
  rows.push(`| **TOTAL** | **${totalCrons}** | across ${workers.length} workers |`);
  return rows.join('\n');
}

function fmtCronListByWorker(workers) {
  const blocks = [];
  for (const w of workers) {
    if (w.crons.length === 0) continue;
    blocks.push(`### \`${w.name}\` (${w.crons.length} cron${w.crons.length===1?'':'s'})\n`);
    blocks.push('```toml');
    for (const c of w.crons) {
      const istHint = utcCronToIstHint(c.expr);
      const annot = c.comment || istHint;
      blocks.push(`"${c.expr}"${annot ? `   # ${annot}` : ''}`);
    }
    blocks.push('```\n');
  }
  return blocks.join('\n');
}

function fmtWorkersList(workers) {
  const rows = ['| Worker | Crons | src/index.js lines |', '|---|---|---|'];
  for (const w of workers) {
    rows.push(`| \`${w.name}\` | ${w.crons.length} | ${w.srcLines || '—'} |`);
  }
  rows.push(`| **${workers.length} workers total** | ${workers.reduce((s,w)=>s+w.crons.length,0)} | — |`);
  return rows.join('\n');
}

function fmtMigrations(migs) {
  const rows = ['| Migration | Tables created | Columns added |', '|---|---|---|'];
  for (const m of migs) {
    rows.push(`| \`${m.file}\` | ${m.tables_created.map(t=>`\`${t}\``).join(', ') || '—'} | ${m.columns_added.length ? m.columns_added.map(c=>`\`${c}\``).join(', ') : '—'} |`);
  }
  rows.push(`\n_Total migrations: ${migs.length}_`);
  return rows.join('\n');
}

function fmtApiActions(actions) {
  const rows = ['| Action | Handler |', '|---|---|'];
  for (const a of actions) {
    rows.push(`| \`?action=${a.action}\` | \`${a.handler}()\` |`);
  }
  rows.push(`\n_Total actions: ${actions.length}_`);
  return rows.join('\n');
}

function fmtUiRoutes(routes, sw) {
  const rows = ['| Route | File | Lines |', '|---|---|---|'];
  for (const r of routes) {
    rows.push(`| \`${r.route}\` | \`${r.file}\` | ${r.lines} |`);
  }
  rows.push('');
  rows.push(`**Service worker:** \`CACHE_VERSION = '${sw.cache_version}'\` · ${sw.precache_count} pre-cached URLs`);
  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKER REPLACEMENT
// ─────────────────────────────────────────────────────────────────────────────

function replaceMarker(content, name, newBlock) {
  const open  = `<!-- AUTO:${name} -->`;
  const close = `<!-- /AUTO:${name} -->`;
  const re = new RegExp(`(${open})[\\s\\S]*?(${close})`, 'm');
  if (!re.test(content)) {
    // Marker block not found — append at end
    return content + `\n\n${open}\n${newBlock}\n${close}\n`;
  }
  return content.replace(re, `$1\n${newBlock}\n$2`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNC
// ─────────────────────────────────────────────────────────────────────────────

const summary = {
  generated_at_iso: new Date().toISOString(),
  generated_at_ist: new Date(Date.now() + 5.5*3600000).toISOString().replace('T',' ').slice(0,19) + ' IST',
  workers: 0, total_crons: 0, migrations: 0, api_actions: 0, ui_routes: 0,
  files_updated: [], drift_detected: false,
};

const workers   = scanWorkers();
const migs      = scanMigrations();
const actions   = scanApiActions();
const routes    = scanUiRoutes();
const sw        = scanServiceWorker();

summary.workers      = workers.length;
summary.total_crons  = workers.reduce((s,w)=>s+w.crons.length,0);
summary.migrations   = migs.length;
summary.api_actions  = actions.length;
summary.ui_routes    = routes.length;

const updates = {
  '06-CRON-MAP.md': [
    { name: 'cron-overview-table',  block: fmtCronTable(workers) },
    { name: 'cron-list-by-worker',  block: fmtCronListByWorker(workers) },
  ],
  '07-D1-SCHEMA.md': [
    { name: 'migrations-list',      block: fmtMigrations(migs) },
  ],
  '08-API-ENDPOINTS.md': [
    { name: 'api-action-list',      block: fmtApiActions(actions) },
  ],
  '05-UI-LAYER.md': [
    { name: 'ui-routes-list',       block: fmtUiRoutes(routes, sw) },
  ],
  '00-OVERVIEW.md': [
    { name: 'workers-summary',      block: fmtWorkersList(workers) },
  ],
};

let drift = 0;
for (const [filename, sections] of Object.entries(updates)) {
  const fp = path.join(ROOTS.context, filename);
  const orig = read(fp);
  if (orig == null) {
    console.error(`SKIP (file not found): ${filename}`);
    continue;
  }
  let updated = orig;
  for (const s of sections) {
    updated = replaceMarker(updated, s.name, s.block);
  }
  if (updated !== orig) {
    drift++;
    summary.files_updated.push(filename);
    if (!DRY_RUN) {
      fs.writeFileSync(fp, updated, 'utf8');
      console.log(`✓ updated ${filename}`);
    } else {
      console.log(`~ DRIFT in ${filename}`);
    }
  } else {
    console.log(`= in-sync ${filename}`);
  }
}
summary.drift_detected = drift > 0;

// ── always rewrite the drift report ───────────────────────────────────────────
const reportPath = path.join(ROOTS.context, 'AUTO-DRIFT-REPORT.md');
const report = [
  '# Auto-sync drift report',
  '',
  `**Generated:** ${summary.generated_at_ist}`,
  `**Files updated this run:** ${summary.files_updated.length === 0 ? '_none_' : summary.files_updated.join(', ')}`,
  '',
  '## Live counts',
  '',
  `- Workers: **${summary.workers}**`,
  `- Total crons: **${summary.total_crons}**`,
  `- Migrations: **${summary.migrations}**`,
  `- API actions: **${summary.api_actions}**`,
  `- UI routes: **${summary.ui_routes}**`,
  `- Service worker version: **${sw.cache_version}**`,
  '',
  '## How to read this',
  '',
  '- This file is regenerated on every `node scripts/sync-trading-docs.js` run.',
  '- The numbers above reflect the **actual deployed code state** at sync time.',
  '- If `Files updated this run` is non-empty, it means the MD docs were stale relative to source code.',
  '- If `_none_`, MD docs are in sync with code.',
  '',
  '## CI gate',
  '',
  '```bash',
  '# Use this in pre-commit / CI to block merging if docs are stale:',
  'node scripts/sync-trading-docs.js --check',
  '# Exits 1 if any AUTO-marked section is out of date.',
  '```',
  '',
  '## When to run',
  '',
  '- After adding/removing a Worker',
  '- After adding/changing crons in any wrangler.toml',
  '- After adding a D1 migration',
  '- After adding an `?action=…` route in `functions/api/trading.js`',
  '- After adding/removing a UI route under `/trading/`',
  '- Pre-commit hook recommended (see `12-AUTO-UPDATE-WORKFLOW.md`).',
].join('\n') + '\n';

if (!DRY_RUN) {
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`✓ wrote ${path.basename(reportPath)}`);
}

// ── output ────────────────────────────────────────────────────────────────────
console.log('\n── summary ──────────────────────────────────');
console.log(`workers:       ${summary.workers}`);
console.log(`total crons:   ${summary.total_crons}`);
console.log(`migrations:    ${summary.migrations}`);
console.log(`api actions:   ${summary.api_actions}`);
console.log(`ui routes:     ${summary.ui_routes}`);
console.log(`SW version:    ${sw.cache_version}`);
console.log(`drift:         ${drift} file(s)`);

if (CHECK && drift > 0) {
  console.error('\n❌ DRIFT DETECTED. Run without --check to update docs.');
  process.exit(1);
}
process.exit(0);
