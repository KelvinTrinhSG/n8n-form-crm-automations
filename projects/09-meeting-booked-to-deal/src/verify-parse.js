// Verifies Calendly's webhook signature, then flattens the event into the fields the workflow needs.
// Header: "Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${raw body}`>"
// n8n setup: NODE_FUNCTION_ALLOW_BUILTIN=crypto, N8N_BLOCK_ENV_ACCESS_IN_NODE=false, CALENDLY_SIGNING_KEY=<key>.
//
// Event kinds:
//   invitee.created                      → booked (old_invitee set = it is a reschedule)
//   invitee.canceled + rescheduled=true  → ignored (Calendly sends a new invitee.created right after)
//   invitee.canceled                     → canceled
const crypto = require('crypto');
const MAX_SKEW_SECONDS = 300;
const item = $input.first();
const headers = item.json.headers || {};
const body = item.json.body || {};
const key = $env.CALENDLY_SIGNING_KEY;

const invalid = (reason) => [{ json: { valid: false, reason } }];
if (!key) return invalid('CALENDLY_SIGNING_KEY not set');
let raw;
try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); } catch (e) { return invalid('raw body missing'); }

const sigHeader = String(headers['calendly-webhook-signature'] || '');
const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.trim().split('=')));
if (!parts.t || !parts.v1) return invalid('no signature header');
if (Math.abs(Date.now() / 1000 - Number(parts.t)) > MAX_SKEW_SECONDS) return invalid('signature timestamp too old');
const expected = crypto.createHmac('sha256', key).update(`${parts.t}.${raw}`).digest('hex');
const a = Buffer.from(parts.v1);
const b = Buffer.from(expected);
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return invalid('bad signature');

const p = body.payload || {};
const ev = p.scheduled_event || {};
const host = (ev.event_memberships || [])[0] || {};
const answers = (p.questions_and_answers || []).map((x) => ({ q: x.question, a: x.answer }));
const answer = (re) => (answers.find((x) => re.test(x.q || '')) || {}).a || '';

let kind = 'ignored';
if (body.event === 'invitee.created') kind = 'booked';
else if (body.event === 'invitee.canceled') kind = p.rescheduled ? 'ignored' : 'canceled';

const firstName = p.first_name || String(p.name || '').split(' ')[0] || '';
const lastName = p.last_name || String(p.name || '').split(' ').slice(1).join(' ');
const company = answer(/company|organi[sz]ation|business/i);
const phone = p.text_reminder_number || answer(/phone|mobile/i);

const contactProperties = Object.fromEntries(Object.entries({
  email: String(p.email || '').toLowerCase(), firstname: firstName, lastname: lastName, company, phone,
}).filter(([, v]) => v));

return [{
  json: {
    valid: true,
    kind,
    event: body.event,
    invitee_uri: p.uri || '',
    old_invitee_uri: p.old_invitee || '',
    lookup_uri: p.old_invitee || p.uri || '',
    email: contactProperties.email || '',
    name: p.name || [firstName, lastName].join(' ').trim(),
    company,
    meeting_name: ev.name || '',
    start_time: ev.start_time || '',
    end_time: ev.end_time || '',
    invitee_timezone: p.timezone || '',
    join_url: (ev.location || {}).join_url || '',
    host_name: host.user_name || '',
    host_email: host.user_email || '',
    answers,
    utm_source: (p.tracking || {}).utm_source || '',
    utm_campaign: (p.tracking || {}).utm_campaign || '',
    cancel_reason: (p.cancellation || {}).reason || '',
    canceled_by: (p.cancellation || {}).canceled_by || '',
    contact_properties: contactProperties,
    deal_name: `${company || p.name || p.email} · ${ev.name || 'Meeting'}`,
  },
}];
