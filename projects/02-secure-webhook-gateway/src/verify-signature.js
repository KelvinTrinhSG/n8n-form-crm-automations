// Verifies the HMAC-SHA256 signature so only your form provider can call this webhook.
// Supports two common formats:
//   Typeform:  header "typeform-signature: sha256=<base64 HMAC of raw body>"
//   Generic:   headers "x-signature: sha256=<hex HMAC of `${timestamp}.${raw body}`>" + "x-timestamp: <unix seconds>"
//              (the timestamp blocks replay of an old, captured request)
// n8n setup: NODE_FUNCTION_ALLOW_BUILTIN=crypto, N8N_BLOCK_ENV_ACCESS_IN_NODE=false, WEBHOOK_SECRET=<shared secret>.
const crypto = require('crypto');
const item = $input.first();
const headers = item.json.headers || {};
const secret = $env.WEBHOOK_SECRET;
const MAX_SKEW_SECONDS = 300;

const result = (verdict, reason) => [{
  json: {
    verdict,
    reason,
    headers: { 'x-forwarded-for': headers['x-forwarded-for'] || '', 'user-agent': headers['user-agent'] || '' },
    body: item.json.body || {},
  },
}];

// Fail closed: a missing secret must never mean "accept everything".
if (!secret) return result('rejected', 'server misconfigured: WEBHOOK_SECRET not set');

// The signature is computed over the exact bytes that were sent, so use the raw body (Webhook option "Raw Body").
// Re-serialising the parsed JSON would change spacing/key order and break the comparison.
let raw;
try {
  raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
} catch (e) {
  return result('rejected', 'raw body missing: enable "Raw Body" on the Webhook node');
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

if (headers['typeform-signature']) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('base64');
  return safeEqual(headers['typeform-signature'], expected) ? result('ok', 'typeform signature valid') : result('rejected', 'bad typeform signature');
}

if (headers['x-signature']) {
  const ts = Number(headers['x-timestamp']);
  if (!Number.isFinite(ts)) return result('rejected', 'missing x-timestamp');
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > MAX_SKEW_SECONDS) return result('rejected', `timestamp too old (${Math.round(skew)} s)`);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return safeEqual(headers['x-signature'], expected) ? result('ok', 'signature valid') : result('rejected', 'bad signature');
}

return result('rejected', 'no signature header');
