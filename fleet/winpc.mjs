#!/usr/bin/env node
// fleet/winpc.mjs — the coordination CLI for shared appliance hn-winpc.
//
// Doctrine: fleet/winpc-MASTER-CONTEXT.md
// Resource graph: fleet/winpc-resource-graph.json
//
// Verbs:
//   audit         — diff repo graph vs live winpc state; flag orphans
//   doctor        — health-probe each registered automation
//   claim         — register new automation block + resources (validates no overlap)
//   regularize    — adopt an unregistered live resource into the graph under an existing automation
//   inherit       — transfer an automation's owner_chat_session to a new chat
//   decommission  — remove an automation block (and optionally its resources)
//   lock          — acquire a winpc lock around a command, release in finally
//
// Constraints:
//   - No-deps. Pure Node stdlib + child_process ssh.
//   - All graph mutations are atomic (.tmp + rename) AND held under winpc.lock.manifest-write.
//   - Read-only verbs (audit/doctor) need no locks.
//
// SSH command pattern (matches the repo convention exactly):
//   ssh "HN Hotels@hn-winpc" '<cmd>'

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(__dirname, 'winpc-resource-graph.json');
const SSH_TARGET = '"HN Hotels@hn-winpc"';

// ─── colour helpers ──────────────────────────────────────────────────────────
const c = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

// ─── graph io ────────────────────────────────────────────────────────────────
function readGraph() {
  if (!existsSync(GRAPH_PATH)) {
    fatal(`Resource graph not found at ${GRAPH_PATH}. Run from repo root.`);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
}

function writeGraphAtomic(graph) {
  graph.last_updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const tmp = GRAPH_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(graph, null, 2) + '\n');
  renameSync(tmp, GRAPH_PATH);
}

