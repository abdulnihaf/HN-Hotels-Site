// background.js — wakes the content script to drain its local log on a steady cadence,
// so queued offline orders push to the backend the moment connectivity returns even if
// the POS tab is backgrounded. The durable log lives in the content script's IndexedDB.
chrome.alarms.create('cpg-drain', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name !== 'cpg-drain') return;
  chrome.tabs.query({ url: '*://test.hamzahotel.com/pos/*' }, function (tabs) {
    (tabs || []).forEach(function (t) {
      try { chrome.tabs.sendMessage(t.id, 'cpg-drain'); } catch (e) {}
    });
  });
});
