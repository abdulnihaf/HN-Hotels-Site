// Hourly nudge: pings the Sauda buy-board reminder endpoint, which WhatsApps
// Basheer (go-collect) / Zoya (delivered) about any items still not entered.
// All logic + hour-gating lives in /api/buy?action=remind-tick.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch('https://hnhotels.in/api/buy?action=remind-tick&token=sauda-remind-7f3a9c')
        .then(r => r.text())
        .then(t => console.log('sauda-remind:', t))
        .catch(e => console.error('sauda-remind failed:', e?.message || e))
    );
  },
};
