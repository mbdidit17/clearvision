import Stripe from 'stripe';

export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { email } = await request.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers });

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) {
      return new Response(JSON.stringify({ error: 'No customer found' }), { status: 404, headers });
    }

    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: siteUrl
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