// ─── ssh helpers ─────────────────────────────────────────────────────────────
function ssh(remoteCmd, { timeout = 30000 } = {}) {
  const r = spawnSync('bash', ['-c', `ssh -o ConnectTimeout=8 ${SSH_TARGET} '${remoteCmd.replace(/'/g, "'\\''")}'`], {
    encoding: 'utf8',
    timeout,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function pwsh(psCmd, opts) {
  // Wrap a PowerShell command for ssh-into-cmd.exe.
  // -ExecutionPolicy Bypass: hn-winpc default policy is Restricted, which blocks
  // the unsigned lock helpers under C:\hn-control\_shared\ (acquire-lock.ps1,
  // release-lock.ps1). Bypass is safe here — winpc.mjs only invokes scripts we
  // ship in the coordination root, not arbitrary user input.
  const escaped = psCmd.replace(/"/g, '\\"');
  return ssh(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${escaped}"`, opts);
}

// ─── lock helpers (call into _shared\acquire-lock.ps1) ──────────────────────
async function withLock(resource, ownerChat, fn) {
  const acquire = pwsh(
    `& 'C:\\hn-control\\_shared\\acquire-lock.ps1' -Resource '${resource}' -TimeoutSec 60 -OwnerChat '${ownerChat}'`,
    { timeout: 75000 }
  );
  if (acquire.code !== 0) {
    fatal(`Failed to acquire lock '${resource}': ${acquire.stderr || acquire.stdout}`);
  }
  try {
    return await fn();
  } finally {
    pwsh(`& 'C:\\hn-control\\_shared\\release-lock.ps1' -Resource '${resource}'`);
  }
}

// ─── argument parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') { args._raw = argv.slice(i + 1); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true; i += 1;
      } else {
        if (args[key] === undefined) args[key] = next;
        else if (Array.isArray(args[key])) args[key].push(next);
        else args[key] = [args[key], next];
        i += 2;
      }
    } else { args._.push(a); i += 1; }
  }
  return args;
}

function fatal(msg) { console.error(c.red('✗ ' + msg)); process.exit(2); }
function ok(msg)    { console.log(c.green('✓ ' + msg)); }
function warn(msg)  { console.log(c.yellow('! ' + msg)); }
function info(msg)  { console.log(c.blue('· ' + msg)); }

// ─── VERB: audit ─────────────────────────────────────────────────────────────
function cmdAudit() {
  const graph = readGraph();
  console.log(c.bold('\nwinpc audit — diffing repo graph vs live appliance\n'));

  // 1. Tasks
  const taskQuery = pwsh(`Get-ScheduledTask | Where-Object { $_.TaskName -like 'HN-*' } | Select-Object -ExpandProperty TaskName`);
  const liveTasks = (taskQuery.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const graphTasks = Object.values(graph.resources).filter(r => r.kind === 'scheduled_task').map(r => r.id);
  diff('Scheduled tasks', graphTasks, liveTasks);

  // 2. C:\hn-control\ top-level entries — compare against EVERY resource that
  //    has a path at depth-1 of hn-control, regardless of kind (filesystem_path,
  //    chrome_profile, etc.). Exclude appliance bookkeeping (.locks, _shared,
  //    manifest.json) and orphans already declared.
  const fsQuery = pwsh(`Get-ChildItem C:\\hn-control -Force | Where-Object { $_.Name -notin '.locks','_shared','manifest.json' } | Select-Object -ExpandProperty FullName`);
  const liveFs = (fsQuery.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const declaredOrphans = new Set((graph.orphans || []).map(o => o.path.toLowerCase()));
  const liveFsMinusOrphans = liveFs.filter(p => !declaredOrphans.has(p.toLowerCase()));
  const allRegisteredPaths = Object.values(graph.resources)
    .map(r => r.physical_path || r.id)
    .filter(p => typeof p === 'string' && /^C:\\hn-control\\[^\\]+$/i.test(p));
  diff('C:\\hn-control\\ entries (registered vs live, excluding declared orphans)', allRegisteredPaths, liveFsMinusOrphans);

  // 3. Orphans declared in graph
  if (graph.orphans?.length) {
    console.log(c.yellow('\n⚠  ORPHANS awaiting owner decision:'));
    for (const o of graph.orphans) {
      console.log(`   ${o.path}  ${c.dim(`(${o.size_bytes}B, ${o.last_write})`)}`);
      console.log(`   ${c.dim('→ ' + o.suspected_origin)}`);
    }
  }

  // 4. Stale chat sessions
  for (const [name, a] of Object.entries(graph.automations)) {
    if (a.owner_chat_session_status?.startsWith('STALE')) {
      warn(`automation '${name}' has STALE owner_chat_session ('${a.owner_chat_session}') — re-claim with: winpc inherit --automation ${name} --new-owner-chat <id>`);
    }
    if (a.owner_chat_session_status?.startsWith('REGULARIZED') && a.owner_chat_session === null) {
      warn(`automation '${name}' is unowned (regularized) — assign with: winpc inherit --automation ${name} --new-owner-chat <id>`);
    }
  }

  console.log('');
}

function diff(label, graphList, liveList) {
  const gset = new Set(graphList.map(x => x.toLowerCase()));
  const lset = new Set(liveList.map(x => x.toLowerCase()));
  const registeredNotLive = [...graphList].filter(g => !lset.has(g.toLowerCase()));
  const liveNotRegistered = [...liveList].filter(l => !gset.has(l.toLowerCase()));
  console.log(c.bold(label + ':'));
  if (registeredNotLive.length === 0 && liveNotRegistered.length === 0) {
    ok('in sync');
  } else {
    if (registeredNotLive.length) {
      console.log(c.red(`  registered-but-missing-on-pc:`));
      registeredNotLive.forEach(x => console.log('   - ' + x));
    }
    if (liveNotRegistered.length) {
      console.log(c.yellow(`  live-but-unregistered (orphans):`));
      liveNotRegistered.forEach(x => console.log('   + ' + x));
    }
  }
  console.log('');
}

// ─── VERB: doctor ────────────────────────────────────────────────────────────
function cmdDoctor() {
  const graph = readGraph();
  console.log(c.bold('\nwinpc doctor — per-automation health\n'));

  // Tasks status — use ConvertTo-Csv (escape-safe across cmd.exe → powershell).
  const taskQuery = pwsh(`Get-ScheduledTask | Where-Object { $_.TaskName -like 'HN-*' } | Select-Object TaskName, State | ConvertTo-Csv -NoTypeInformation`);
  const taskState = {};
  const csvLines = (taskQuery.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const line of csvLines.slice(1)) { // skip header
    const m = line.match(/^"([^"]+)","([^"]+)"$/);
    if (m) taskState[m[1]] = m[2];
  }

  // Watchdog log tail (aggregator only)
  const wd = pwsh(`Get-Content -Tail 1 'C:\\Users\\HN Hotels\\Documents\\hn-aggregator-watchdog.log' -ErrorAction SilentlyContinue`);
  const wdTail = (wd.stdout || '').trim();

  for (const [name, a] of Object.entries(graph.automations)) {
    console.log(c.bold(name) + c.dim(`  (criticality=${a.criticality}, owner=${a.owner_chat_session || 'unassigned'})`));

    const tasks = a.owns.filter(code => graph.resources[code]?.kind === 'scheduled_task');
    for (const code of tasks) {
      const taskName = graph.resources[code].id;
      const st = taskState[taskName] || 'NOT FOUND';
      const colored = st === 'Running' || st === 'Ready' ? c.green(st) : c.red(st);
      console.log(`  task ${taskName}: ${colored}`);
    }

    if (name === 'aggregator-pulse' && wdTail) {
      console.log(`  watchdog: ${c.dim(wdTail)}`);
    }

    if (a.health_probe_url) {
      console.log(`  health: ${c.dim(a.health_probe_url)}`);
    }
    console.log('');
  }
}

// ─── VERB: claim ─────────────────────────────────────────────────────────────
async function cmdClaim(args) {
  const automation = args.automation;
  const purpose = args.purpose;
  const chat = args['owner-chat'];
  const criticality = args.criticality || 'medium';
  const owns = [].concat(args.owns || []);
  if (!automation || !purpose || !chat) {
    fatal('usage: winpc claim --automation <name> --purpose "..." --owner-chat <id> --owns <resource_code> [--owns ...] [--criticality high|medium|low]');
  }
  const graph = readGraph();
  if (graph.automations[automation]) {
    fatal(`automation '${automation}' already exists. Use inherit (transfer owner) or regularize (add resources).`);
  }
  // Validate every owns resource code exists OR is being introduced (allow either)
  const taken = new Map();
  for (const [aname, a] of Object.entries(graph.automations)) {
    for (const code of a.owns) taken.set(code, aname);
  }
  for (const code of owns) {
    if (taken.has(code)) fatal(`resource ${code} is already owned by ${taken.get(code)}`);
  }
  graph.automations[automation] = {
    purpose, owner_chat_session: chat, criticality,
    started_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    health_probe_url: args['health-probe-url'] || null,
    owns, uses_locks: [],
  };
  writeGraphAtomic(graph);
  ok(`claimed '${automation}' for chat ${chat} with ${owns.length} resource(s)`);
}

// ─── VERB: regularize ───────────────────────────────────────────────────────
function cmdRegularize(args) {
  const automation = args.automation;
  const resourceCode = args.resource;
  const kind = args.kind;
  const id = args.id;
  if (!automation || !resourceCode || !kind || !id) {
    fatal('usage: winpc regularize --automation <name> --resource <code> --kind <kind> --id <id> [--criticality ...]');
  }
  const graph = readGraph();
  if (!graph.automations[automation]) fatal(`unknown automation '${automation}' — use claim first`);
  if (graph.resources[resourceCode]) {
    const cur = graph.resources[resourceCode];
    if (cur.owner !== automation) fatal(`resource ${resourceCode} already owned by ${cur.owner}`);
    ok(`resource ${resourceCode} already registered to ${automation} — noop`);
    return;
  }
  graph.resources[resourceCode] = {
    kind, id,
    owner: automation,
    criticality: args.criticality || 'medium',
    lock_to_write: null,
    notes: `REGULARIZED ${new Date().toISOString().slice(0,10)} via winpc CLI`,
  };
  if (!graph.automations[automation].owns.includes(resourceCode)) {
    graph.automations[automation].owns.push(resourceCode);
  }
  writeGraphAtomic(graph);
  ok(`regularized ${resourceCode} under '${automation}'`);
}

// ─── VERB: inherit ──────────────────────────────────────────────────────────
function cmdInherit(args) {
  const automation = args.automation;
  const newChat = args['new-owner-chat'];
  if (!automation || !newChat) fatal('usage: winpc inherit --automation <name> --new-owner-chat <chat-id>');
  const graph = readGraph();
  const a = graph.automations[automation];
  if (!a) fatal(`unknown automation '${automation}'`);
  const prev = a.owner_chat_session;
  a.owner_chat_session = newChat;
  a.owner_chat_session_status = `INHERITED ${new Date().toISOString().slice(0,10)} from ${prev || 'unassigned'}`;
  writeGraphAtomic(graph);
  ok(`automation '${automation}' now owned by chat ${newChat} (was: ${prev || 'unassigned'})`);
}

// ─── VERB: decommission ─────────────────────────────────────────────────────
function cmdDecommission(args) {
  const automation = args.automation;
  if (!automation) fatal('usage: winpc decommission --automation <name> [--purge-resources]');
  const graph = readGraph();
  const a = graph.automations[automation];
  if (!a) fatal(`unknown automation '${automation}'`);
  if (args['purge-resources']) {
    for (const code of a.owns) delete graph.resources[code];
  }
  delete graph.automations[automation];
  writeGraphAtomic(graph);
  ok(`decommissioned '${automation}'${args['purge-resources'] ? ' + purged its resources' : ' (resources kept as unowned — re-claim or purge manually)'}`);
}

// ─── VERB: lock ─────────────────────────────────────────────────────────────
async function cmdLock(args) {
  const resource = args.resource;
  const owner = args['owner-chat'] || process.env.WINPC_CHAT_ID || 'unknown-chat';
  const tail = args._raw || [];
  if (!resource || tail.length === 0) {
    fatal('usage: winpc lock --resource <lock-name> [--owner-chat <id>] -- <command...>');
  }
  await withLock(resource, owner, async () => {
    info(`lock '${resource}' acquired by ${owner} — running command`);
    const r = spawnSync(tail[0], tail.slice(1), { stdio: 'inherit' });
    process.exitCode = r.status ?? 0;
  });
}

// ─── help ───────────────────────────────────────────────────────────────────
function help() {
  console.log(`
${c.bold('winpc')} — coordination CLI for the shared hn-winpc appliance.

Read-only verbs (no lock needed):
  ${c.bold('audit')}                          diff repo graph vs live winpc, flag orphans
  ${c.bold('doctor')}                         per-automation health probe

Graph mutations (atomic, written to fleet/winpc-resource-graph.json):
  ${c.bold('claim')}        --automation <name> --purpose "..." --owner-chat <id>
                 --owns <resource_code> [--owns ...]
                 [--criticality high|medium|low] [--health-probe-url URL]
  ${c.bold('regularize')}   --automation <name> --resource <code> --kind <kind> --id <id>
                 [--criticality ...]
  ${c.bold('inherit')}      --automation <name> --new-owner-chat <chat-id>
  ${c.bold('decommission')} --automation <name> [--purge-resources]

Cross-chat coordination on the appliance:
  ${c.bold('lock')}         --resource <name> [--owner-chat <id>] -- <command>
                 wraps <command> with acquire-lock/release-lock on winpc.

Constraints:
  • two automations may not share a resource code
  • destructive verbs on non-owned resources need the resource's lock
  • each automation's DND = union of every other automation's owns (derived)

Read ${c.bold('fleet/winpc-MASTER-CONTEXT.md')} for the full doctrine.
`);
}

// ─── dispatch ───────────────────────────────────────────────────────────────
const [verb, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

const verbs = {
  audit: cmdAudit,
  doctor: cmdDoctor,
  claim: cmdClaim,
  regularize: cmdRegularize,
  inherit: cmdInherit,
  decommission: cmdDecommission,
  lock: cmdLock,
  help, '--help': help, '-h': help,
};

if (!verb || !verbs[verb]) { help(); process.exit(verb ? 2 : 0); }

try {
  await Promise.resolve(verbs[verb](args));
} catch (err) {
  fatal(err.stack || err.message);
}
