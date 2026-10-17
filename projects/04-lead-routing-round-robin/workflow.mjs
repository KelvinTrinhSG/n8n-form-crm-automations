import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, COLOR, codeFrom, note, webhook, respond, sheetsRead, sheetsWrite, hubspot, ifTrue, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));
const fromEmails = "$('Build Emails').item.json";

const n = {
  hook: note(webhook('Route Lead Webhook', 'route-lead', '8d4f1e22-6a3c-4b9d-a7e5-2c1b0f9e8d04'), 'POST /webhook/route-lead'),
  reps: note(sheetsRead('Read Sales Reps', 'Sales Reps'), 'Tab "Sales Reps" · edited by the manager'),
  choose: note(code('Choose Owner', 'choose-owner.js'), 'Keep owner → segment → territory → round robin'),
  emails: note(code('Build Emails', 'build-emails.js'), 'Rep or manager message'),
  assigned: note(ifTrue('Owner Assigned?', '={{ $json.assigned }}'), 'Someone available?'),
  setOwner: note(hubspot('HubSpot · Set Contact Owner', 'PATCH', '/crm/v3/objects/contacts/{{ $json.contact_id }}',
    '={{ JSON.stringify({ properties: { hubspot_owner_id: $json.owner.hubspot_owner_id } }) }}', { onError: 'stopWorkflow' }), 'hubspot_owner_id'),
  log: note(sheetsWrite('Log Assignment', 'Assignments', {
    fields: ['assigned_at', 'contact_id', 'email', 'company', 'country', 'segment', 'owner_name', 'owner_email', 'rule'],
    from: `{ ...${fromEmails}, assigned_at: ${fromEmails}.assigned_at || $now.toISO(), owner_name: ${fromEmails}.owner.name, owner_email: ${fromEmails}.owner.email }`,
  }), 'Tab "Assignments" · audit trail'),
  mailRep: note(email('Email Assigned Rep', {
    to: `={{ ${fromEmails}.email_to || '${CONFIG.SALES_EMAIL}' }}`,
    subject: `={{ ${fromEmails}.email_subject }}`,
    html: `={{ ${fromEmails}.email_html }}`,
  }), 'Direct to the rep'),
  okResp: note(respond('Respond Owner', 200, "={{ JSON.stringify({ ok: true, owner: $('Choose Owner').first().json.owner, rule: $('Choose Owner').first().json.rule }) }}"), 'Caller gets the owner'),
  mailMgr: note(email('Email Sales Manager', { to: CONFIG.SALES_EMAIL }), 'Needs a manual owner'),
  noResp: note(respond('Respond Unassigned', 200, "={{ JSON.stringify({ ok: true, owner: null, rule: $json.rule }) }}"), 'Not an error'),
};

const { c, connect, chain } = connections();
chain(n.hook, n.reps, n.choose, n.emails, n.assigned);
connect(n.assigned, n.setOwner, 0);
chain(n.setOwner, n.log, n.mailRep, n.okResp);
connect(n.assigned, n.mailMgr, 1);
connect(n.mailMgr, n.noResp);

export default [{
  file: 'workflow.json',
  workflow: workflow('04 · Lead Routing: territory + segment + round robin → HubSpot owner', {
    connections: c,
    overview: `# 🧭 04 · Lead Routing
**Every new lead gets the right owner in HubSpot within seconds, and the rep gets an email.**

### Problem it solves
A manager assigns leads by hand from a shared inbox. Leads wait until someone is free, some reps get more than others, and nobody notices when a rep is on holiday.

### Rules (in order)
1. Already has an owner → **keep it**
2. **Segment**: 500+ employees → enterprise reps
3. **Territory**: country-specific reps before \`*\` reps
4. Skip **inactive** and **out-of-office** reps
5. **Round robin** inside the pool

### Rules live in a sheet
The manager edits tab **Sales Reps** (active, territories, segments, out_of_office_until). No workflow change needed.

### Called by
Project 01 (after the contact is created) or any system: POST \`{hubspot_contact_id, email, name, company, country, employees, current_owner_id}\`.

### Setup
- 🔑 **Google Sheets**, **HubSpot App Token** (scope \`crm.objects.contacts.write\`), **SMTP**`,
    stages: [
      { title: '① Receive', color: COLOR.green, body: 'Lead details from 01 or any caller.', nodes: [n.hook] },
      { title: '② Decide owner', color: COLOR.orange, body: 'Rules from the Sales Reps sheet.', nodes: [n.reps, n.choose, n.emails, n.assigned] },
      { title: '③ Assign & notify', color: COLOR.blue, body: 'Owner in HubSpot, audit row, rep email.', nodes: [[n.setOwner, n.mailMgr], [n.log, n.noResp], n.mailRep, n.okResp] },
    ],
  }),
}];
