function log(msg) {
  const el = document.getElementById('log');
  el.textContent = msg + '\n' + el.textContent;
}

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
  if (!status) { log('No response from background'); return; }
  document.getElementById('buffer').textContent = status.bufferSize + ' snapshots';
  document.getElementById('buffer').className = 'value ' + (status.bufferSize > 0 ? 'warn' : 'ok');
  document.getElementById('push-interval').textContent = status.config.pushInterval + 's';
  document.getElementById('refresh-interval').textContent = status.config.refreshInterval + ' min';
  document.getElementById('endpoint').textContent = status.config.endpoint;
});

document.getElementById('push-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORCE_PUSH' }, (res) => {
    log(res?.ok ? 'Pushed successfully' : 'Push failed');
  });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORCE_REFRESH' }, (res) => {
    log(res?.ok ? 'Tabs refreshed' : 'Refresh failed');
  });
});
