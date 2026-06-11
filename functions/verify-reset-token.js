export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { token, email } = await request.json();
    if (!token || !email) return new Response(JSON.stringify({ valid: false, error: 'Token and email required' }), { status: 400, headers });

    const secret = env.RESET_SECRET || 'cv-reset-secret-change-me';
    const [timestamp, hmac] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(email + ':' + timestamp));
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (hmac !== expected) return new Response(JSON.stringify({ valid: false, error: 'Invalid token' }), { status: 200, headers });
    if (Date.now() - parseInt(timestamp) > 30 * 60 * 1000) return new Response(JSON.stringify({ valid: false, error: 'Link has expired.' }), { status: 200, headers });

    return new Response(JSON.stringify({ valid: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
