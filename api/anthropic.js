// Vercel Serverless Function — server-side proxy for the Anthropic API.
//
// Why this exists: the API key must never ship to the browser (a key baked
// into client JS gets scraped and revoked). This function holds the key in a
// server-only env var (ANTHROPIC_KEY) and only calls Anthropic after verifying
// the request comes from a signed-in @skdla.com user (Microsoft SSO via
// Supabase). The browser sends its Supabase access token; we validate it here.
//
// Required Vercel env vars (Project -> Settings -> Environment Variables):
//   ANTHROPIC_KEY      server-only secret  (NO VITE_ prefix)
//   SUPABASE_URL       falls back to VITE_SUPABASE_URL if unset
//   SUPABASE_ANON_KEY  falls back to VITE_SUPABASE_KEY if unset

const ALLOWED_DOMAIN = 'skdla.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY;
  const ANTHROPIC_KEY     = process.env.ANTHROPIC_KEY;

  if (!ANTHROPIC_KEY)                      { res.status(500).json({ error: 'Server missing ANTHROPIC_KEY' }); return; }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { res.status(500).json({ error: 'Server missing Supabase config' }); return; }

  // --- 1. Verify the caller is a signed-in @skdla.com user ---
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }

  try {
    const userResp = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
    });
    if (!userResp.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
    const user = await userResp.json();
    const email = (user.email || '').toLowerCase();
    if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  } catch (e) {
    res.status(401).json({ error: 'Auth check failed' });
    return;
  }

  // --- 2. Build the Anthropic request server-side (clamp client inputs) ---
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) { res.status(400).json({ error: 'Missing prompt' }); return; }
  const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 1000, 1), 4000);

  // --- 3. Call Anthropic with the server-side key ---
  try {
    const aResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await aResp.json().catch(() => ({}));
    if (!aResp.ok) {
      res.status(aResp.status).json({ error: data?.error?.message || 'Anthropic error' });
      return;
    }
    res.status(200).json({ text: data?.content?.[0]?.text || '' });
  } catch (e) {
    res.status(502).json({ error: 'Upstream error: ' + (e.message || e) });
  }
}
