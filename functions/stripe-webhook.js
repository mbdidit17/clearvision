async function verifyStripeSignature(body, sig, secret) {
  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signatures = sig.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const payload = `${timestamp}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig256 = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = Array.from(new Uint8Array(sig256)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (!signatures.includes(expected)) throw new Error('Invalid signature');
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');
}

export async function onRequestPost({ request, env }) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  try {
    await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const event = JSON.parse(body);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    if (!email) return new Response('ok', { status: 200 });

    const liRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items?limit=100`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const liData = await liRes.json();
    const items = liData.data.map(i => ({ name: i.description, price: '£' + (i.amount_total / 100).toFixed(2) }));
    const total = '£' + (session.amount_total / 100).toFixed(2);
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const orderId = session.id.slice(-8).toUpperCase();

    const itemsHtml = items.map(i =>
      `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.1);">
        <span style="color:rgba(255,255,255,0.8)">${i.name}</span>
        <span style="color:#6e28b4;font-weight:bold">${i.price}</span>
      </div>`
    ).join('');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Clear Vision <noreply@clearvision.ink>',
        to: email,
        subject: `Order Confirmed — #${orderId}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#000;color:#fff;padding:2rem;">
          <h2 style="font-size:1.2rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.25rem;">Order Confirmed</h2>
          <p style="color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:0;">Order #${orderId} · ${date}</p>
          <div style="margin:1.5rem 0;">${itemsHtml}</div>
          <div style="display:flex;justify-content:space-between;padding:1rem 0;font-weight:bold;">
            <span>Total</span><span style="color:#6e28b4">${total}</span>
          </div>
          <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-top:2rem;">Questions? contact@clearvision.ink</p>
        </div>`
      })
    });
  }

  return new Response('ok', { status: 200 });
}
