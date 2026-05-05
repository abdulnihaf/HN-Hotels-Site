// /wealth/auth/login — kicks off Kite OAuth flow.
// Redirects to Kite's hosted login page with our api_key.
export async function onRequest(context) {
  const { env } = context;
  const apiKey = env.KITE_API_KEY;
  if (!apiKey) {
    return new Response('KITE_API_KEY not set', { status: 500 });
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `https://kite.zerodha.com/connect/login?api_key=${encodeURIComponent(apiKey)}&v=3`,
    },
  });
}
