import Stripe from 'stripe';

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

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const hasSub = items.some(i => isSubscription(i.name));
    const mode = hasSub ? 'subscription' : 'payment';

    const line_items = items.map(item => {
      const recurring = isSubscription(item.name);
      return {
        price_data: {
          currency: 'gbp',
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
          ...(recurring ? { recurring: { interval: 'month' } } : {})
        },
        quantity: 1
      };
    });

    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
      ...(mode === 'payment' ? {
        shipping_address_collection: { allowed_countries: ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'] }
      } : {})
    });

    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
