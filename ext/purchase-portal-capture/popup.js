const els = {
  activeTabText: document.getElementById('activeTabText'),
  sourceKey: document.getElementById('sourceKey'),
  pin: document.getElementById('pin'),
  expiryHours: document.getElementById('expiryHours'),
  accountLabel: document.getElementById('accountLabel'),
  locationLabel: document.getElementById('locationLabel'),
  pincode: document.getElementById('pincode'),
  captureBtn: document.getElementById('captureBtn'),
  browserQuotesBtn: document.getElementById('browserQuotesBtn'),
  openBtn: document.getElementById('openBtn'),
  healthBtn: document.getElementById('healthBtn'),
  status: document.getElementById('status'),
  health: document.getElementById('health'),
};

let portals = [];

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No extension response' });
    });
  });
}

function setStatus(text, type = '') {
  els.status.className = `status ${type}`.trim();
  els.status.textContent = text;
}

function portalLabel(sourceKey) {
  return portals.find((portal) => portal.key === sourceKey)?.label || sourceKey;
}

function formPayload() {
  return {
    pin: els.pin.value.trim(),
    sourceKey: els.sourceKey.value,
    accountLabel: els.accountLabel.value.trim(),
    locationLabel: els.locationLabel.value.trim(),
    pincode: els.pincode.value.trim(),
    expiryHours: Number(els.expiryHours.value || 6),
  };
}

function renderHealth(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) {
    els.health.innerHTML = '';
    return;
  }

  els.health.innerHTML = sessions.map((session) => {
    const status = String(session.status || '').toUpperCase();
    const pillClass = status === 'READY'
      ? 'ready'
      : status === 'MISSING' || status === 'EXPIRED' || status === 'CAPTURE_FAILED'
        ? 'bad'
        : 'warn';
    return `
      <div class="row">
        <div class="name">${escapeHtml(session.source_label || portalLabel(session.source_key))}</div>
        <div class="pill ${pillClass}">${escapeHtml(status || 'UNKNOWN')}</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

async function loadContext() {
  const data = await send({ type: 'GET_CONTEXT' });
  if (!data.ok) {
    setStatus(data.error || 'Extension could not read the active tab', 'bad');
    return;
  }

  portals = data.portals || [];
  els.sourceKey.innerHTML = portals.map((portal) => `
    <option value="${escapeHtml(portal.key)}">${escapeHtml(portal.label)}</option>
  `).join('');

  const settings = data.settings || {};
  els.pin.value = settings.pin || '';
  els.accountLabel.value = settings.accountLabel || '';
  els.locationLabel.value = settings.locationLabel || 'Shivajinagar';
  els.pincode.value = settings.pincode || '560051';
  els.expiryHours.value = settings.expiryHours || 6;

  if (data.detectedSource) {
    els.sourceKey.value = data.detectedSource;
    els.activeTabText.textContent = `Active tab: ${portalLabel(data.detectedSource)}`;
    setStatus(`Ready to capture ${portalLabel(data.detectedSource)} from this tab.`, 'warn');
  } else {
    els.activeTabText.textContent = 'Active tab is not one of the wired purchase portals.';
  }
}

async function captureCurrent() {
  const payload = formPayload();
  els.captureBtn.disabled = true;
  setStatus(`Capturing ${portalLabel(payload.sourceKey)} session...`, 'warn');
  try {
    const data = await send({ type: 'CAPTURE_CURRENT', ...payload });
    if (!data.ok) throw new Error(data.error || 'Capture failed');
    const totalCookies = (data.cookieCount || 0) + (data.visibleCookieCount || 0);
    setStatus(
      `Captured ${data.sourceLabel}: ${totalCookies} cookies, ${data.localStorageCount + data.sessionStorageCount} storage keys. Vault ready: ${data.readyCount ?? '-'} of 8.`,
      'good',
    );
    if (data.health) renderHealth([data.health]);
  } catch (error) {
    setStatus(error.message || 'Capture failed', 'bad');
  } finally {
    els.captureBtn.disabled = false;
  }
}

async function runBrowserQuotes() {
  const payload = formPayload();
  els.browserQuotesBtn.disabled = true;
  setStatus(`Running ${portalLabel(payload.sourceKey)} live quote jobs from this tab...`, 'warn');
  try {
    const data = await send({ type: 'RUN_BROWSER_QUOTES', ...payload });
    if (!data.ok) throw new Error(data.error || 'Live quote runner failed');
    const summary = data.summary || {};
    const note = data.jobCount
      ? `${data.updatedCount || 0}/${data.jobCount} jobs updated. ${summary.quoted_count || 0} quoted, ${summary.error_count || 0} errors.`
      : data.message || 'No quote jobs waiting.';
    setStatus(`${data.sourceLabel}: ${note}`, data.jobCount ? 'good' : 'warn');
  } catch (error) {
    setStatus(error.message || 'Live quote runner failed', 'bad');
  } finally {
    els.browserQuotesBtn.disabled = false;
  }
}

async function openPortal() {
  const sourceKey = els.sourceKey.value;
  const data = await send({ type: 'OPEN_PORTAL', sourceKey });
  if (!data.ok) {
    setStatus(data.error || 'Could not open portal', 'bad');
    return;
  }
  setStatus(`Opened ${portalLabel(sourceKey)}. Login there, then capture from that tab.`, 'warn');
}

async function checkHealth() {
  const pin = els.pin.value.trim();
  els.healthBtn.disabled = true;
  setStatus('Checking session vault...', 'warn');
  try {
    const data = await send({ type: 'GET_HEALTH', pin });
    if (!data.ok) throw new Error(data.error || 'Health check failed');
    renderHealth(data.sessions || []);
    setStatus(`Vault status: ${data.ready_count || 0} ready, ${(data.sessions || []).length} configured portals.`, data.ready_count ? 'good' : 'warn');
  } catch (error) {
    setStatus(error.message || 'Health check failed', 'bad');
  } finally {
    els.healthBtn.disabled = false;
  }
}

els.captureBtn.addEventListener('click', captureCurrent);
els.browserQuotesBtn.addEventListener('click', runBrowserQuotes);
els.openBtn.addEventListener('click', openPortal);
els.healthBtn.addEventListener('click', checkHealth);
els.pin.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') captureCurrent();
});

loadContext();
