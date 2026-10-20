// Turns a raw n8n error into something a person can act on: category, severity and a likely fix.
// Alert storms are suppressed: the same workflow + node + category alerts at most once per 30 minutes;
// the next alert says how many similar errors were skipped. Every error is still logged to the sheet.
const SUPPRESS_MINUTES = 30;
const d = $input.first().json;
const exec = d.execution || {};
const trig = d.trigger || {};
const err = exec.error || trig.error || {};
const wf = d.workflow || {};
const node = exec.lastNodeExecuted || (trig.error ? 'Trigger' : 'unknown');
const message = String(err.description || err.message || 'Unknown error');
// cause.message carries the HTTP status ("400 - {...}") for HTTP Request errors; n8n sets no httpCode there.
const text = `${err.name || ''} ${err.message || ''} ${err.description || ''} ${err.httpCode || ''} ${(err.cause && err.cause.message) || ''}`;

const RULES = [
  { category: 'auth', severity: 'high', re: /\b(401|403)\b|unauthori[sz]ed|authori[sz]ation failed|forbidden|invalid[_ ]grant|invalid (api )?key|token (has )?expired|authentication|credentials? (not found|invalid)/i,
    hint: 'A credential expired or lost a scope. Reconnect it in n8n → Credentials, then re-run the failed execution.' },
  { category: 'quota', severity: 'high', re: /insufficient_quota|billing|quota exceeded|exceeded your current quota|payment required|\b402\b/i,
    hint: 'The account is out of credit or quota (e.g. OpenAI). Top up or raise the limit.' },
  { category: 'rate_limit', severity: 'medium', re: /\b429\b|too many requests|rate limit/i,
    hint: 'Too many requests. Usually clears by itself; if it repeats, add batching/wait or lower the schedule frequency.' },
  { category: 'service_down', severity: 'medium', re: /\b(500|502|503|504)\b|bad gateway|service unavailable|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|timeout/i,
    hint: 'The other service was down or slow. Check its status page; retries or the retry queue will catch up.' },
  { category: 'bad_data', severity: 'medium', re: /\b(400|404|409|422)\b|not valid|invalid input|required|does not exist|no such|not (be )?found/i,
    hint: 'The data sent was rejected (wrong field, missing value, deleted record). Open the execution and check the input of the failing node.' },
  { category: 'code_bug', severity: 'high', re: /ReferenceError|TypeError|SyntaxError|Cannot read propert|is not a function|is not defined/i,
    hint: 'A bug in a Code node or an expression. Fix it in src/, rebuild and redeploy.' },
];
const rule = RULES.find((r) => r.re.test(text)) || { category: 'unknown', severity: 'medium', hint: 'Open the execution to see the full error.' };

const state = $getWorkflowStaticData('global');
state.alerts = state.alerts || {};
const now = Date.now();
for (const [k, v] of Object.entries(state.alerts)) if (now - v.last > 24 * 3600 * 1000) delete state.alerts[k];
const signature = `${wf.id}|${node}|${rule.category}`;
const prev = state.alerts[signature];
const suppress = prev && now - prev.last < SUPPRESS_MINUTES * 60 * 1000;
let suppressedBefore = 0;
if (suppress) {
  prev.suppressed += 1;
} else {
  suppressedBefore = prev ? prev.suppressed : 0;
  state.alerts[signature] = { last: now, suppressed: 0 };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = { high: '🔴', medium: '🟠', low: '🟡' }[rule.severity];
const url = exec.url || '';

return [{
  json: {
    occurred_at: new Date(now).toISOString(),
    workflow: wf.name || wf.id || 'unknown workflow',
    node,
    category: rule.category,
    severity: rule.severity,
    message: message.slice(0, 500),
    execution_url: url,
    execution_mode: exec.mode || trig.mode || '',
    alert_sent: !suppress,
    email_subject: `${icon} [n8n] ${wf.name || 'Workflow'} failed at "${node}" (${rule.category})`,
    email_html: `<div style="font-family:Arial;font-size:14px">
<p><b>Workflow:</b> ${esc(wf.name)}<br><b>Node:</b> ${esc(node)}<br><b>Category:</b> ${rule.category} · <b>Severity:</b> ${rule.severity}</p>
<p style="background:#fef2f2;padding:10px;border-radius:6px">${esc(message)}</p>
<p><b>Likely fix:</b> ${esc(rule.hint)}</p>
${url ? `<p><a href="${esc(url)}">Open the failed execution</a></p>` : ''}
${suppressedBefore ? `<p style="color:#666">${suppressedBefore} similar error(s) since the previous alert were not emailed (see Error Log).</p>` : ''}
</div>`,
  },
}];
