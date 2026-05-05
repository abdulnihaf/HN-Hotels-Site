// Shared D1 helpers: cron logging, batch upsert, source health.

export async function logCronStart(db, worker, cron, trigger) {
  const r = await db.prepare(
    'INSERT INTO cron_run_log (worker_name, cron_name, started_at, status, trigger_source) VALUES (?,?,?,?,?)'
  ).bind(worker, cron, Date.now(), 'running', trigger || 'cron').run();
  return r.meta?.last_row_id;
}

export async function logCronEnd(db, id, status, rows, error) {
  const now = Date.now();
  await db.prepare(
    'UPDATE cron_run_log SET finished_at=?, status=?, rows_written=?, error_message=?, duration_ms=(? - started_at) WHERE id=?'
  ).bind(now, status, rows || 0, error || null, now, id).run();
}

export async function markSourceHealth(db, source, ok, error) {
  if (ok) {
    await db.prepare(
      `INSERT INTO source_health (source_name,last_success_ts,consecutive_failures,last_error,is_circuit_broken,updated_at)
       VALUES (?,?,0,NULL,0,?)
       ON CONFLICT(source_name) DO UPDATE SET last_success_ts=excluded.last_success_ts,
         consecutive_failures=0, last_error=NULL, is_circuit_broken=0, updated_at=excluded.updated_at`
    ).bind(source, Date.now(), Date.now()).run();
  } else {
    await db.prepare(
      `INSERT INTO source_health (source_name,consecutive_failures,last_error,updated_at)
       VALUES (?,1,?,?)
       ON CONFLICT(source_name) DO UPDATE SET consecutive_failures=consecutive_failures+1,
         last_error=excluded.last_error, updated_at=excluded.updated_at,
         is_circuit_broken=CASE WHEN consecutive_failures+1 >= 5 THEN 1 ELSE is_circuit_broken END`
    ).bind(source, String(error).slice(0, 500), Date.now()).run();
  }
}

// Batch insert with a parameter cap of ~100 per statement (D1 limit is ~100 vars).
// Uses D1.batch() to send multiple statements in a single network round-trip —
// 50-100× faster than awaiting each prepare().run() serially over the network.
export async function batchInsert(db, table, columns, rows, conflictAction = 'IGNORE') {
  if (rows.length === 0) return 0;
  const colsSql = columns.join(',');
  const placeholders = '(' + columns.map(() => '?').join(',') + ')';
  const maxParamsPerStmt = 90;
  const rowsPerStmt = Math.max(1, Math.floor(maxParamsPerStmt / columns.length));

  // Build the prepared statements in chunks
  const stmts = [];
  for (let i = 0; i < rows.length; i += rowsPerStmt) {
    const slice = rows.slice(i, i + rowsPerStmt);
    const vals = slice.map(() => placeholders).join(',');
    const sql = `INSERT OR ${conflictAction} INTO ${table} (${colsSql}) VALUES ${vals}`;
    const flat = slice.flatMap(r => columns.map(c => (r[c] ?? null)));
    stmts.push(db.prepare(sql).bind(...flat));
  }

  // D1 supports up to 50 statements per batch — chunk if needed
  const BATCH_SIZE = 50;
  let written = 0;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const batch = stmts.slice(i, i + BATCH_SIZE);
    const results = await db.batch(batch);
    for (const r of results) {
      written += r.meta?.changes ?? 0;
    }
  }
  return written;
}
