const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;
    if (!email) return { statusCode: 200, body: 'ok' };

    // Fetch line items
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    const items = lineItems.data.map(i => ({
      name: i.description,
      price: '£' + (i.amount_total / 100).toFixed(2)
    }));
    const total = '£' + (session.amount_total / 100).toFixed(2);
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const orderId = session.id.slice(-8).toUpperCase();

    // Send order confirmation email via Resend
    const itemsHtml = items.map(i =>
      `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.1);">
        <span style="color:rgba(255,255,255,0.8)">${i.name}</span>
        <span style="color:#6e28b4;font-weight:bold">${i.price}</span>
      </div>`
    ).join('');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Clear Vision <noreply@clearvision.ink>',
        to: email,
        subject: `Order Confirmed — #${orderId}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#000;color:#fff;padding:2rem;">
            <h2 style="font-size:1.2rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.25rem;">Order Confirmed</h2>
            <p style="color:rgba(255,255,255,0.4);font-size:0.8rem;letter-spacing:0.1em;margin-top:0;">Order #${orderId} · ${date}</p>
            <div style="margin:1.5rem 0;">${itemsHtml}</div>
            <div style="display:flex;justify-content:space-between;padding:1rem 0;font-size:1rem;font-weight:bold;">
              <span>Total</span><span style="color:#6e28b4">${total}</span>
            </div>
            <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-top:2rem;">
              If you purchased coaching, you'll hear from us within 24 hours to get started.<br/>
              Questions? Reply to this email or contact us at contact@clearvision.ink
            </p>
          </div>`
      })
    });
  }

  return { statusCode: 200, body: 'ok' };
};
