import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);

const errorEvent = (message, extra = {}) => ({
  execution: { id: '231', url: 'http://localhost:5678/workflow/abc/executions/231', lastNodeExecuted: 'HubSpot · Find Contact', mode: 'webhook', error: { message, ...extra } },
  workflow: { id: 'abc', name: '01 · Form → HubSpot' },
});
const classify = (event, staticData = {}) => runCode(src('classify-error.js'), { items: [event], staticData }).then((r) => r[0]);

test('classifies common real-world errors', async () => {
  const cases = [
    ['Authorization failed - please check your credentials', 'auth'],
    ['The resource you are requesting could not be found', 'bad_data'],
    ['You exceeded your current quota, please check your plan and billing details', 'quota'],
    ['The service is receiving too many requests from you (429)', 'rate_limit'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'service_down'],
    ["Cannot read properties of undefined (reading 'email')", 'code_bug'],
    ['Something odd', 'unknown'],
  ];
  for (const [message, category] of cases) assert.equal((await classify(errorEvent(message))).category, category, message);
});

test('trigger errors (no execution) are handled', async () => {
  const out = await classify({ trigger: { error: { message: 'invalid_grant' }, mode: 'trigger' }, workflow: { id: 'x', name: '08 · Inbox' } });
  assert.equal(out.node, 'Trigger');
  assert.equal(out.category, 'auth');
});

test('same failure within 30 min is logged but not emailed, then the count is reported', async () => {
  const state = {};
  const first = await classify(errorEvent('Bad Gateway 502'), state);
  const second = await classify(errorEvent('Bad Gateway 502'), state);
  const third = await classify(errorEvent('Bad Gateway 502'), state);
  assert.deepEqual([first.alert_sent, second.alert_sent, third.alert_sent], [true, false, false]);

  state.alerts['abc|HubSpot · Find Contact|service_down'].last -= 31 * 60000;
  const later = await classify(errorEvent('Bad Gateway 502'), state);
  assert.equal(later.alert_sent, true);
  assert.match(later.email_html, /2 similar error\(s\)/);
});

test('health report: groups failures, counts queue, sets status', async () => {
  const recent = new Date(Date.now() - 3600000).toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const [out] = await runCode(src('health-report.js'), {
    items: [
      { queue_id: 'Q1', status: 'pending', created_at: recent },
      { queue_id: 'Q2', status: 'dead', email: 'x@y.com', last_error_code: '400', last_error: 'Property values were not valid' },
      { queue_id: 'Q3', status: 'resolved' },
    ],
    nodes: {
      'n8n API · Failed Executions': [{ data: [{ id: '1', workflowId: 'w1', startedAt: recent }, { id: '2', workflowId: 'w1', startedAt: recent }, { id: '3', workflowId: 'w2', startedAt: old }] }],
      'n8n API · Workflows': [{ data: [{ id: 'w1', name: '01 · Form', active: true }, { id: 'w2', name: '06 · Sync', active: true }] }],
    },
  });
  assert.equal(out.failed_runs_24h, 2);
  assert.equal(out.queue_pending, 1);
  assert.equal(out.queue_dead, 1);
  assert.equal(out.status, 'red');
  assert.match(out.email_html, /01 · Form/);
  assert.ok(!out.email_html.includes('06 · Sync</td>'));
});
