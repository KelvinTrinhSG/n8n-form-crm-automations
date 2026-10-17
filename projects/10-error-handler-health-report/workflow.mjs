import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, COLOR, codeFrom, note, errorTrigger, schedule, http, sheetsRead, sheetsWrite, ifTrue, email, connections, workflow,
} from '../../scripts/lib.mjs';

const code = codeFrom(path.dirname(fileURLToPath(import.meta.url)));

// ---------- 10a · Error handler ----------
const a = {
  trigger: note(errorTrigger('On Workflow Error'), 'Fires for 01–09 in production'),
  classify: note(code('Classify Error', 'classify-error.js'), 'Category · severity · fix · suppression'),
  log: note(sheetsWrite('Log to Error Log', 'Error Log', {
    fields: ['occurred_at', 'workflow', 'node', 'category', 'severity', 'message', 'execution_url', 'execution_mode', 'alert_sent'],
  }), 'Tab "Error Log" · every error'),
  should: note(ifTrue('Send Alert?', '={{ $json.alert_sent }}'), 'Max 1 per 30 min per signature'),
  mail: note(email('Email Ops', { to: CONFIG.OPS_EMAIL }), 'Actionable alert'),
};
const ca = connections();
ca.chain(a.trigger, a.classify);
ca.connect(a.classify, a.log);
ca.connect(a.classify, a.should);
ca.connect(a.should, a.mail, 0);

const errorHandler = workflow('10a · Error Handler: classify → log → deduplicated email alert', {
  connections: ca.c,
  overview: `# 🚨 10a · Error Handler
**One place that catches every failure, explains it, and emails ops only when it matters.**

### Problem it solves
Workflows fail silently: an expired token, a quota, a renamed sheet column. Default n8n alerts are raw stack traces, or 200 identical emails during an outage.

### What it does
- Set as **Error Workflow** on 01–09 (\`deploy.mjs\` does it)
- Classifies: **auth · quota · rate_limit · service_down · bad_data · code_bug**
- Adds a **likely fix** in plain English
- Logs **every** error to the Error Log tab
- Emails at most **once per 30 min** per workflow + node + category, with a count of skipped duplicates

### Note
Error workflows only fire for **production** (active) executions, not manual test runs.

### Setup
- 🔑 **Google Sheets**, **SMTP**`,
  stages: [
    { title: '① Catch', color: COLOR.red, body: 'Error Trigger.', nodes: [a.trigger] },
    { title: '② Understand', color: COLOR.orange, body: 'What broke and what to do.', nodes: [a.classify] },
    { title: '③ Record & alert', color: COLOR.blue, body: 'Log all, email the first.', nodes: [[a.log, a.should], a.mail] },
  ],
});

// ---------- 10b · Daily health report ----------
const n8nApi = (name, route, query) => http(name, {
  url: `${CONFIG.N8N_URL}/api/v1${route}`,
  generic: 'httpHeaderAuth', // Header Auth credential: name X-N8N-API-KEY, value = API key
  query,
}, { onError: 'stopWorkflow' });

const b = {
  cron: note(schedule('Every Day 8:00', '0 8 * * *'), 'Cron 0 8 * * * ET'),
  execs: note(n8nApi('n8n API · Failed Executions', '/executions', { status: 'error', limit: '250' }), 'GET /api/v1/executions'),
  wfs: note(n8nApi('n8n API · Workflows', '/workflows', { limit: '250' }), 'id → name, active'),
  queue: note(sheetsRead('Read Retry Queue', 'Failed Syncs', { executeOnce: true }), 'From projects 01 / 03'),
  report: note(code('Build Health Report', 'health-report.js'), '🟢 / 🟡 / 🔴'),
  mail: note(email('Email Health Report', { to: CONFIG.OPS_EMAIL }), 'Also a heartbeat'),
};
const cb = connections();
cb.chain(b.cron, b.execs, b.wfs, b.queue, b.report, b.mail);

const healthReport = workflow('10b · Daily Health Report: n8n API + retry queue → email', {
  connections: cb.c,
  overview: `# 🩺 10b · Daily Health Report
**Every morning: did the automations work yesterday, and is anything stuck?**

### Why both 10a and 10b
- 10a reacts to single failures
- 10b shows the **trend** and the **stuck work** (dead rows in the CRM retry queue)
- If n8n itself is down, 10a cannot fire. The **missing morning email** is the signal

### Report
- Failed executions per workflow (link to the latest)
- CRM queue: pending, oldest age, dead rows with errors
- 🟢 none · 🟡 a few · 🔴 dead rows, 5+ failures or 24 h+ backlog

### Setup
- n8n → Settings → **API** → create key
- 🔑 **Header Auth** credential: \`X-N8N-API-KEY\` → both API nodes
- 🔑 **Google Sheets**, **SMTP**`,
  stages: [
    { title: '① Schedule', color: COLOR.green, body: 'Daily 8:00 ET.', nodes: [b.cron] },
    { title: '② Collect', color: COLOR.purple, body: 'n8n API + Failed Syncs tab.', nodes: [b.execs, b.wfs, b.queue] },
    { title: '③ Report', color: COLOR.blue, body: 'Traffic-light email.', nodes: [b.report, b.mail] },
  ],
});

export default [
  { file: 'workflow-error-handler.json', workflow: errorHandler },
  { file: 'workflow-health-report.json', workflow: healthReport },
];
