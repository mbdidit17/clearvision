// Netlify Function: Creates a Stripe Customer Portal session.
// Lets customers manage / cancel their coaching subscription.
// Requires STRIPE_SECRET_KEY env var, and the Customer Portal enabled
// in Stripe Dashboard → Settings → Billing → Customer Portal.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };
    }

    // Find the customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No subscription found for that email.' })
      };
    }

    const siteUrl = process.env.SITE_URL || `https://${event.headers.host}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: siteUrl
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
