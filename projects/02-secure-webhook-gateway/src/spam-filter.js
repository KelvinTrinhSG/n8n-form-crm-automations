// Decides what happens to a signed submission: accepted, spam, duplicate or rate_limited.
// State (recent fingerprints, requests per IP) is kept in workflow static data.
// Note: static data is only saved for production (active) executions, not for manual test runs.
const crypto = require('crypto');
const data = $input.first().json;
if (data.verdict === 'rejected') return [{ json: { ...data, reasons: [data.reason] } }];

const body = data.body || {};
const state = $getWorkflowStaticData('global');
state.seen = state.seen || {};       // fingerprint → last seen (ms)
state.ips = state.ips || {};         // ip → [request times (ms)]
const now = Date.now();

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;                 // submissions per IP per window
const MIN_FILL_TIME_MS = 3000;        // humans need more than 3 s to fill a form
const HONEYPOT_FIELDS = ['website_url', '_hp', 'fax_number'];  // hidden with CSS, bots fill them
const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com'];
const SPAM_WORDS = /\b(seo services?|backlinks?|casino|crypto ?invest|viagra|loan offer|guest post|rank (your|on) google)\b/i;

// Forget old entries so static data does not grow forever.
for (const [k, t] of Object.entries(state.seen)) if (now - t > 24 * 3600 * 1000) delete state.seen[k];
for (const [ip, times] of Object.entries(state.ips)) {
  state.ips[ip] = times.filter((t) => now - t < RATE_WINDOW_MS);
  if (!state.ips[ip].length) delete state.ips[ip];
}

const emailAddr = String(body.email || body.Email || '').trim().toLowerCase();
const message = String(body.message || body.Message || '');
const ip = String(data.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

const out = (verdict, reasons) => {
  const forward = { ...body };
  for (const f of [...HONEYPOT_FIELDS, '_rendered_at']) delete forward[f];
  return [{ json: { verdict, reasons, ip, email: emailAddr, received_at: new Date(now).toISOString(), message_excerpt: message.slice(0, 200), forward_body: forward } }];
};

// 1. Rate limit per IP (counts every signed request, spam or not).
state.ips[ip] = [...(state.ips[ip] || []), now];
if (ip !== 'unknown' && state.ips[ip].length > RATE_LIMIT) return out('rate_limited', [`${state.ips[ip].length} requests from ${ip} in 10 min`]);

// 2. Spam signals. A filled honeypot is decisive; otherwise two weak signals are needed.
const filledHoneypot = HONEYPOT_FIELDS.find((f) => String(body[f] || '').trim());
if (filledHoneypot) return out('spam', [`honeypot field "${filledHoneypot}" filled`]);

const signals = [];
const renderedAt = Number(body._rendered_at);
if (Number.isFinite(renderedAt) && now - renderedAt < MIN_FILL_TIME_MS) signals.push(`form filled in ${now - renderedAt} ms`);
const domain = emailAddr.split('@')[1] || '';
if (DISPOSABLE.includes(domain)) signals.push(`disposable email domain ${domain}`);
const links = (message.match(/https?:\/\//g) || []).length;
if (links > 3) signals.push(`${links} links in message`);
if (SPAM_WORDS.test(message)) signals.push(`spam phrase: "${message.match(SPAM_WORDS)[0]}"`);
if (/[Ѐ-ӿ]{20,}/.test(message) && !/[a-z]{3,}/i.test(message)) signals.push('message is only Cyrillic text');
if (signals.length >= 2) return out('spam', signals);

// 3. Duplicates: double clicks, browser resubmits and provider retries.
const submissionKey = body.submission_id || body.event_id || body.token;
const fingerprint = crypto.createHash('sha256')
  .update(submissionKey ? `id:${submissionKey}` : `${emailAddr}|${message.toLowerCase().replace(/\s+/g, ' ').trim()}`)
  .digest('hex').slice(0, 16);
const lastSeen = state.seen[fingerprint];
state.seen[fingerprint] = now;
if (lastSeen && (submissionKey || now - lastSeen < DUPLICATE_WINDOW_MS)) {
  return out('duplicate', [`same submission seen ${Math.round((now - lastSeen) / 1000)} s ago`]);
}

return out('accepted', signals); // a single weak signal is passed on, not blocked
