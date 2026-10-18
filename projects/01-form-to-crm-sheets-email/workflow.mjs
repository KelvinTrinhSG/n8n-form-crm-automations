import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR, QUEUE_FIELDS, codeFrom, note, webhook, respond, ifTrue, hubspot, sheetsWrite, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));

const LEAD_FIELDS = ['email', 'first_name', 'last_name', 'phone', 'company', 'job_title', 'website', 'message', 'consent',
  'form_name', 'page_url', 'utm_source', 'utm_medium', 'utm_campaign', 'hubspot_contact_id', 'crm_action',
  'changed_fields', 'warnings', 'last_submitted_at', 'submission_id', 'sla_level', 'sla_alerted_at'];

const SEARCH_BODY = `={{ JSON.stringify({
  filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: $json.lead.email }] }],
  properties: ['email', 'firstname', 'lastname', 'company', 'website', 'phone', 'jobtitle', 'message', 'lifecyclestage', 'hubspot_owner_id'],
  limit: 1
}) }}`;

const n = {
  hook: note(webhook('Lead Form Webhook', 'lead-form', '3a7d2c10-1b4e-4f6a-9c21-0e5f8a7b6c01'), 'POST /webhook/lead-form'),
  normalize: note(code('Normalize & Validate', 'normalize-lead.js'), 'Aliases · trim · email/phone/name fixes'),
  valid: note(ifTrue('Is Valid?', '={{ $json.valid }}'), 'Email present and well-formed'),
  bad: note(respond('Respond 400 Invalid', 400, '={{ JSON.stringify({ ok: false, errors: $json.errors }) }}'), 'Form shows the errors'),
  ok: note(respond('Respond 202 Accepted', 202, '={{ JSON.stringify({ ok: true, id: $json.lead.submission_id }) }}'), 'Visitor never waits for the CRM'),
  find: note(hubspot('HubSpot · Find Contact', 'POST', '/crm/v3/objects/contacts/search', SEARCH_BODY), 'Search by email'),
  payload: note(code('Build CRM Payload', 'build-crm-payload.js'), 'No blank overwrites · stage only forward'),
  exists: note(ifTrue('Contact Exists?', "={{ $json.action === 'update' }}"), 'Update or create'),
  // HubSpot answers 400 to a PATCH with no properties, so an identical resubmission skips the call.
  changes: note(ifTrue('Anything to Update?', '={{ Object.keys($json.properties).length > 0 }}'), 'Identical resubmit → skip PATCH'),
  update: note(hubspot('HubSpot · Update Contact', 'PATCH', '/crm/v3/objects/contacts/{{ $json.contact_id }}',
    '={{ JSON.stringify({ properties: $json.properties }) }}'), 'PATCH changed fields only'),
  create: note(hubspot('HubSpot · Create Contact', 'POST', '/crm/v3/objects/contacts/batch/upsert',
    "={{ JSON.stringify({ inputs: [{ idProperty: 'email', id: $json.properties.email, properties: $json.properties }] }) }}"), 'Upsert by email · race-safe'),
  collect: note(code('Collect CRM Result', 'collect-result.js'), 'One row per person'),
  sheet: note(sheetsWrite('Upsert Leads Sheet', 'Leads', { operation: 'appendOrUpdate', match: 'email', fields: LEAD_FIELDS }), 'Tab "Leads" · key = email'),
  mail: note(code('Build Notification Email', 'build-email.js'), 'HTML · all input escaped'),
  send: note(email('Email Sales Team'), 'SMTP → sales inbox'),
  failed: note(code('Prepare Failed Sync', 'prepare-failed-sync.js'), 'Keep the lead, record the error'),
  queue: note(sheetsWrite('Add to Retry Queue', 'Failed Syncs', { fields: QUEUE_FIELDS }), 'Tab "Failed Syncs" → project 03'),
};

const { c, connect, chain } = connections();
chain(n.hook, n.normalize, n.valid);
connect(n.valid, n.ok, 0);
connect(n.valid, n.bad, 1);
chain(n.ok, n.find, n.payload, n.exists);
connect(n.exists, n.changes, 0);
connect(n.exists, n.create, 1);
connect(n.changes, n.update, 0);
connect(n.changes, n.collect, 1);
connect(n.update, n.collect);
connect(n.create, n.collect);
chain(n.collect, n.sheet, n.mail, n.send);
for (const h of [n.find, n.update, n.create]) connect(h, n.failed, 1); // red error outputs
connect(n.failed, n.queue);

export default [{
  file: 'workflow.json',
  workflow: workflow('01 · Form → HubSpot (create/update) → Google Sheets → Email', {
    connections: c,
    overview: `# 📥 01 · Form → CRM → Sheets → Email
**Every website form submission becomes a clean HubSpot contact, a row in the Leads sheet and an email to sales, in seconds.**

### Replaces
Copying each submission into HubSpot, checking for an existing contact, pasting it into the tracking sheet and forwarding it to sales. **≈ 6 min per lead.**

### Flow
1. Website form POSTs to the webhook
2. Data cleaned + validated (bad data → 400)
3. Visitor gets **202** immediately
4. HubSpot: search by email → **update** or **create**
5. Leads sheet: **append or update** by email
6. HTML email to sales

### Data rules
- Never overwrite CRM data with blanks
- Name/company: fill only if empty
- Lifecycle stage only moves forward

### Reliability
- HubSpot: 3 retries, then the lead goes to **Failed Syncs** → retried by **03**
- Any other failure → **10 · Error Handler**`,
    stages: [
      { title: '① Capture', color: COLOR.green, body: 'Webhook from any form builder.', nodes: [n.hook] },
      { title: '② Clean & validate', color: COLOR.orange, body: 'Map aliases, fix typos.\nReject bad data with 400.', nodes: [n.normalize, n.valid, [n.ok, n.bad]] },
      { title: '③ CRM create / update', color: COLOR.purple, body: 'Search → decide → write.\nRed outputs = failed after retries.', nodes: [n.find, n.payload, n.exists, [n.changes, n.create], n.update] },
      { title: '④ Sheet & notify', color: COLOR.blue, body: 'One row per person.\nEmail the sales team.', nodes: [n.collect, n.sheet, n.mail, n.send] },
      { title: '⑤ Failure path', color: COLOR.red, body: 'Lead kept in the retry queue.', nodes: [n.failed, n.queue] },
    ],
  }),
}];
