// inject.js — runs in the PAGE context (not the isolated content-script world) so
// it can wrap the real window.fetch / XMLHttpRequest the Odoo POS uses to sync orders.
// It never blocks or alters POS traffic — it only observes, then postMessages a
// snapshot to the content script, which owns the durable local log.
(function () {
  'use strict';
  if (window.__CPG_INJECTED__) return;
  window.__CPG_INJECTED__ = true;

  var POST = function (kind, data) {
    try { window.postMessage({ __cpg: true, kind: kind, data: data }, '*'); } catch (e) {}
  };

  // ── Decide whether a request is a POS order create/sync ────────────────────
  function isOrderSync(url, bodyStr) {
    if (!url) return false;
    var u = String(url);
    if (u.indexOf('/web/dataset/call') === -1 && u.indexOf('/pos/') === -1) return false;
    if (!bodyStr) return false;
    var b = String(bodyStr);
    return /pos\.order/.test(b) && /(create_from_ui|sync_from_ui|create|_process_order|draft)/.test(b);
  }

  // ── Best-effort extraction of order facts from an arbitrary Odoo payload ────
  function extractOrders(bodyStr) {
    var out = [];
    var body;
    try { body = JSON.parse(bodyStr); } catch (e) { return out; }
    var args = (body && body.params && body.params.args) || (body && body.args) || [];
    // args[0] is usually the array of orders for create_from_ui / sync_from_ui
    var orders = Array.isArray(args[0]) ? args[0] : (Array.isArray(args) ? args : []);
    function pick(o) {
      if (!o || typeof o !== 'object') return;
      var d = o.data || o;
      var amount = d.amount_total != null ? d.amount_total
                 : (o.amount_total != null ? o.amount_total : null);
      var name = d.name || o.name || o.pos_reference || d.pos_reference || null;
      var uid = d.uid || o.uid || d.uuid || o.uuid || (d.pos_session_id ? null : null) || name;
      var lines = d.lines || o.lines || [];
      var lineCount = Array.isArray(lines) ? lines.length : 0;
      var login = d.login_number || o.login_number || null;
      var seq = d.sequence_number || o.sequence_number || null;
      if (amount != null || name) {
        out.push({
          client_uid: String(uid || name || ('ord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))),
          pos_reference: name ? String(name) : null,
          amount_total: amount != null ? Number(amount) : 0,
          line_count: lineCount,
          login_number: login != null ? String(login) : null,
          sequence_number: seq
        });
      }
    }
    if (Array.isArray(orders)) orders.forEach(pick); else pick(orders);
    return out;
  }

  function looksExpired(respText, status) {
    if (status === 0) return true;
    if (!respText) return false;
    return /Session expired|odoo\.exceptions\.|SessionExpired|Invalid|Odoo Server Error|FORBIDDEN|access denied/i.test(String(respText));
  }

  function handle(url, bodyStr, status, respText, networkError) {
    try {
      if (!isOrderSync(url, bodyStr)) return;
      var orders = extractOrders(bodyStr);
      var observed = networkError ? 'offline'
                   : (status >= 200 && status < 300 && !looksExpired(respText, status)) ? 'ok'
                   : looksExpired(respText, status) ? 'session_expired'
                   : 'error';
      orders.forEach(function (o) {
        o.sync_observed = observed;
        o.captured_at = Math.floor(Date.now() / 1000);
        POST('capture', o);
      });
      if (observed !== 'ok') {
        POST('event', {
          type: observed === 'session_expired' ? 'session_expired'
              : observed === 'offline' ? 'offline' : 'server_error',
          detail: ('status=' + status + ' ' + String(respText || networkError || '').slice(0, 200)),
          at: Math.floor(Date.now() / 1000),
          client_uid: orders[0] ? orders[0].client_uid : null
        });
      }
    } catch (e) {}
  }

  // ── Wrap fetch ─────────────────────────────────────────────────────────────
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var bodyStr = (init && init.body) ? (typeof init.body === 'string' ? init.body : null) : null;
      return origFetch.apply(this, arguments).then(function (resp) {
        if (bodyStr && isOrderSync(url, bodyStr)) {
          resp.clone().text().then(function (t) { handle(url, bodyStr, resp.status, t, false); }).catch(function () {});
        }
        return resp;
      }).catch(function (err) {
        if (bodyStr && isOrderSync(url, bodyStr)) handle(url, bodyStr, 0, '', String(err));
        throw err;
      });
    };
  }

  // ── Wrap XHR ───────────────────────────────────────────────────────────────
  var XO = window.XMLHttpRequest;
  if (XO) {
    var open = XO.prototype.open, send = XO.prototype.send;
    XO.prototype.open = function (m, u) { this.__cpg_url = u; return open.apply(this, arguments); };
    XO.prototype.send = function (body) {
      var xhr = this;
      var bodyStr = (typeof body === 'string') ? body : null;
      if (bodyStr && isOrderSync(xhr.__cpg_url, bodyStr)) {
        xhr.addEventListener('loadend', function () {
          var net = (xhr.status === 0);
          handle(xhr.__cpg_url, bodyStr, xhr.status, net ? '' : xhr.responseText, net ? 'network' : false);
        });
      }
      return send.apply(this, arguments);
    };
  }
})();
