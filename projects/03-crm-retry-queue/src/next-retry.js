// Failure branch: decide whether to try again later or give up.
//   400 / 404 / 422  → the data itself is wrong; retrying will never work → "dead" now
//   401 / 403        → token revoked or missing scope; retry, but tell ops on the first failure
//   429 / 5xx / network → temporary; retry with exponential backoff
// Backoff: 15 min, 30 min, 1 h, 2 h, 4 h, then dead after MAX_ATTEMPTS.
const MAX_ATTEMPTS = 6;
const BASE_DELAY_MIN = 15;
const MAX_DELAY_MIN = 6 * 60;

const row = $('Pick Due Retries').item.json;
const err = typeof $json.error === 'object' && $json.error ? $json.error : { message: $json.error || $json.message || 'unknown error' };
const message = String(err.description || err.message || '').slice(0, 500);
const code = Number(err.httpCode || err.status || (message.match(/\b([45]\d\d)\b/) || [])[1]) || 0;

const attempts = row.attempts + 1;
let kind = 'temporary';
if ([400, 404, 409, 422].includes(code)) kind = 'permanent';
else if ([401, 403].includes(code)) kind = 'auth';

let status = 'pending';
if (kind === 'permanent' || attempts >= MAX_ATTEMPTS) status = 'dead';

const delayMin = Math.min(BASE_DELAY_MIN * 2 ** (attempts - 1), MAX_DELAY_MIN);
const jitterMs = Math.floor(Math.random() * 60 * 1000); // spread retries so they do not all fire together
const nextRetryAt = status === 'pending' ? new Date(Date.now() + delayMin * 60 * 1000 + jitterMs).toISOString() : '';

const escalate = status === 'dead' || (kind === 'auth' && attempts === 1);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const why = {
  permanent: 'HubSpot rejected the data. Fix the payload in the sheet, set status back to "pending" and it will be retried.',
  auth: 'HubSpot refused the token. Check the private app token and its scopes (crm.objects.contacts.write) in n8n credentials.',
  temporary: `Gave up after ${attempts} attempts.`,
}[kind];

return {
  json: {
    queue_id: row.queue_id,
    email: row.email,
    attempts,
    status,
    next_retry_at: nextRetryAt,
    last_error_code: code ? String(code) : '',
    last_error: message,
    error_kind: kind,
    escalate,
    email_subject: `[CRM sync] ${status === 'dead' ? 'Gave up on' : 'Auth problem for'} ${row.email} (${code || 'no code'})`,
    email_html: `<p><b>Queue ID:</b> ${esc(row.queue_id)}<br><b>Email:</b> ${esc(row.email)}<br><b>Source:</b> ${esc(row.source_workflow)}<br>`
      + `<b>Attempts:</b> ${attempts}<br><b>Error ${code || ''}:</b> ${esc(message)}</p><p>${esc(why)}</p>`,
  },
};
