// Content script injected on the HN purchase console pages.
// Bridges window.postMessage on the page <-> chrome.runtime in the extension,
// so clicking "Get live prices" in the dashboard can drive the extension's
// background service worker without the user opening the popup per portal.

(() => {
  const PAGE_TAG = 'HN_PURCHASE_CONSOLE';
  const BRIDGE_TAG = 'HN_PURCHASE_BRIDGE';
  const VERSION = (chrome.runtime.getManifest?.() || {}).version || '0.0.0';

  function postToPage(type, payload) {
    try {
      window.postMessage(
        { source: BRIDGE_TAG, type, version: VERSION, payload: payload || {} },
        window.location.origin,
      );
    } catch (_) {
      // page may be gone (back/forward navigation) — ignore.
    }
  }

  function isFromPage(event) {
    if (event.source !== window) return false;
    const data = event.data;
    if (!data || typeof data !== 'object') return false;
    return data.source === PAGE_TAG;
  }

  // Page -> bridge -> background.
  window.addEventListener('message', (event) => {
    if (!isFromPage(event)) return;
    const { type, payload, requestId } = event.data;

    if (type === 'PING') {
      postToPage('READY', { ready: true, requestId });
      return;
    }

    if (type === 'RUN_LIVE_QUOTES') {
      const message = {
        type: 'RUN_BROWSER_QUOTES_ALL',
        requestId,
        payload: payload || {},
      };
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            postToPage('ERROR', {
              requestId,
              error: error.message || 'Extension unreachable',
            });
            return;
          }
          if (!response || !response.ok) {
            postToPage('ERROR', {
              requestId,
              error: response?.error || 'Extension rejected the live-price run',
            });
            return;
          }
          postToPage('COMPLETE', { requestId, result: response });
        });
      } catch (error) {
        postToPage('ERROR', {
          requestId,
          error: error?.message || 'Extension call failed',
        });
      }
      return;
    }
  });

  // Background -> bridge -> page (progress updates while a run is in flight).
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.target !== 'HN_PURCHASE_CONSOLE_BRIDGE') return false;
    if (message.type === 'STATUS' || message.type === 'COMPLETE' || message.type === 'ERROR') {
      postToPage(message.type, message.payload || {});
    }
    if (sendResponse) sendResponse({ ok: true });
    return false;
  });

  // Tell the page we're alive as soon as the script runs.
  postToPage('READY', { ready: true });
})();
