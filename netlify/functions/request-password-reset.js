const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

    const secret = process.env.RESET_SECRET || 'cv-reset-secret-change-me';
    const timestamp = Date.now();
    const hmac = crypto.createHmac('sha256', secret).update(email + ':' + timestamp).digest('hex');
    const token = timestamp + '.' + hmac;

    const siteUrl = process.env.SITE_URL || `https://${event.headers.host}`;
    const resetUrl = `${siteUrl}/?reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Clear Vision <noreply@clearvision.ink>',
        to: email,
        subject: 'Reset your Clear Vision password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#000;color:#fff;padding:2rem;">
            <h2 style="font-size:1.4rem;letter-spacing:0.1em;text-transform:uppercase;">Password Reset</h2>
            <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;line-height:1.7;">
              Click the button below to reset your password. This link expires in 30 minutes.
            </p>
            <a href="${resetUrl}" style="display:inline-block;margin:1.5rem 0;padding:0.8rem 1.6rem;background:#6e28b4;color:#fff;text-decoration:none;font-size:0.85rem;letter-spacing:0.1em;text-transform:uppercase;">
              Reset Password
            </a>
            <p style="color:rgba(255,255,255,0.3);font-size:0.75rem;">
              If you didn't request this, ignore this email — your password won't change.
            </p>
          </div>`
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      throw new Error(err.message || 'Failed to send email');
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
