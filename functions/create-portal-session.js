export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { email } = await request.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers });

    const cusRes = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const cusData = await cusRes.json();
    if (!cusData.data?.length) return new Response(JSON.stringify({ error: 'No customer found' }), { status: 404, headers });

    const siteUrl = env.SITE_URL || 'https://clearvision.ink';
    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `customer=${encodeURIComponent(cusData.data[0].id)}&return_url=${encodeURIComponent(siteUrl)}`
    });

    const portal = await portalRes.json();
    if (!portalRes.ok) throw new Error(portal.error?.message || 'Stripe error');

    return new Response(JSON.stringify({ url: portal.url }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
