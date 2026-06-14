function isSubscription(name) {
  return /coaching/i.test(name);
}

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

    const line_items = items.map(item => {
      const recurring = isSubscription(item.name);
      const priceData = {
        currency: 'gbp',
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100)
      };
      if (recurring) priceData.recurring = { interval: 'month' };
      return { price_data: priceData, quantity: 1 };
    });

    const body = {
      mode,
      line_items,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`
    };

    if (mode === 'payment') {
      body.shipping_address_collection = { allowed_countries: ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'] };
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: toFormData(body)
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

function toFormData(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(...toFormData(item, `${key}[${i}]`).split('&'));
        } else {
          parts.push(`${key}[${i}]=${encodeURIComponent(item)}`);
        }
      });
    } else if (typeof v === 'object' && v !== null) {
      parts.push(...toFormData(v, key).split('&'));
    } else {
      parts.push(`${key}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join('&');
}
