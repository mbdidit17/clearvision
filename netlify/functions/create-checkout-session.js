// Netlify Function: Creates a Stripe Checkout Session with all basket items.
// Requires STRIPE_SECRET_KEY in Netlify env vars. Set SITE_URL to your domain.
// Install: npm install stripe (in your project root, OR add netlify/functions/package.json)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Detects whether a line item is a recurring coaching subscription
function isSubscription(name) {
  return /coaching/i.test(name);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items provided' }) };
    }

    // Stripe Checkout cannot mix subscription + one-time in the same session.
    // If basket contains a coaching plan, that becomes the subscription session.
    // (Recommend keeping coaching and merch as separate checkouts.)
    const hasSub = items.some(i => isSubscription(i.name));
    const mode = hasSub ? 'subscription' : 'payment';

    const line_items = items.map(item => {
      const recurring = isSubscription(item.name);
      return {
        price_data: {
          currency: 'gbp',
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100), // pence
          ...(recurring ? { recurring: { interval: 'month' } } : {})
        },
        quantity: 1
      };
    });

    const siteUrl = process.env.SITE_URL || `https://${event.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
      // Collect shipping for merch
      ...(mode === 'payment' ? {
        shipping_address_collection: { allowed_countries: ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'] }
      } : {})
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
