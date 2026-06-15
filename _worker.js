function isSubscription(name) { return /coaching/i.test(name); }
function enc(v) { return encodeURIComponent(v); }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

const CORS_PREFLIGHT = new Response(null, { status: 200, headers: {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}});

// ── AUTH HELPERS ──
async function hashPw(password, saltHex) {
  const te = new TextEncoder();
  const saltBytes = saltHex
    ? new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const saltStr = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltStr}:${hash}`;
}
async function legacySha256(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPw(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) {
    return { valid: (await legacySha256(password)) === stored, legacy: true };
  }
  const saltHex = stored.split(':')[1];
  return { valid: (await hashPw(password, saltHex)) === stored, legacy: false };
}
function genToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function verifySession(token, email, env) {
  if (!token || !email) return false;
  const raw = await env.CV_USERS.get('session:' + token);
  if (!raw) return false;
  return JSON.parse(raw).email === email;
}
function safeUser(u) { const { passwordHash, ...rest } = u; return rest; }
async function rateLimit(env, key, max, windowSecs) {
  const k = 'rl:' + key;
  const raw = await env.CV_USERS.get(k);
  const data = raw ? JSON.parse(raw) : { count: 0, reset: Date.now() + windowSecs * 1000 };
  if (Date.now() > data.reset) { data.count = 0; data.reset = Date.now() + windowSecs * 1000; }
  data.count++;
  await env.CV_USERS.put(k, JSON.stringify(data), { expirationTtl: windowSecs });
  return data.count > max;
}

// ── AUTH ENDPOINTS ──
async function handleAuthRegister(request, env) {
  try {
    const { email, password, name } = await request.json();
    if (!email || !password || !name) return new Response(JSON.stringify({ error: 'All fields required' }), { status: 400, headers: CORS });
    if (email.length > 254 || password.length > 128 || name.length > 100) return new Response(JSON.stringify({ error: 'Input too long' }), { status: 400, headers: CORS });
    if (password.length < 6) return new Response(JSON.stringify({ error: 'Password too short' }), { status: 400, headers: CORS });
    if (await rateLimit(env, 'reg:' + email, 5, 3600)) return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429, headers: CORS });
    const ex = await env.CV_USERS.get('user:' + email);
    if (ex) return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), { status: 409, headers: CORS });
    const passwordHash = await hashPw(password);
    const joined = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const user = { email, name, passwordHash, orders:[], subscriptions:[], basket:[], joined, coachingApplication:[] };
    await env.CV_USERS.put('user:' + email, JSON.stringify(user));
    const token = genToken();
    await env.CV_USERS.put('session:' + token, JSON.stringify({ email }), { expirationTtl: 30 * 24 * 3600 });
    return new Response(JSON.stringify({ user: safeUser(user), sessionToken: token }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleAuthLogin(request, env) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: CORS });
    if (email.length > 254 || password.length > 128) return new Response(JSON.stringify({ error: 'Input too long' }), { status: 400, headers: CORS });
    if (await rateLimit(env, 'login:' + email, 5, 900)) return new Response(JSON.stringify({ error: 'Too many attempts. Try again in 15 minutes.' }), { status: 429, headers: CORS });
    const raw = await env.CV_USERS.get('user:' + email);
    if (!raw) return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401, headers: CORS });
    const user = JSON.parse(raw);
    const { valid, legacy } = await verifyPw(password, user.passwordHash);
    if (!valid) return new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401, headers: CORS });
    if (legacy) { user.passwordHash = await hashPw(password); await env.CV_USERS.put('user:' + email, JSON.stringify(user)); }
    const token = genToken();
    await env.CV_USERS.put('session:' + token, JSON.stringify({ email }), { expirationTtl: 30 * 24 * 3600 });
    return new Response(JSON.stringify({ user: safeUser(user), sessionToken: token }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleAuthUpdate(request, env) {
  try {
    const { email, sessionToken, data } = await request.json();
    if (!await verifySession(sessionToken, email, env)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    const raw = await env.CV_USERS.get('user:' + email);
    if (!raw) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS });
    const user = JSON.parse(raw);
    const allowed = ['orders','subscriptions','basket','coachingApplication','name'];
    const updated = { ...user };
    for (const f of allowed) { if (data[f] !== undefined) updated[f] = data[f]; }
    await env.CV_USERS.put('user:' + email, JSON.stringify(updated));
    return new Response(JSON.stringify({ ok: true, user: safeUser(updated) }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleAuthGet(request, env) {
  try {
    const u = new URL(request.url);
    const email = u.searchParams.get('email'), token = u.searchParams.get('token');
    if (!await verifySession(token, email, env)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    const raw = await env.CV_USERS.get('user:' + email);
    if (!raw) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS });
    return new Response(JSON.stringify({ user: safeUser(JSON.parse(raw)) }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleAuthAdmin(request, env) {
  try {
    const u = new URL(request.url);
    const email = u.searchParams.get('email'), token = u.searchParams.get('token');
    if (!await verifySession(token, email, env) || email !== 'marcelaug28@gmail.com')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    const list = await env.CV_USERS.list({ prefix: 'user:' });
    const users = await Promise.all(list.keys.map(async k => {
      const raw = await env.CV_USERS.get(k.name);
      return raw ? safeUser(JSON.parse(raw)) : null;
    }));
    return new Response(JSON.stringify({ users: users.filter(Boolean) }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleAuthSignout(request, env) {
  try {
    const { sessionToken } = await request.json();
    if (sessionToken) await env.CV_USERS.delete('session:' + sessionToken);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }
}

async function handleAuthResetPassword(request, env) {
  try {
    const { email, token, newPassword } = await request.json();
    if (!email || !token || !newPassword) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: CORS });
    const secret = env.RESET_SECRET || 'cv-reset-secret-change-me';
    const [timestamp, hmac] = token.split('.');
    const te = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, te.encode(email + ':' + timestamp));
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hmac !== expected || Date.now() - parseInt(timestamp) > 30 * 60 * 1000)
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: CORS });
    const raw = await env.CV_USERS.get('user:' + email);
    if (!raw) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS });
    const user = JSON.parse(raw);
    user.passwordHash = await hashPw(newPassword); // PBKDF2
    await env.CV_USERS.put('user:' + email, JSON.stringify(user));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// ── EXISTING ENDPOINTS ──
async function handleCheckout(request, env) {
  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0)
      return new Response(JSON.stringify({ error: 'No items provided' }), { status: 400, headers: CORS });

    const hasSub = items.some(i => isSubscription(i.name));
    const mode = hasSub ? 'subscription' : 'payment';
    const siteUrl = env.SITE_URL || 'https://clearvision.ink';

    const parts = [
      `mode=${enc(mode)}`,
      `success_url=${enc(siteUrl + '/?checkout=success')}`,
      `cancel_url=${enc(siteUrl + '/?checkout=cancel')}`
    ];

    items.forEach((item, i) => {
      parts.push(`line_items[${i}][quantity]=1`);
      parts.push(`line_items[${i}][price_data][currency]=gbp`);
      parts.push(`line_items[${i}][price_data][unit_amount]=${Math.round(item.price * 100)}`);
      parts.push(`line_items[${i}][price_data][product_data][name]=${enc(item.name)}`);
      if (isSubscription(item.name)) parts.push(`line_items[${i}][price_data][recurring][interval]=month`);
    });

    if (mode === 'payment') {
      ['GB','IE','US','CA','AU','NZ','FR','DE','ES','IT','NL'].forEach((c, i) => {
        parts.push(`shipping_address_collection[allowed_countries][${i}]=${c}`);
      });
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: parts.join('&')
    });
    const session = await res.json();
    if (!res.ok) throw new Error(session.error?.message || 'Stripe error');
    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handlePortal(request, env) {
  try {
    const { email } = await request.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: CORS });
    const cusRes = await fetch(`https://api.stripe.com/v1/customers?email=${enc(email)}&limit=1`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const cusData = await cusRes.json();
    if (!cusData.data?.length) return new Response(JSON.stringify({ error: 'No customer found' }), { status: 404, headers: CORS });
    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `customer=${enc(cusData.data[0].id)}&return_url=${enc(siteUrl)}`
    });
    const portal = await portalRes.json();
    if (!portalRes.ok) throw new Error(portal.error?.message || 'Stripe error');
    return new Response(JSON.stringify({ url: portal.url }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handlePasswordReset(request, env) {
  try {
    const { email } = await request.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: CORS });
    const secret = env.RESET_SECRET || 'cv-reset-secret-change-me';
    const timestamp = Date.now();
    const te = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, te.encode(email + ':' + timestamp));
    const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const token = timestamp + '.' + hmac;
    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const resetUrl = `${siteUrl}/?reset=${enc(token)}&email=${enc(email)}`;
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Clear Vision <noreply@clearvision.ink>',
        to: email,
        subject: 'Reset your Clear Vision password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#000;color:#fff;padding:2rem;"><h2 style="font-size:1.4rem;letter-spacing:0.1em;text-transform:uppercase;">Password Reset</h2><p style="color:rgba(255,255,255,0.6);font-size:0.9rem;line-height:1.7;">Click the button below to reset your password. This link expires in 30 minutes.</p><a href="${resetUrl}" style="display:inline-block;margin:1.5rem 0;padding:0.8rem 1.6rem;background:#6e28b4;color:#fff;text-decoration:none;font-size:0.85rem;letter-spacing:0.1em;text-transform:uppercase;">Reset Password</a><p style="color:rgba(255,255,255,0.3);font-size:0.75rem;">If you didn't request this, ignore this email.</p></div>`
      })
    });
    if (!emailRes.ok) { const e = await emailRes.json(); throw new Error(e.message || 'Failed to send email'); }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleVerifyToken(request, env) {
  try {
    const { token, email } = await request.json();
    if (!token || !email) return new Response(JSON.stringify({ valid: false, error: 'Token and email required' }), { status: 400, headers: CORS });
    const secret = env.RESET_SECRET || 'cv-reset-secret-change-me';
    const [timestamp, hmac] = token.split('.');
    const te = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, te.encode(email + ':' + timestamp));
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hmac !== expected) return new Response(JSON.stringify({ valid: false, error: 'Invalid token' }), { status: 200, headers: CORS });
    if (Date.now() - parseInt(timestamp) > 30 * 60 * 1000) return new Response(JSON.stringify({ valid: false, error: 'Link has expired.' }), { status: 200, headers: CORS });
    return new Response(JSON.stringify({ valid: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: err.message }), { status: 500, headers: CORS });
  }
}

async function handleWebhook(request, env) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();
  try {
    const parts = sig.split(',').reduce((a, p) => { const [k,v]=p.split('='); a[k]=v; return a; }, {});
    const timestamp = parts.t;
    const signatures = sig.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
    const payload = `${timestamp}.${body}`;
    const te = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', te.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig256 = await crypto.subtle.sign('HMAC', key, te.encode(payload));
    const expected = Array.from(new Uint8Array(sig256)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (!signatures.includes(expected)) return new Response('Invalid signature', { status: 400 });
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return new Response('Timestamp too old', { status: 400 });
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const event = JSON.parse(body);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    if (email) {
      const liRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items?limit=100`, {
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      const liData = await liRes.json();
      const items = liData.data.map(i => ({ name: i.description, price: '£' + (i.amount_total / 100).toFixed(2) }));
      const isCoachingOrder = items.some(i => /coaching/i.test(i.name));
      const total = '£' + (session.amount_total / 100).toFixed(2);
      const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const orderId = session.id.slice(-8).toUpperCase();
      const itemsHtml = items.map(i => `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.1);"><span style="color:rgba(255,255,255,0.8)">${i.name}</span><span style="color:#6e28b4;font-weight:bold">${i.price}</span></div>`).join('');
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Clear Vision <noreply@clearvision.ink>',
          to: email,
          subject: `Order Confirmed — #${orderId}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#000;color:#fff;padding:2rem;"><h2 style="font-size:1.2rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.25rem;">Order Confirmed</h2><p style="color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:0;">Order #${orderId} · ${date}</p><div style="margin:1.5rem 0;">${itemsHtml}</div><div style="display:flex;justify-content:space-between;padding:1rem 0;font-weight:bold;"><span>Total</span><span style="color:#6e28b4">${total}</span></div>${isCoachingOrder ? `<div style="margin:1.5rem 0;padding:1.25rem;border:1px solid rgba(110,40,180,0.4);background:rgba(110,40,180,0.08);"><p style="font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;color:#a855f7;margin-bottom:0.5rem;">Next Step — WhatsApp</p><p style="font-size:0.82rem;color:rgba(255,255,255,0.6);line-height:1.7;margin:0;">Once your application has been reviewed we will be in touch within 24 hours. Message us on WhatsApp at <strong style="color:#fff;">+44 7435 719383</strong> and open with:<br><br><strong style="color:#fff;">"Hi, my name is [Your Name] — order #${orderId}"</strong></p></div>` : ''}<p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-top:2rem;">Questions? contact@clearvision.ink</p></div>`
        })
      });
    }
  }
  return new Response('ok', { status: 200 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return CORS_PREFLIGHT;

    if (request.method === 'GET') {
      if (path === '/functions/auth/user') return handleAuthGet(request, env);
      if (path === '/functions/auth/admin') return handleAuthAdmin(request, env);
    }

    if (request.method === 'POST') {
      if (path === '/functions/auth/register') return handleAuthRegister(request, env);
      if (path === '/functions/auth/signout') return handleAuthSignout(request, env);
      if (path === '/functions/auth/login') return handleAuthLogin(request, env);
      if (path === '/functions/auth/update') return handleAuthUpdate(request, env);
      if (path === '/functions/auth/reset-password') return handleAuthResetPassword(request, env);
      if (path === '/functions/create-checkout-session') return handleCheckout(request, env);
      if (path === '/functions/create-portal-session') return handlePortal(request, env);
      if (path === '/functions/request-password-reset') return handlePasswordReset(request, env);
      if (path === '/functions/verify-reset-token') return handleVerifyToken(request, env);
      if (path === '/functions/stripe-webhook') return handleWebhook(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
