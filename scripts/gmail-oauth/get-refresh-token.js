#!/usr/bin/env node
/**
 * One-time OAuth flow to capture a Gmail-scoped refresh token.
 *
 * Reuses the existing "NCH Marketing Web" OAuth client (project
 * hn-hotels-marketing). Spins a tiny local server on :8080, opens the
 * browser to Google's consent screen, captures the auth code from the
 * /oauth/callback redirect, exchanges it for a refresh token, and prints
 * the value. Run once, store the result in CF Worker secrets.
 *
 * Scope: gmail.modify — covers read + label apply (so the poller can
 * mark processed mails to skip them on the next run).
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import { URL } from 'node:url';

// Credentials are pulled from env. Don't hardcode — GitHub secret-scanning
// will (correctly) block any push that embeds an OAuth client secret in a
// public repo. The asset DB at HN-Hotels-Asset-Database.xlsx has the
// canonical values for the existing "NCH Marketing Web" OAuth client.
//
// Usage:
//   GOOGLE_CLIENT_ID="376399724654-...apps.googleusercontent.com" \
//   GOOGLE_CLIENT_SECRET="GOCSPX-..." \
//   node scripts/gmail-oauth/get-refresh-token.js
//
// The redirect URI must already be authorized on the OAuth client. For
// the existing NCH Marketing Web client we added http://localhost:8080/
// oauth/callback during this setup; if you're using a different client,
// add the same loopback URL in Google Cloud Console first.
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI  = 'http://localhost:8080/oauth/callback';
const SCOPE         = 'https://www.googleapis.com/auth/gmail.modify';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET in env.');
  console.error('Pull values from HN-Hotels-Asset-Database.xlsx → Google Cloud rows.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // force refresh_token issuance even on re-consent
authUrl.searchParams.set('login_hint', 'nihafwork@gmail.com');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8080');
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404); res.end('not found'); return;
  }
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'content-type': 'text/html' });
    res.end(`<h1>OAuth error: ${error}</h1><p>Check terminal.</p>`);
    console.error('OAuth error:', error);
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400); res.end('no code'); return;
  }

  // Exchange code → refresh token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    res.writeHead(400, { 'content-type': 'text/html' });
    res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
    console.error('Token exchange failed:', tokens);
    process.exit(1);
  }

  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html>
    <html><body style="font-family:system-ui;padding:40px;max-width:600px">
    <h1 style="color:#16a34a">✅ Gmail OAuth complete</h1>
    <p>Refresh token captured. You can close this tab — return to the terminal.</p>
    </body></html>`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('REFRESH TOKEN (store as GOOGLE_GMAIL_REFRESH_TOKEN):');
  console.log(tokens.refresh_token);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Scope:        ', tokens.scope);
  console.log('Token type:   ', tokens.token_type);
  console.log('Expires in:   ', tokens.expires_in, 'seconds (access token)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  setTimeout(() => server.close(() => process.exit(0)), 500);
});

server.listen(8080, () => {
  console.log('OAuth callback server: http://localhost:8080/oauth/callback');
  console.log('Opening browser to Google consent screen…');
  exec(`open "${authUrl.toString()}"`);
});

setTimeout(() => {
  console.error('Timed out waiting for OAuth callback after 5 minutes.');
  process.exit(1);
}, 5 * 60 * 1000);
