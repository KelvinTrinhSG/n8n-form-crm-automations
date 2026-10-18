import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, COLOR, codeFrom, note, schedule, sheetsRead, sheetsWrite, hubspot, ifTrue, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));

const n = {
  cron: note(schedule('Every 15 Minutes', '*/15 * * * *'), 'Cron */15 * * * *'),
  read: note(sheetsRead('Read Retry Queue', 'Failed Syncs'), 'Tab "Failed Syncs"'),
  pick: note(code('Pick Due Retries', 'pick-due.js'), 'pending + due · max 50 · oldest first'),
  upsert: note(hubspot('HubSpot · Upsert Contact', 'POST', '/crm/v3/objects/contacts/batch/upsert',
    '={{ JSON.stringify($json.request_body) }}', { retryOnFail: false }), 'No inner retry: the queue is the retry'),
  ok: note(code('Mark Resolved', 'mark-resolved.js', 'each'), 'status = resolved'),
  saveOk: note(sheetsWrite('Update Row (resolved)', 'Failed Syncs', {
    operation: 'update', match: 'queue_id',
    fields: ['queue_id', 'attempts', 'status', 'next_retry_at', 'resolved_at', 'hubspot_contact_id', 'last_error'],
  }), 'Match on queue_id'),
  next: note(code('Schedule Next Retry', 'next-retry.js', 'each'), 'Classify error · backoff · give up'),
  saveFail: note(sheetsWrite('Update Row (failed)', 'Failed Syncs', {
    operation: 'update', match: 'queue_id',
    fields: ['queue_id', 'attempts', 'status', 'next_retry_at', 'last_error_code', 'last_error'],
  }), 'Match on queue_id'),
  shouldAlert: note(ifTrue('Needs a Human?', '={{ $json.escalate }}'), 'dead, or auth error'),
  alert: note(email('Email Ops', { to: CONFIG.OPS_EMAIL }), 'One email per escalated row'),
};

const { c, connect, chain } = connections();
chain(n.cron, n.read, n.pick, n.upsert);
connect(n.upsert, n.ok, 0);
connect(n.upsert, n.next, 1);
connect(n.ok, n.saveOk);
connect(n.next, n.saveFail);
connect(n.next, n.shouldAlert);
connect(n.shouldAlert, n.alert, 0);

export default [{
  file: 'workflow.json',
  workflow: workflow('03 · CRM Retry Queue: failed syncs → backoff → HubSpot → escalate', {
    connections: c,
    overview: `# 🔁 03 · CRM Retry Queue
**When HubSpot is down or the token expires, leads wait in a queue instead of disappearing.**

### Problem it solves
A lead that fails to sync usually ends up as a red execution nobody opens. Someone notices days later that the CRM is missing contacts, then replays them by hand.

### How it works
- **01** writes failed leads to the **Failed Syncs** tab (status \`pending\`)
- Every 15 min this worker retries the due rows (max 50)
- Success → \`resolved\` + HubSpot ID
- Failure → classified:
  - 400/404/422 → \`dead\` now (data problem)
  - 401/403 → retry + email ops once (token problem)
  - 429/5xx/timeout → backoff 15m → 30m → 1h → 2h → 4h
- After 6 attempts → \`dead\` + email ops

### Manual fix
Edit the payload in the sheet, set status back to \`pending\`. The next run picks it up.

### Setup
- 🔑 **Google Sheets**, **HubSpot Service Key**, **SMTP**`,
    stages: [
      { title: '① Schedule', color: COLOR.green, body: 'Every 15 minutes.', nodes: [n.cron] },
      { title: '② Load due work', color: COLOR.purple, body: 'Read queue, pick due rows.', nodes: [n.read, n.pick] },
      { title: '③ Retry', color: COLOR.orange, body: 'One upsert per row.\nRed output = still failing.', nodes: [n.upsert] },
      { title: '④ Record outcome', color: COLOR.blue, body: 'Resolved, rescheduled or dead.', nodes: [[n.ok, n.next], [n.saveOk, n.saveFail]] },
      { title: '⑤ Escalate', color: COLOR.red, body: 'Humans only see what needs a human.', nodes: [n.shouldAlert, n.alert] },
    ],
  }),
}];
