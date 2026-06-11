export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { email } = await request.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers });

    const secret = env.RESET_SECRET || 'cv-reset-secret-change-me';
    const timestamp = Date.now();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(email + ':' + timestamp));
    const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const token = timestamp + '.' + hmac;

    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const resetUrl = `${siteUrl}/?reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Clear Vision <noreply@clearvision.ink>',
        to: email,
        subject: 'Reset your Clear Vision password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#000;color:#fff;padding:2rem;">
          <h2 style="font-size:1.4rem;letter-spacing:0.1em;text-transform:uppercase;">Password Reset</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;line-height:1.7;">Click the button below to reset your password. This link expires in 30 minutes.</p>
          <a href="${resetUrl}" style="display:inline-block;margin:1.5rem 0;padding:0.8rem 1.6rem;background:#6e28b4;color:#fff;text-decoration:none;font-size:0.85rem;letter-spacing:0.1em;text-transform:uppercase;">Reset Password</a>
          <p style="color:rgba(255,255,255,0.3);font-size:0.75rem;">If you didn't request this, ignore this email.</p>
        </div>`
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      throw new Error(err.message || 'Failed to send email');
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
