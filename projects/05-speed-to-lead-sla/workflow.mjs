import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR, codeFrom, note, schedule, sheetsRead, sheetsWrite, hubspot, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));

const n = {
  cron: note(schedule('Every 15 Min, Business Hours', '*/15 9-18 * * 1-5'), 'Mon–Fri 9:00–18:45 ET'),
  leads: note(sheetsRead('Read Leads', 'Leads'), 'Tab "Leads" (written by 01)'),
  find: note(code('Find SLA Candidates', 'find-candidates.js'), 'Business minutes · 60 / 240 thresholds'),
  crm: note(hubspot('HubSpot · Batch Read Contacts', 'POST', '/crm/v3/objects/contacts/batch/read',
    '={{ JSON.stringify($json.request_body) }}', { onError: 'stopWorkflow' }), 'Owner · status · last activity'),
  reps: note(sheetsRead('Read Sales Reps', 'Sales Reps', { executeOnce: true }), 'owner id → rep email'),
  decide: note(code('Decide Escalations', 'decide-escalations.js'), 'CRM says contacted? → met'),
  save: note(sheetsWrite('Update SLA Status', 'Leads', {
    operation: 'update', match: 'email', fields: ['email', 'sla_level', 'sla_alerted_at'],
  }), 'Never alert twice for one level'),
  group: note(code('Group Alerts by Recipient', 'group-alerts.js'), 'One email per person'),
  send: note(email('Send SLA Alert', { to: '={{ $json.email_to }}' }), 'Rep reminder or manager escalation'),
};

const { c, connect, chain } = connections();
chain(n.cron, n.leads, n.find, n.crm, n.reps, n.decide);
connect(n.decide, n.save);
connect(n.decide, n.group);
connect(n.group, n.send);

export default [{
  file: 'workflow.json',
  workflow: workflow('05 · Speed-to-Lead SLA: business-hours clock → HubSpot check → reminders & escalation', {
    connections: c,
    overview: `# ⏱️ 05 · Speed-to-Lead SLA
**No lead waits more than an hour of business time without someone noticing.**

### Problem it solves
Leads contacted within the first hour convert far better, but nobody watches the clock. A manager finds out on Friday that Tuesday's demo request was never called.

### Rules
| Business time without contact | Action |
|---|---|
| 60 min | Reminder to the **owner** |
| 240 min | Escalation to the **sales manager** |
| No owner | Straight to the manager |

### Why check HubSpot first
The sheet does not know about calls. The workflow reads \`hs_last_sales_activity_timestamp\`, \`notes_last_contacted\` and \`hs_lead_status\`. If the rep already acted, the lead is marked **met** and nobody is bothered.

### Business hours
Mon–Fri 9:00–18:00 ET, holidays excluded, DST-safe.

### No duplicate alerts
\`sla_level\` in the Leads tab records the last alert sent. **01** resets it when the person submits again.

### Setup
- 🔑 **Google Sheets**, **HubSpot Service Key** (\`crm.objects.contacts.read\`), **SMTP**`,
    stages: [
      { title: '① Schedule', color: COLOR.green, body: 'Business hours only.', nodes: [n.cron] },
      { title: '② Find overdue leads', color: COLOR.orange, body: 'Sheet → business-minute clock.', nodes: [n.leads, n.find] },
      { title: '③ Confirm in CRM', color: COLOR.purple, body: 'One batch call for up to 100 leads.', nodes: [n.crm, n.reps, n.decide] },
      { title: '④ Record & alert', color: COLOR.blue, body: 'Update the sheet, email grouped alerts.', nodes: [[n.save, n.group], n.send] },
    ],
  }),
}];
