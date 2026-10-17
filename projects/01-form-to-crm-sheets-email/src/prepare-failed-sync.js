// Runs when a HubSpot call still fails after 3 retries (token expired, HubSpot outage, rate limit).
// The visitor already got "202 Accepted", so the lead must not be lost: it goes into the
// "Failed Syncs" sheet, and the retry worker (project 03) pushes it to HubSpot later.
const { lead } = $('Normalize & Validate').first().json;
const failure = $input.first().json;
const err = typeof failure.error === 'object' && failure.error ? failure.error : { message: failure.error || failure.message };

// Properties may not exist yet if the first HubSpot call (search) failed. Fall back to a plain mapping.
let properties;
try {
  properties = $('Build CRM Payload').first().json.properties;
} catch (e) {
  properties = Object.fromEntries(Object.entries({
    email: lead.email, firstname: lead.first_name, lastname: lead.last_name, company: lead.company,
    website: lead.website, phone: lead.phone, jobtitle: lead.job_title, message: lead.message,
  }).filter(([, v]) => v));
}

const now = new Date();
const code = String(err.httpCode || err.status || (String(err.message || '').match(/\b([45]\d\d)\b/) || [])[1] || '');

return [{
  json: {
    queue_id: `Q-${now.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    created_at: now.toISOString(),
    source_workflow: '01 · Form → CRM',
    stage: $prevNode.name,
    email: lead.email,
    payload: JSON.stringify(properties),
    attempts: 0,
    status: 'pending',
    next_retry_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    last_error_code: code,
    last_error: String(err.message || 'unknown error').slice(0, 500),
    resolved_at: '',
    hubspot_contact_id: '',
  },
}];
