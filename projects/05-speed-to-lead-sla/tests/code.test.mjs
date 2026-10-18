import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../scripts/harness.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(dir, 'src', f);

// Freeze "now" so business-hour math is deterministic: Monday 2026-10-19 10:00 New York (EDT, UTC-4).
const NOW = Date.parse('2026-10-19T14:00:00Z');
const withNow = async (fn) => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try { return await fn(); } finally { mock.timers.reset(); }
};
const lead = (submitted, extra = {}) => ({ email: `${submitted}@x.com`, first_name: 'A', hubspot_contact_id: '1', last_submitted_at: submitted, sla_level: '', ...extra });

test('Friday 17:30 → Monday 10:00 is 90 business minutes, not 64 hours', async () => {
  const [out] = await withNow(() => runCode(src('find-candidates.js'), { items: [lead('2026-10-16T21:30:00Z')] }));
  assert.equal(out.candidates[0].business_minutes, 90);
  assert.equal(out.candidates[0].due_level, 'rep');
});

test('weekend submission is 60 business minutes old at Monday 10:00', async () => {
  const [out] = await withNow(() => runCode(src('find-candidates.js'), { items: [lead('2026-10-18T15:00:00Z')] }));
  assert.equal(out.candidates[0].business_minutes, 60);
});

test('skips fresh, already-escalated, met and old leads', async () => {
  const out = await withNow(() => runCode(src('find-candidates.js'), {
    items: [
      lead('2026-10-19T13:30:00Z'),                          // 30 min → not due
      lead('2026-10-16T14:00:00Z', { sla_level: 'manager' }), // already escalated
      lead('2026-10-16T14:00:00Z', { sla_level: 'met' }),
      lead('2026-10-05T14:00:00Z'),                          // outside lookback
      {},                                                    // empty sheet
    ],
  }));
  assert.deepEqual(out, []);
});

test('rep level already sent → escalates to manager once 240 min pass', async () => {
  const [out] = await withNow(() => runCode(src('find-candidates.js'), { items: [lead('2026-10-16T14:00:00Z', { sla_level: 'rep' })] }));
  assert.equal(out.candidates[0].due_level, 'manager');
});

test('HubSpot activity after submission marks the lead met; no owner goes to manager', async () => {
  const candidates = [
    { email: 'a@x.com', hubspot_contact_id: '1', submitted_at: '2026-10-19T12:00:00Z', business_minutes: 120, due_level: 'rep' },
    { email: 'b@x.com', hubspot_contact_id: '2', submitted_at: '2026-10-19T12:00:00Z', business_minutes: 120, due_level: 'rep' },
    { email: 'c@x.com', hubspot_contact_id: '3', submitted_at: '2026-10-19T12:00:00Z', business_minutes: 120, due_level: 'rep' },
  ];
  const results = [
    { id: '1', properties: { hubspot_owner_id: '51001', hs_last_sales_activity_timestamp: '2026-10-19T13:00:00Z' } },
    { id: '2', properties: { hubspot_owner_id: '51001', hs_lead_status: 'NEW' } },
    { id: '3', properties: { hubspot_owner_id: '' } },
  ];
  const out = await runCode(src('decide-escalations.js'), {
    items: [{ hubspot_owner_id: '51001', email: 'alice@example.com', name: 'Alice', active: 'TRUE' }],
    nodes: { 'Find SLA Candidates': [{ candidates }], 'HubSpot · Batch Read Contacts': [{ results }] },
  });
  assert.deepEqual(out.map((o) => [o.sla_level, o.recipient]), [['met', undefined], ['rep', 'alice@example.com'], ['manager', 'sales@example.com']]);

  const mails = await runCode(src('group-alerts.js'), { items: out });
  assert.equal(mails.length, 2);
  assert.match(mails.find((m) => m.email_to === 'sales@example.com').email_subject, /SLA breach/);
});

test('owner who is inactive in Sales Reps → manager, never the inactive rep (live run 2026-10-18)', async () => {
  const candidates = [{ email: 'a@x.com', hubspot_contact_id: '1', submitted_at: '2026-10-16T20:00:00Z', business_minutes: 120, due_level: 'rep' }];
  const results = [{ id: '1', properties: { hubspot_owner_id: '777', hs_lead_status: 'NEW' } }];
  const run = (reps) => runCode(src('decide-escalations.js'), {
    items: reps, nodes: { 'Find SLA Candidates': [{ candidates }], 'HubSpot · Batch Read Contacts': [{ results }] },
  });
  // Live case: several rows share one owner id and the last one is inactive. The active row must win.
  const [shared] = await run([
    { hubspot_owner_id: '777', email: 'alice@x.com', name: 'Alice', active: true },
    { hubspot_owner_id: '777', email: 'frank@x.com', name: 'Frank', active: 'FALSE' },
  ]);
  assert.equal(shared.recipient, 'alice@x.com');
  // Only an inactive rep owns the contact → escalate to the manager.
  const [gone] = await run([{ hubspot_owner_id: '777', email: 'frank@x.com', name: 'Frank', active: 'FALSE' }]);
  assert.equal(gone.sla_level, 'manager');
  assert.equal(gone.recipient, 'sales@example.com');
  assert.equal(gone.owner_name, 'Frank (inactive)');
});
