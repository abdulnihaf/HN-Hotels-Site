// inject.js v3.0 — Runs in MAIN world at document_start
// Patches fetch + XHR to intercept API responses AND request auth headers
// Auth headers are forwarded to background.js → stored to Cloudflare KV → enables server-side Cron
// v3.0: Fixed Zomato patterns (merchant-gw/web not merchant-api), added rms.swiggy.com + Accesstoken

(function () {
  'use strict';

  // Patterns for data we actually care about (sent to content script for processing)
  const DATA_PATTERNS = {
    swiggy: [
      /fetchOrders/i,                          // rms.swiggy.com/orders/v1/fetchOrders
      /vendor\/\w+\/business-metrics/i,
      /vendor\/\w+\/sales/i,
      /vendor\/\w+\/orders/i,
      /vendor\/\w+\/ratings/i,
      /vendor\/\w+\/funnel/i,
      /vendor\/\w+\/customers/i,
      /vendor\/\w+\/menu-performance/i,
      /vendor\/\w+\/operations/i,
      /restaurant\/\w+\/metrics/i,
      /outlet.*metrics/i,
      /business.*report/i,
      /growth.*buddy/i,
      /finance/i,
      /payout/i,
      /order.*list/i,
    ],
    zomato: [
      /merchant-gw\/web\/owner-hub\/reporting\/get-home-data/i,   // Live tracking data
      /merchant-gw\/web\/order\/history/i,                         // Order history
      /merchant-gw\/web\/owner-hub\/reporting\/get-outlet-data/i,  // Per-outlet breakdown
      /merchant-gw\/web\/restaurant/i,
      // Finance / payouts
      /finance|payout|settlement|invoice|earning/i,
      // Ads / promotions
      /\/ads\b|promot|campaign|marketing-tool/i,
      // Reviews / NPS / customer voice
      /\/nps\b|\/review|feedback|customer-voice|rating/i,
      // Core merchant-api + reporting endpoints
      /merchant-api\/orders/i,
      /merchant-api\/reporting/i,
      /merchant-api\/dashboard/i,
      /merchant-api\/restaurant/i,
      /merchant-api\/offers/i,
      /merchant-api\/menu/i,
      /merchant-api\/live/i,
      /merchant-api\/tracking/i,
      // Newer generation endpoints
      /owner-hub\/reporting/i,
      /owner-hub\/finance/i,
      /owner-hub\/ads/i,
      /owner-hub\/reviews/i,
    ],
  };

  // Auth header names to capture for Cron use
  // v3.0: Added 'accesstoken' for Swiggy rms.swiggy.com API
  const AUTH_HEADERS = /^(authorization|x-zomato-csrft|x-zomato-mx-csrf|x-zomato-app-version|x-zomato-source|x-client-id|x-swiggy|x-csrf|cookie|x-access-token|x-auth|bearer|token|accesstoken)/i;

  const platform = location.hostname.includes('swiggy') ? 'swiggy' : 'zomato';
  const patterns = DATA_PATTERNS[platform] || [];

  function isDataUrl(url) {
    return patterns.some(p => p.test(url));
  }

  function isApiUrl(url) {
    // v3.0: Added rms.swiggy.com and api.zomato.com
    return url && (
      url.includes('/api/') ||
      url.includes('-api/') ||
      url.includes('/vendor/') ||
      url.includes('/merchant-') ||
      url.includes('/partner/') ||
      url.includes('rms.swiggy.com') ||
      url.includes('api.zomato.com')
    );
  }

  function captureHeaders(headersObj) {
    const captured = {};
    if (!headersObj) return captured;
    try {
      const entries = headersObj instanceof Headers
        ? [...headersObj.entries()]
        : Object.entries(headersObj);
      for (const [k, v] of entries) {
        if (AUTH_HEADERS.test(k)) captured[k] = v;
      }
    } catch (e) {}
    return captured;
  }

  function dispatch(url, data, authHeaders) {
    window.postMessage({
      type: '__hn_api_capture',
      url,
      data,
      authHeaders: authHeaders || {},
      platform,
      ts: new Date().toISOString(),
    }, '*');
  }

  function dispatchDiscovery(url) {
    window.postMessage({
      type: '__hn_api_discovery',
      url,
      platform,
      ts: new Date().toISOString(),
    }, '*');
  }

  // ─── Patch fetch ───────────────────────────────────────────────────────────

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const options = args[1] || {};
    const authHeaders = captureHeaders(options.headers);

    return origFetch.apply(this, args).then((response) => {
      if (response.ok && isApiUrl(url)) {
        response.clone().json().then((json) => {
          if (isDataUrl(url)) {
            dispatch(url, json, authHeaders);
          } else {
            dispatchDiscovery(url);
          }
        }).catch(() => {});
      }
      return response;
    });
  };

  // ─── Patch XMLHttpRequest ──────────────────────────────────────────────────

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__hn_url = url;
    this.__hn_isData = isDataUrl(url);
    this.__hn_isApi = isApiUrl(url);
    this.__hn_headers = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__hn_headers && AUTH_HEADERS.test(name)) {
      this.__hn_headers[name] = value;
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this.__hn_isApi || this.__hn_isData) {
      const url = this.__hn_url;
      const headers = this.__hn_headers || {};
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300) {
          try {
            const json = JSON.parse(this.responseText);
            if (this.__hn_isData) {
              dispatch(url, json, headers);
            } else {
              dispatchDiscovery(url);
            }
          } catch (e) {}
        }
      });
    }
    return origSend.apply(this, arguments);
  };

})();
// v6.0 FINAL — Thu Apr 17 2026 — added finance/ads/reviews/nps path-based patterns
