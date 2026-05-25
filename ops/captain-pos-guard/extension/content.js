// content.js — isolated content-script world. Owns the DURABLE LOCAL LOG.
// Flow: inject.js (page) observes orders -> postMessage -> here -> IndexedDB (survives
// offline/crash/reload) -> drain to backend when online (retry forever until delivered).
(function () {
  'use strict';

  // ── CONFIG — set INGEST_TOKEN to the value of CF secret POS_GUARD_INGEST_TOKEN ──
  var CONFIG = {
    BACKEND: 'https://hnhotels.in/api/captain-pos-guard',
    INGEST_TOKEN: '__SET_POS_GUARD_INGEST_TOKEN__',
    DRAIN_EVERY_MS: 30000
  };

  // ── 1. Inject the page-context hook ─────────────────────────────────────────
  try {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}

  // ── 2. Durable local store (IndexedDB) ───────────────────────────────────────
  var DB_NAME = 'cpg_log', STORE = 'queue', dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function put(rec) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add(rec);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function readAll() {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function del(ids) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        ids.forEach(function (id) { os.delete(id); });
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  // ── 3. device id (stable per tab/browser) ────────────────────────────────────
  var deviceId = null;
  function getDeviceId() {
    if (deviceId) return Promise.resolve(deviceId);
    return new Promise(function (res) {
      chrome.storage.local.get(['cpg_device_id'], function (o) {
        deviceId = (o && o.cpg_device_id) || ('captain-' + Math.random().toString(36).slice(2, 10));
        chrome.storage.local.set({ cpg_device_id: deviceId });
        res(deviceId);
      });
    });
  }

  // ── 4. capture intake ────────────────────────────────────────────────────────
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.__cpg !== true) return;
    getDeviceId().then(function (did) {
      put({ kind: m.kind, device_id: did, payload: m.data, stored_at: Date.now() })
        .then(drain).catch(function () {});
    });
  });

  // ── 5. drain to backend (auto-runs when internet is back) ────────────────────
  var draining = false;
  function drain() {
    if (draining || !navigator.onLine) return Promise.resolve();
    draining = true;
    return readAll().then(function (rows) {
      if (!rows.length) { draining = false; return; }
      var captures = [], events = [], ids = [];
      rows.forEach(function (r) {
        ids.push(r.id);
        if (r.kind === 'capture') captures.push(Object.assign({ device_id: r.device_id }, r.payload));
        else events.push(Object.assign({ device_id: r.device_id }, r.payload));
      });
      return fetch(CONFIG.BACKEND + '?action=ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-guard-token': CONFIG.INGEST_TOKEN },
        body: JSON.stringify({ device_id: rows[0].device_id, captures: captures, events: events })
      }).then(function (resp) {
        if (resp.ok) return del(ids);        // delivered -> safe to drop the local copy
        // server rejected -> keep rows, try again next cycle
      }).catch(function () { /* offline -> keep rows */ });
    }).then(function () { draining = false; }).catch(function () { draining = false; });
  }

  // ── 6. triggers: interval, online event, visibility, background alarm ─────────
  setInterval(drain, CONFIG.DRAIN_EVERY_MS);
  window.addEventListener('online', drain);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) drain(); });
  try {
    chrome.runtime.onMessage.addListener(function (msg) { if (msg === 'cpg-drain') drain(); });
  } catch (e) {}

  // ── 7. last-resort flush on unload (best effort) ──────────────────────────────
  window.addEventListener('pagehide', function () {
    readAll().then(function (rows) {
      if (!rows.length || !navigator.sendBeacon) return;
      var captures = rows.filter(function (r) { return r.kind === 'capture'; }).map(function (r) { return Object.assign({ device_id: r.device_id }, r.payload); });
      var events = rows.filter(function (r) { return r.kind !== 'capture'; }).map(function (r) { return Object.assign({ device_id: r.device_id }, r.payload); });
      var blob = new Blob([JSON.stringify({ device_id: rows[0].device_id, token: CONFIG.INGEST_TOKEN, captures: captures, events: events })], { type: 'application/json' });
      navigator.sendBeacon(CONFIG.BACKEND + '?action=ingest', blob);
      // note: rows are NOT deleted here; drain() reconciles delivery on next load
    });
  });

  drain();
})();
