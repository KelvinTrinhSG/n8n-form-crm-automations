// Daily health email: failed executions in the last 24 h (from the n8n API) and the CRM retry queue.
// The email doubles as a heartbeat: if it does not arrive one morning, n8n itself is down,
// which the Error Handler can never report.
const N8N_URL = 'http://localhost:5678';
const now = Date.now();
const DAY = 24 * 3600 * 1000;

const executions = ($('n8n API · Failed Executions').first().json.data || [])
  .filter((e) => now - Date.parse(e.startedAt) < DAY);
const workflows = Object.fromEntries(($('n8n API · Workflows').first().json.data || []).map((w) => [String(w.id), w]));
const queue = $input.all().map((i) => i.json).filter((r) => r.queue_id);

const byWorkflow = {};
for (const e of executions) {
  const id = String(e.workflowId);
  const g = (byWorkflow[id] ||= { name: workflows[id]?.name || `Workflow ${id}`, count: 0, last: 0, lastId: '' });
  g.count += 1;
  if (Date.parse(e.startedAt) > g.last) { g.last = Date.parse(e.startedAt); g.lastId = e.id; }
}
const failures = Object.entries(byWorkflow).sort((a, b) => b[1].count - a[1].count);

const pending = queue.filter((r) => r.status === 'pending');
const dead = queue.filter((r) => r.status === 'dead');
const oldestPendingH = pending.length ? Math.round((now - Math.min(...pending.map((r) => Date.parse(r.created_at)))) / 3600000) : 0;
const active = Object.values(workflows).filter((w) => w.active);

const status = dead.length || executions.length >= 5 || oldestPendingH >= 24 ? 'red' : executions.length ? 'yellow' : 'green';
const icon = { green: '🟢', yellow: '🟡', red: '🔴' }[status];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const failRows = failures.map(([id, g]) => `<tr><td>${esc(g.name)}</td><td style="text-align:right">${g.count}</td>`
  + `<td><a href="${N8N_URL}/workflow/${esc(id)}/executions/${esc(g.lastId)}">last failure</a></td></tr>`).join('');
const deadRows = dead.slice(0, 10).map((r) => `<li>${esc(r.email)}: ${esc(r.last_error_code)} ${esc(r.last_error)}</li>`).join('');

return [{
  json: {
    status,
    failed_runs_24h: executions.length,
    queue_pending: pending.length,
    queue_dead: dead.length,
    email_subject: `${icon} Automation health: ${executions.length} failed run(s), ${pending.length} pending, ${dead.length} dead in CRM queue`,
    email_html: `<div style="font-family:Arial;font-size:14px">
<h3 style="margin:0">${icon} Automation health · last 24 h</h3>
<table cellpadding="4">
<tr><td>Active workflows</td><td><b>${active.length}</b></td></tr>
<tr><td>Failed executions</td><td><b>${executions.length}</b></td></tr>
<tr><td>CRM retry queue: pending</td><td><b>${pending.length}</b>${pending.length ? ` (oldest ${oldestPendingH} h)` : ''}</td></tr>
<tr><td>CRM retry queue: dead (needs a human)</td><td><b>${dead.length}</b></td></tr>
</table>
${failRows ? `<h4>Failures by workflow</h4><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Workflow</th><th>Failed</th><th></th></tr>${failRows}</table>` : '<p>✅ No failed executions.</p>'}
${deadRows ? `<h4>Dead CRM syncs</h4><ul>${deadRows}</ul><p>Fix the row in <b>Failed Syncs</b> and set status to "pending".</p>` : ''}
</div>`,
  },
}];
