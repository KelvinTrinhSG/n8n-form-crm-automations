import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, COLOR, codeFrom, note, webhook, respond, ifTrue, switchOn, sheetsLookup, sheetsWrite, hubspot, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));
const MEETING_FIELDS = ['invitee_uri', 'status', 'email', 'name', 'company', 'meeting_name', 'start_time', 'host_email',
  'hubspot_contact_id', 'deal_id', 'rescheduled_from', 'cancel_reason', 'utm_source', 'updated_at'];
const hostEmail = (to) => ({ to: `={{ ${to} || '${CONFIG.SALES_EMAIL}' }}` });
const parsed = "$('Verify & Parse Event').first().json";

const n = {
  hook: note(webhook('Calendly Webhook', 'calendly', '7e1a3b5c-9d2f-4a68-8c0e-4f3a2b1c0d09', { rawBody: true }), 'invitee.created / invitee.canceled'),
  verify: note(code('Verify & Parse Event', 'verify-parse.js'), 'Signature · flatten · classify'),
  valid: note(ifTrue('Signature Valid?', '={{ $json.valid }}'), 'Fail closed'),
  r401: note(respond('Respond 401', 401, '={{ JSON.stringify({ ok: false }) }}'), 'Not from Calendly'),
  r200: note(respond('Respond 200', 200, '={{ JSON.stringify({ ok: true }) }}'), 'Fast ack, then work'),
  kind: note(switchOn('Route by Event', '={{ $json.kind }}', ['booked', 'canceled']), 'booked · canceled · (other ignored)'),

  findB: note(sheetsLookup('Find Booking Rows', 'Meetings', 'invitee_uri', `={{ ${parsed}.lookup_uri }}`), 'This or the rescheduled booking'),
  check: note(code('Check Existing Booking', 'check-existing.js'), 'Duplicate → stop · reschedule → reuse deal'),
  newDeal: note(ifTrue('Needs New Deal?', "={{ $json.mode === 'new' }}"), 'Reschedules skip creation'),
  contact: note(hubspot('HubSpot · Upsert Contact', 'POST', '/crm/v3/objects/contacts/batch/upsert',
    "={{ JSON.stringify({ inputs: [{ idProperty: 'email', id: $json.contact_properties.email, properties: $json.contact_properties }] }) }}",
    { onError: 'stopWorkflow' }), 'By invitee email'),
  deal: note(hubspot('HubSpot · Create Deal', 'POST', '/crm/v3/objects/deals', `={{ JSON.stringify({
  properties: { dealname: $('Check Existing Booking').first().json.deal_name, pipeline: 'default', dealstage: 'appointmentscheduled' },
  associations: [{ to: { id: $json.results[0].id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }]
}) }}`, { onError: 'stopWorkflow' }), 'Stage: Appointment scheduled · linked to contact'),
  record: note(code('Build Meeting Record', 'build-meeting.js'), 'Row(s) + host email'),
  saveB: note(sheetsWrite('Save Meeting Rows', 'Meetings', { operation: 'appendOrUpdate', match: 'invitee_uri', fields: MEETING_FIELDS }), 'Tab "Meetings" · key = invitee_uri'),
  mailB: note(email('Email Host (booked)', hostEmail('$json.email_to'), { executeOnce: true }), 'Once, even for 2 rows'),

  findC: note(sheetsLookup('Find Canceled Booking', 'Meetings', 'invitee_uri', `={{ ${parsed}.invitee_uri }}`), 'Get deal_id'),
  cancel: note(code('Build Cancellation', 'build-cancellation.js'), 'Status · reason · deal stage'),
  hasDeal: note(ifTrue('Has Deal?', '={{ $json.has_deal }}'), 'Booked before automation?'),
  dealUpd: note(hubspot('HubSpot · Update Deal Stage', 'PATCH', '/crm/v3/objects/deals/{{ $json.deal_id }}',
    '={{ JSON.stringify($json.deal_update) }}', { onError: 'continueRegularOutput' }), 'Stage + closed_lost_reason'),
  saveC: note(sheetsWrite('Update Meeting Row', 'Meetings', { operation: 'appendOrUpdate', match: 'invitee_uri', fields: MEETING_FIELDS }), 'status = Canceled'),
  mailC: note(email('Email Host (canceled)', hostEmail('$json.email_to')), 'Prompt a rebooking follow-up'),
};

const { c, connect, chain } = connections();
chain(n.hook, n.verify, n.valid);
connect(n.valid, n.r200, 0);
connect(n.valid, n.r401, 1);
connect(n.r200, n.kind);
connect(n.kind, n.findB, 0);
connect(n.kind, n.findC, 1);
chain(n.findB, n.check, n.newDeal);
connect(n.newDeal, n.contact, 0);
connect(n.newDeal, n.record, 1);
chain(n.contact, n.deal, n.record);
connect(n.record, n.saveB);
connect(n.record, n.mailB);
chain(n.findC, n.cancel);
connect(n.cancel, n.hasDeal);
connect(n.hasDeal, n.dealUpd, 0);
connect(n.cancel, n.saveC);
connect(n.cancel, n.mailC);

export default [{
  file: 'workflow.json',
  workflow: workflow('09 · Calendly Booking → HubSpot Contact + Deal → Meetings Sheet → Email Host', {
    connections: c,
    overview: `# 📅 09 · Meeting Booked → Deal
**A booked demo becomes a HubSpot deal automatically. Reschedules and cancellations keep the CRM honest.**

### Problem it solves
A prospect books a demo in Calendly. The rep has to create the contact and the deal by hand, copy the form answers, and remember to update the deal if the meeting moves or is canceled. Pipeline reports end up wrong.

### Events
| Calendly event | Result |
|---|---|
| \`invitee.created\` | Contact upsert + **deal** (Appointment scheduled) + row + email |
| Reschedule | **Same deal kept**, new row, old row "Moved" |
| \`invitee.canceled\` | Deal → canceled stage + reason, row updated, email |

### Real-world gotchas handled
- Calendly **reschedule = cancel + create**. The cancel part (\`rescheduled: true\`) is ignored, so no false "canceled" alerts
- **Webhook retries**: invitee already in the sheet → stop, no second deal
- **Signature** verified (\`t=…,v1=…\`), 5-min window
- Host email missing → falls back to the sales inbox

### Setup
- Env: \`CALENDLY_SIGNING_KEY\`, \`NODE_FUNCTION_ALLOW_BUILTIN=crypto\`, \`N8N_BLOCK_ENV_ACCESS_IN_NODE=false\`
- 🔑 **HubSpot Service Key** (contacts + deals write), **Google Sheets**, **SMTP**
- Calendly webhook subscription (API): events \`invitee.created\`, \`invitee.canceled\``,
    stages: [
      { title: '① Receive', color: COLOR.green, body: 'Verify first, ack fast.', nodes: [n.hook, n.verify, n.valid, [n.r200, n.r401], n.kind] },
      { title: '② CRM', color: COLOR.purple, body: 'Top: booked → dedupe → contact → deal.\nBottom: canceled → find deal → move stage.', nodes: [[n.findB, n.findC], [n.check, n.cancel], [n.newDeal, n.hasDeal], [n.contact, n.dealUpd], n.deal] },
      { title: '③ Save & notify', color: COLOR.blue, body: 'Meetings sheet + host email.\nTop: booked · bottom: canceled.', nodes: [n.record, [n.saveB, n.mailB, n.saveC, n.mailC]] },
    ],
  }),
}];
