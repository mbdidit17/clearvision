function isSubscription(name) {
  return /coaching/i.test(name);
}

function enc(v) { return encodeURIComponent(v); }

export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'No items provided' }), { status: 400, headers });
    }

    const hasSub = items.some(i => isSubscription(i.name));
    const mode = hasSub ? 'subscription' : 'payment';
    const siteUrl = env.SITE_URL || 'https://clearvision.ink';

    const parts = [
      `mode=${enc(mode)}`,
      `success_url=${enc(`${siteUrl}/?checkout=success`)}`,
      `cancel_url=${enc(`${siteUrl}/?checkout=cancel`)}`
    ];

    items.forEach((item, i) => {
      const sub = isSubscription(item.name);
      parts.push(`line_items[${i}][quantity]=1`);
      parts.push(`line_items[${i}][price_data][currency]=gbp`);
      parts.push(`line_items[${i}][price_data][unit_amount]=${Math.round(item.price * 100)}`);
      parts.push(`line_items[${i}][price_data][product_data][name]=${enc(item.name)}`);
      if (sub) parts.push(`line_items[${i}][price_data][recurring][interval]=month`);
    });

    if (mode === 'payment') {
      ['GB','IE','US','CA','AU','NZ','FR','DE','ES','IT','NL'].forEach((c, i) => {
        parts.push(`shipping_address_collection[allowed_countries][${i}]=${c}`);
      });
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: parts.join('&')
    });

    const session = await res.json();
    if (!res.ok) throw new Error(session.error?.message || 'Stripe error');

    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
