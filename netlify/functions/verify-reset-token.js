const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { token, email } = JSON.parse(event.body || '{}');
    if (!token || !email) return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: 'Token and email required' }) };

    const secret = process.env.RESET_SECRET || 'cv-reset-secret-change-me';
    const [timestamp, hmac] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(email + ':' + timestamp).digest('hex');

    if (hmac !== expected) return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Invalid token' }) };
    if (Date.now() - parseInt(timestamp) > 30 * 60 * 1000) return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Link has expired. Please request a new one.' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ valid: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: err.message }) };
  }
};
